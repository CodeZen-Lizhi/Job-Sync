import { computed, onActivated, onDeactivated, onMounted, reactive, ref, watch } from "vue";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";

import { CRAWL_TASK_TYPE_CHAT_SYNC, type RecomputeFilterProfileResult } from "./crawl";
import {
  formatAiPostCollectionJudgeSummary,
  recomputeAiPostCollectionJudgementForAllJobs,
} from "./aiRecompute";
import { useFilterProfile } from "./filterProfile";
import {
  companyReviewStatusLabel,
  communicationStatusLabel,
  formatFilterReasonSummary,
  formatResumeMatchEvidence,
  formatScoreReasonSummary,
  parseFilterReasonJson,
  parseScoreReasonJson,
  reviewStatusLabel,
} from "./jobs";
import type {
  AiCompanyScoreBatchResult,
  CollectionMethod,
  CompanyReviewStatus,
  CompanyScoreRebuildResult,
  CommunicationStatus,
  GreetingErrorState,
  GreetingMessageResult,
  JobBlacklistEntry,
  JobCandidatePage,
  JobDailyIntelligence,
  JobDailyIntelligenceCandidate,
  JobDetail,
  JobRow,
  KeywordGroup,
  LoadKeywordOptions,
  ReviewStatus,
} from "./jobs";
import {
  canScheduleRealtimeRefresh,
  formatDate,
  groupKey,
  JOBS_REALTIME_REFRESH_DELAY_MS,
  jobSourceUrl,
  removeJobFromCaches,
  restoreExpandedState,
  SEARCH_JOB_LIMIT,
} from "./jobsPageHelpers";
import { runtime } from "./runtime";
import { invoke, isTauri } from "./tauri";

interface ConfirmDialogState {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  loading: boolean;
  action: (() => Promise<void>) | null;
}

interface AiCompanyScoreErrorState {
  title: string;
  hint: string;
  message: string;
}

type JobTimeRange = "today" | "yesterday" | "last7" | "last30" | "last90" | "custom";
type ProcessedFilter = "all" | "processed" | "unprocessed";
type JobCandidateBucket = "all" | "recommended" | "pending_confirmation" | "filtered" | "processed";

export type JobStatusFilter =
  | ReviewStatus
  | CommunicationStatus
  | "has_notes"
  | "company_not_fit"
  | "blacklisted"
  | "ai_passed"
  | "ai_rejected"
  | "ai_pending";

export const JOB_TIME_RANGE_OPTIONS: Array<{ value: JobTimeRange; label: string }> = [
  { value: "today", label: "今天" },
  { value: "yesterday", label: "昨天" },
  { value: "last7", label: "最近7天" },
  { value: "last30", label: "最近30天" },
  { value: "last90", label: "最近90天" },
  { value: "custom", label: "自定义" },
];

export const PROCESSED_FILTER_OPTIONS: Array<{ value: ProcessedFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "unprocessed", label: "未处理" },
  { value: "processed", label: "已处理" },
];

export const JOB_STATUS_FILTER_OPTIONS: Array<{ value: JobStatusFilter; label: string }> = [
  { value: "favorited", label: "收藏" },
  { value: "ready_to_apply", label: "准备投递" },
  { value: "greeted_unread", label: "已打招呼" },
  { value: "read_no_reply", label: "已读未回" },
  { value: "replied", label: "已回复" },
  { value: "rejected", label: "已拒绝" },
  { value: "applied", label: "已投递" },
  { value: "has_notes", label: "有备注" },
  { value: "ignored", label: "已忽略" },
  { value: "manual_not_fit", label: "岗位不合适" },
  { value: "company_not_fit", label: "公司不合适" },
  { value: "blacklisted", label: "黑名单" },
];

export const AI_AUDIT_FILTER_OPTIONS: Array<{ value: "ai_passed" | "ai_rejected" | "ai_pending"; label: string }> = [
  { value: "ai_passed", label: "通过" },
  { value: "ai_rejected", label: "不通过" },
  { value: "ai_pending", label: "待确认" },
];

export const COLLECTION_METHOD_FILTER_OPTIONS: Array<{ value: CollectionMethod; label: string }> = [
  { value: "automatic", label: "自动采集" },
  { value: "manual", label: "手动采集" },
];

export const SOURCE_PLATFORM_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "boss", label: "Boss" },
  { value: "v2ex", label: "V2EX" },
  { value: "liepin", label: "猎聘" },
  { value: "zhilian", label: "智联" },
  { value: "maimai", label: "脉脉" },
  { value: "linuxdo", label: "LinuxDo" },
];

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateStartIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function localDateExclusiveEndIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return addDays(date, 1).toISOString();
}

function jobTimeRangeBounds(range: JobTimeRange, customStart: string, customEnd: string): { startDate: string | null; endDate: string | null } {
  const today = startOfLocalDay(new Date());
  if (range === "custom") {
    return {
      startDate: localDateStartIso(customStart),
      endDate: localDateExclusiveEndIso(customEnd),
    };
  }
  if (range === "today") {
    return { startDate: today.toISOString(), endDate: addDays(today, 1).toISOString() };
  }
  if (range === "yesterday") {
    return { startDate: addDays(today, -1).toISOString(), endDate: today.toISOString() };
  }
  const days = range === "last30" ? 30 : range === "last90" ? 90 : 7;
  return { startDate: addDays(today, -(days - 1)).toISOString(), endDate: addDays(today, 1).toISOString() };
}

function readStoredBoolean(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return defaultValue;
}

function describeGreetingFailure(message: string): GreetingErrorState {
  const normalized = message.toLowerCase();
  if (normalized.includes("json") || normalized.includes("parse") || normalized.includes("schema")) {
    return {
      title: "结构化输出解析失败",
      hint: "模型返回的打招呼文案不符合 JSON 或字段约束。请重试，或在设置中降低 Temperature / 切换支持 JSON 输出的模型。",
      message,
    };
  }
  if (normalized.includes("openai request failed") || normalized.includes("http ")) {
    return {
      title: "模型接口请求失败",
      hint: "请检查 Base URL、模型名、API Key、接口模式和本地 Ollama 服务状态，然后重试。",
      message,
    };
  }
  if (normalized.includes("missing openai_api_key")) {
    return {
      title: "缺少 API Key",
      hint: "请在设置中保存 API Key；Ollama 本地接口可应用 Ollama 预设后重试。",
      message,
    };
  }
  if (normalized.includes("简历匹配报告") || normalized.includes("当前情况说明")) {
    return {
      title: "缺少候选人证据",
      hint: "请先在 AI 页生成该岗位的简历匹配报告，或在设置/AI 页保存简历与当前情况说明后重试。",
      message,
    };
  }
  return {
    title: "打招呼文案生成失败",
    hint: "可以调整简历上下文或模型配置后重试；不会自动发送消息。",
    message,
  };
}

function describeAiCompanyScoreFailure(message: string): AiCompanyScoreErrorState {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("json") ||
    normalized.includes("parse") ||
    normalized.includes("schema") ||
    message.includes("结果解析失败") ||
    message.includes("输出不符合")
  ) {
    return {
      title: "AI 公司评分结构化输出解析失败",
      hint: "模型返回的公司评分不符合 JSON 或字段约束。请重试，或在设置中降低 Temperature / 切换支持 JSON 输出的模型。",
      message,
    };
  }
  if (normalized.includes("openai request failed") || normalized.includes("http ")) {
    return {
      title: "模型接口请求失败",
      hint: "请检查 Base URL、模型名、API Key、接口模式和本地 Ollama 服务状态，然后重试。",
      message,
    };
  }
  if (normalized.includes("missing openai_api_key")) {
    return {
      title: "缺少 API Key",
      hint: "请在设置中保存 API Key；Ollama 本地接口可应用 Ollama 预设后重试。",
      message,
    };
  }
  if (message.includes("暂无可生成 AI 公司评分")) {
    return {
      title: "暂无可评分公司",
      hint: "请先采集岗位、保存采后规则并重算候选队列，再重试 AI 公司评分。",
      message,
    };
  }
  return {
    title: "AI 公司评分失败",
    hint: "可以调整模型配置或刷新候选队列后重试；不会自动联系公司或投递。",
    message,
  };
}

function formatPacketScore(score?: number | null): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "待分析";
  return `${Math.round(score)}`;
}

function formatSourceTrace(job: JobRow): string {
  const platform = job.source_platform?.trim() || "boss";
  const dedupKey = job.dedup_key?.trim() || job.encrypt_job_id;
  return `${platform} / 去重 ${dedupKey} / 采集 ${formatDate(job.last_seen_at)}`;
}

function formatCommunicationTrace(job: JobRow): string {
  const statusLabel = communicationStatusLabel(job.communication_status);
  const parts = [statusLabel];
  if (job.last_greeted_at) parts.push(`上次打招呼 ${formatDate(job.last_greeted_at)}`);
  if (job.review_updated_at) parts.push(`更新 ${formatDate(job.review_updated_at)}`);
  const notes = job.review_notes?.trim();
  if (notes) parts.push(`备注 ${notes}`);
  return parts.join(" / ");
}

function formatApplicationFilterTrace(job: JobRow): string {
  const reason = parseFilterReasonJson(job.filter_reason_json);
  if (!reason) return "暂无筛选规则结果";
  const summary = formatFilterReasonSummary(reason);
  if (reason.eligible === true && (summary === "不满足筛选画像" || summary === "不满足筛选规则")) {
    return "通过筛选规则";
  }
  if (reason.eligible === true) {
    return `通过筛选规则；${summary}`;
  }
  return summary;
}

function isProcessedJob(job: JobRow): boolean {
  return (
    !!job.review_status && job.review_status !== "pending"
  ) || (
    !!job.communication_status && job.communication_status !== "not_contacted"
  ) || !!job.review_notes?.trim()
    || (!!job.company_review_status && job.company_review_status !== "pending")
    || job.company_blacklisted
    || job.job_blacklisted
    || job.keyword_blacklisted;
}

function buildApplicationChecklist(job: JobRow, greetingDraft?: string): string[] {
  const hasResumeReport = typeof job.resume_match_score === "number" && Number.isFinite(job.resume_match_score);
  const hasGreetingDraft = !!greetingDraft?.trim();
  return [
    `人工确认：${job.review_status === "ready_to_apply" || job.review_status === "applied" ? reviewStatusLabel(job.review_status) : "待标记准备投递"}`,
    `采后规则：${formatApplicationFilterTrace(job)}`,
    `简历匹配报告：${hasResumeReport ? `Resume ${formatPacketScore(job.resume_match_score)}` : "待分析"}`,
    `打招呼草稿：${hasGreetingDraft ? "已生成可编辑" : "待 AI 生成或手动粘贴"}`,
    "手动使用：复制后人工发送，不会自动发送或投递",
  ];
}

function buildApplicationReadinessGaps(job: JobRow, greetingDraft?: string): string[] {
  const gaps: string[] = [];
  const hasResumeReport = typeof job.resume_match_score === "number" && Number.isFinite(job.resume_match_score);
  const hasGreetingDraft = !!greetingDraft?.trim();
  const filterReason = parseFilterReasonJson(job.filter_reason_json);

  if (job.review_status !== "ready_to_apply" && job.review_status !== "applied") {
    gaps.push("人工确认：尚未标记准备投递");
  }
  if (job.filter_eligible === false || filterReason?.eligible === false) {
    gaps.push(`采后规则：${formatApplicationFilterTrace(job)}`);
  }
  if (!hasResumeReport) {
    gaps.push("简历匹配报告：尚未生成 Resume Match 证据");
  }
  if (!hasGreetingDraft) {
    gaps.push("打招呼草稿：尚未生成或粘贴可编辑草稿");
  }

  return gaps;
}

function formatApplicationReadinessPreflight(
  job: JobRow,
  greetingDraft?: string,
): string {
  const gaps = buildApplicationReadinessGaps(job, greetingDraft);
  if (gaps.length === 0) {
    return "关键材料已就绪；仍需人工核对原平台动作，不会自动发送或投递。";
  }
  return [`仍有 ${gaps.length} 项待补齐：`, ...gaps.map((gap) => `- ${gap}`)].join("\n");
}

function buildGreetingEvidenceTrace(greeting?: GreetingMessageResult): string {
  if (!greeting) return "尚未生成 AI 文案证据";
  const lines = [
    greeting.overlapKeywords.length > 0 ? `技术交集：${greeting.overlapKeywords.join("、")}` : null,
    greeting.jobEvidence.length > 0 ? `岗位依据：${greeting.jobEvidence.join("；")}` : null,
    greeting.candidateEvidence.length > 0 ? `候选人依据：${greeting.candidateEvidence.join("；")}` : null,
    greeting.editNotes.length > 0 ? `编辑提示：${greeting.editNotes.join("；")}` : null,
  ];
  return lines.filter((line): line is string => !!line).join("\n") || "尚未生成 AI 文案证据";
}

function buildResumeMatchEvidenceTrace(scoreReasonJson: string | null | undefined): string {
  return formatResumeMatchEvidence(parseScoreReasonJson(scoreReasonJson));
}

function buildApplicationPacket(
  job: JobRow,
  greetingDraft?: string,
  greeting?: GreetingMessageResult,
): string {
  const trimmedGreeting = greetingDraft?.trim();
  const scoreReason = parseScoreReasonJson(job.score_reason_json);
  const scoreSummary = formatScoreReasonSummary(scoreReason);
  const checklist = buildApplicationChecklist(job, trimmedGreeting).map((item) => `- ${item}`).join("\n");
  const readinessPreflight = formatApplicationReadinessPreflight(job, trimmedGreeting);
  return [
    "【JobPilot 投递材料包】",
    `岗位：${job.position_name ?? job.encrypt_job_id}`,
    `公司：${job.brand_name ?? "未知"}`,
    `城市/薪资：${job.city_name ?? "未知"} / ${job.salary_desc ?? "未知"}`,
    `经验/学历：${job.experience_name ?? "未知"} / ${job.degree_name ?? "未知"}`,
    `审核状态：${reviewStatusLabel(job.review_status)}`,
    `沟通状态：${communicationStatusLabel(job.communication_status)}`,
    `沟通追踪：${formatCommunicationTrace(job)}`,
    `判断：Final ${formatPacketScore(job.final_score)}，Resume ${formatPacketScore(job.resume_match_score)}，Preference ${formatPacketScore(job.preference_score)}，Company ${formatPacketScore(job.company_score)}`,
    `判断依据：${scoreSummary}`,
    `Resume Match 证据：\n${buildResumeMatchEvidenceTrace(job.score_reason_json)}`,
    `筛选依据：${formatApplicationFilterTrace(job)}`,
    `来源追踪：${formatSourceTrace(job)}`,
    `来源链接：${jobSourceUrl(job)}`,
    `投递准备预检：\n${readinessPreflight}`,
    `投递准备清单：\n${checklist}`,
    `打招呼草稿：${trimmedGreeting || "尚未生成或粘贴，请先点击“定制打招呼”或手动填写。"}`,
    `打招呼证据：\n${buildGreetingEvidenceTrace(greeting)}`,
    "使用边界：仅供人工确认、复制和手动投递；不会自动发送或投递。",
  ].join("\n");
}

function buildReadyToApplyConfirmationMessage(
  job: JobRow,
  greetingDraft?: string,
): string {
  const resumeMatchEvidence = buildResumeMatchEvidenceTrace(job.score_reason_json);
  const resumeTrace =
    typeof job.resume_match_score === "number" && Number.isFinite(job.resume_match_score)
      ? `Resume ${formatPacketScore(job.resume_match_score)}`
      : "待分析，建议先生成简历匹配报告";
  const checklist = buildApplicationChecklist(job, greetingDraft).map((item) => `- ${item}`).join("\n");
  const readinessPreflight = formatApplicationReadinessPreflight(job, greetingDraft);
  return [
    `确认将「${job.position_name ?? job.encrypt_job_id}」标记为准备投递？`,
    `简历匹配报告：${resumeTrace}`,
    `Resume Match 证据：\n${resumeMatchEvidence}`,
    `采后规则：${formatApplicationFilterTrace(job)}`,
    `判断：Final ${formatPacketScore(job.final_score)}，Preference ${formatPacketScore(job.preference_score)}，Company ${formatPacketScore(job.company_score)}`,
    `投递准备预检：\n${readinessPreflight}`,
    `投递准备清单：\n${checklist}`,
    "后续仍需人工核对最终简历/PDF、打招呼文案和原平台动作；该操作只记录本地准备投递状态，不会自动发送或投递。",
  ].join("\n");
}

interface ApplicationReadySummaryEntry {
  job: JobRow;
  greetingDraft?: string;
  greeting?: GreetingMessageResult;
}

function buildApplicationReadyJobSummary(entry: ApplicationReadySummaryEntry): string {
  const { job, greetingDraft, greeting } = entry;
  const checklist = buildApplicationChecklist(job, greetingDraft)
    .map((item) => `- ${item}`)
    .join("\n");
  return [
    `岗位：${job.position_name ?? job.encrypt_job_id}`,
    `公司：${job.brand_name ?? "未知"} / ${job.city_name ?? "未知城市"}`,
    `来源：${formatSourceTrace(job)}`,
    `判断：Final ${formatPacketScore(job.final_score)}，Resume ${formatPacketScore(job.resume_match_score)}，Preference ${formatPacketScore(job.preference_score)}，Company ${formatPacketScore(job.company_score)}`,
    `Resume Match 证据：\n${buildResumeMatchEvidenceTrace(job.score_reason_json)}`,
    `沟通状态：${formatCommunicationTrace(job)}`,
    `来源链接：${jobSourceUrl(job)}`,
    `投递准备预检：\n${formatApplicationReadinessPreflight(job, greetingDraft)}`,
    `投递前清单：\n${checklist}`,
    `打招呼证据：\n${buildGreetingEvidenceTrace(greeting)}`,
  ].join("\n");
}

function buildApplicationReadyJobsSummary(entries: ApplicationReadySummaryEntry[]): string {
  if (entries.length === 0) return "暂无准备投递岗位。";
  const items = entries
    .slice(0, 20)
    .map((entry, index) => `#${index + 1}\n${buildApplicationReadyJobSummary(entry)}`)
    .join("\n\n");
  return [
    "【JobPilot 投递准备清单】",
    "这些岗位已由用户人工标记为准备投递；请逐项核对简历、PDF、打招呼文案和外部平台动作。",
    items,
    "使用边界：仅供人工复制、核对和手动投递；不会自动发送、开聊或投递。",
  ].join("\n\n");
}

function buildReviewCandidateSummary(job: JobRow): string {
  const scoreSummary = formatScoreReasonSummary(parseScoreReasonJson(job.score_reason_json));
  return [
    `岗位：${job.position_name ?? job.encrypt_job_id}`,
    `公司：${job.brand_name ?? "未知"} / ${job.city_name ?? "未知城市"}`,
    `薪资/经验/学历：${job.salary_desc ?? "未知"} / ${job.experience_name ?? "未知"} / ${job.degree_name ?? "未知"}`,
    `审核状态：${reviewStatusLabel(job.review_status)}；沟通追踪：${formatCommunicationTrace(job)}`,
    `判断：Final ${formatPacketScore(job.final_score)}，Resume ${formatPacketScore(job.resume_match_score)}，Preference ${formatPacketScore(job.preference_score)}，Company ${formatPacketScore(job.company_score)}`,
    `判断依据：${scoreSummary}`,
    `Resume Match 证据：\n${buildResumeMatchEvidenceTrace(job.score_reason_json)}`,
    `采后规则：${formatApplicationFilterTrace(job)}`,
    `来源追踪：${formatSourceTrace(job)}`,
    `来源链接：${jobSourceUrl(job)}`,
    `下一步：人工查看岗位详情，必要时生成 AI 匹配报告、定制简历或标记准备投递。`,
  ].join("\n");
}

function buildReviewCandidatesSummary(jobs: JobRow[]): string {
  if (jobs.length === 0) return "暂无 Top 20 候选岗位。";
  const items = jobs
    .slice(0, 20)
    .map((job, index) => `#${index + 1}\n${buildReviewCandidateSummary(job)}`)
    .join("\n\n");
  return [
    "【JobPilot Top 20 人工审核摘要】",
    "这些岗位已通过当前采后规则、黑名单和沟通状态过滤，并按综合评分排序；仅供人工研究和确认。",
    items,
    "使用边界：复制后人工查看、编辑和决定，不会自动发送、开聊或投递。",
  ].join("\n\n");
}

function buildFilteredJobSummary(job: JobRow): string {
  const filterSummary = formatFilterReasonSummary(parseFilterReasonJson(job.filter_reason_json));
  const lines = [
    `岗位：${job.position_name ?? job.encrypt_job_id}`,
    `公司：${job.brand_name ?? "未知"}`,
    `城市/薪资：${job.city_name ?? "未知"} / ${job.salary_desc ?? "未知"}`,
    `过滤解释：${filterSummary}`,
    job.company_blacklisted || job.job_blacklisted || job.keyword_blacklisted
      ? `黑名单：${job.blacklist_reason ?? "已命中黑名单"}`
      : null,
    job.review_status && job.review_status !== "pending"
      ? `审核状态：${reviewStatusLabel(job.review_status)}`
      : null,
    job.communication_status && job.communication_status !== "not_contacted"
      ? `沟通追踪：${formatCommunicationTrace(job)}`
      : null,
    job.company_review_status && job.company_review_status !== "pending"
      ? `公司判断：${companyReviewStatusLabel(job.company_review_status)}`
      : null,
    `判断：Final ${formatPacketScore(job.final_score)}，Resume ${formatPacketScore(job.resume_match_score)}，Preference ${formatPacketScore(job.preference_score)}，Company ${formatPacketScore(job.company_score)}`,
    `来源追踪：${formatSourceTrace(job)}`,
    `来源链接：${jobSourceUrl(job)}`,
  ];
  return lines.filter((line): line is string => !!line).join("\n");
}

function buildFilteredJobsSummary(jobs: JobRow[]): string {
  if (jobs.length === 0) return "暂无被过滤岗位。";
  const items = jobs
    .slice(0, 20)
    .map((job, index) => `#${index + 1}\n${buildFilteredJobSummary(job)}`)
    .join("\n\n");
  return [
    "【JobPilot 最近过滤解释】",
    "这些岗位当前不会进入 Top 20；可调整采后规则、沟通状态或黑名单后重新计算。",
    items,
    "使用边界：仅用于人工复盘筛选结果；不会自动发送或投递。",
  ].join("\n\n");
}

function buildCommunicationFollowupJobSummary(job: JobRow): string {
  const lines = [
    `岗位：${job.position_name ?? job.encrypt_job_id}`,
    `公司：${job.brand_name ?? "未知"} / ${job.city_name ?? "未知城市"}`,
    `薪资/经验/学历：${job.salary_desc ?? "未知"} / ${job.experience_name ?? "未知"} / ${job.degree_name ?? "未知"}`,
    `审核状态：${reviewStatusLabel(job.review_status)}`,
    `沟通复盘：${formatCommunicationTrace(job)}`,
    job.company_negative_communication_count > 0
      ? `同公司负面沟通：${job.company_negative_communication_count} 次；最近 ${communicationStatusLabel(job.latest_company_negative_communication_status)} / ${formatDate(job.latest_company_negative_communication_at)}`
      : null,
    job.company_review_status && job.company_review_status !== "pending"
      ? `公司判断：${companyReviewStatusLabel(job.company_review_status)}`
      : null,
    job.company_blacklisted || job.job_blacklisted || job.keyword_blacklisted
      ? `黑名单：${job.blacklist_reason ?? "已命中黑名单"}`
      : null,
    `采后规则：${formatApplicationFilterTrace(job)}`,
    `判断：Final ${formatPacketScore(job.final_score)}，Resume ${formatPacketScore(job.resume_match_score)}，Preference ${formatPacketScore(job.preference_score)}，Company ${formatPacketScore(job.company_score)}`,
    `来源追踪：${formatSourceTrace(job)}`,
    `来源链接：${jobSourceUrl(job)}`,
    "下一步：人工复盘沟通结果，必要时补备注、拉黑公司/职位或恢复候选；不会自动发送或投递。",
  ];
  return lines.filter((line): line is string => !!line).join("\n");
}

function buildCommunicationFollowupJobsSummary(jobs: JobRow[]): string {
  if (jobs.length === 0) return "暂无沟通回溯记录。";
  const items = jobs
    .slice(0, 20)
    .map((job, index) => `#${index + 1}\n${buildCommunicationFollowupJobSummary(job)}`)
    .join("\n\n");
  return [
    "【JobPilot 沟通回溯摘要】",
    "这些岗位已产生沟通、投递或备注记录；用于人工复盘后续处理，不会自动开聊、发送或投递。",
    items,
    "使用边界：仅供人工复制、核对和本地记录；不会自动发送、开聊或投递。",
  ].join("\n\n");
}

export function useJobsPage() {
  const tauri = isTauri();
  const DAILY_INTELLIGENCE_AUTO_NOTIFY_KEY = "job-sync.daily-intelligence.auto-notify";
  const DAILY_INTELLIGENCE_AUTO_NOTIFY_LAST_KEY = "job-sync.daily-intelligence.auto-notify.last-report-date";
  const search = ref("");
  const loading = ref(false);
  const error = ref<string | null>(null);
  const groups = ref<KeywordGroup[]>([]);
  const flatResults = ref<JobRow[]>([]);
  const jobCandidates = ref<JobRow[]>([]);
  const jobCandidatesTotal = ref(0);
  const jobCandidatesLoading = ref(false);
  const jobCandidateSearch = ref("");
  const jobCandidatePage = ref(1);
  const jobCandidatePageSize = ref(20);
  const jobCandidateTimeRange = ref<JobTimeRange>("last7");
  const jobCandidateCustomStartDate = ref(localDateInputValue(addDays(new Date(), -6)));
  const jobCandidateCustomEndDate = ref(localDateInputValue(new Date()));
  const jobCandidateProcessedFilter = ref<ProcessedFilter>("all");
  const jobCandidateBucket = ref<JobCandidateBucket>("all");
  const selectedJobStatusFilters = ref<JobStatusFilter[]>([]);
  const selectedAiAuditFilters = ref<Array<"ai_passed" | "ai_rejected" | "ai_pending">>([]);
  const selectedSourcePlatformFilters = ref<string[]>([]);
  const selectedCollectionMethodFilters = ref<CollectionMethod[]>([]);
  const reviewCandidates = ref<JobRow[]>([]);
  const favoritedJobs = ref<JobRow[]>([]);
  const applicationReadyJobs = ref<JobRow[]>([]);
  const communicationFollowupJobs = ref<JobRow[]>([]);
  const filteredJobs = ref<JobRow[]>([]);
  const dailyIntelligence = ref<JobDailyIntelligence | null>(null);
  const dailyIntelligenceAutoNotifyEnabled = ref(readStoredBoolean(DAILY_INTELLIGENCE_AUTO_NOTIFY_KEY, false));
  const dailyIntelligenceExternalMessage = ref<string | null>(null);
  const dailyIntelligenceTelegramSending = ref(false);
  const blacklistEntries = ref<JobBlacklistEntry[]>([]);
  const filterProfileUpdatedAt = ref<string | null>(null);
  const filterProfileLoading = ref(false);
  const filterRecomputing = ref(false);
  const filterRecomputeMessage = ref<string | null>(null);
  const pendingEvidenceRefreshingJobId = ref<string | null>(null);
  const pendingEvidenceRefreshMessage = ref<string | null>(null);
  const isSearchMode = ref(false);
  const reviewCandidatesLoading = ref(false);
  const favoritedJobsLoading = ref(false);
  const applicationReadyJobsLoading = ref(false);
  const communicationFollowupJobsLoading = ref(false);
  const filteredJobsLoading = ref(false);
  const bossChatStatusSyncing = ref(false);
  const bossChatStatusSyncMessage = ref<string | null>(null);
  const dailyIntelligenceLoading = ref(false);
  const companyScoreRebuilding = ref(false);
  const companyScoreRebuildMessage = ref<string | null>(null);
  const aiCompanyScoreGenerating = ref(false);
  const aiCompanyScoreMessage = ref<string | null>(null);
  const aiCompanyScoreError = ref<AiCompanyScoreErrorState | null>(null);
  const blacklistLoading = ref(false);
  const expandedKeyword = ref<string | null>(null);
  const expandedJobId = ref<string | null>(null);
  const keywordJobsCache = reactive<Map<string, JobRow[]>>(new Map());
  const keywordJobsLoading = ref<string | null>(null);
  const detailCache = reactive<Map<string, JobDetail | null>>(new Map());
  const detailLoading = ref<string | null>(null);
  const greetingCache = reactive<Map<string, GreetingMessageResult>>(new Map());
  const greetingDrafts = reactive<Map<string, string>>(new Map());
  const greetingErrors = reactive<Map<string, GreetingErrorState>>(new Map());
  const greetingLoading = ref<string | null>(null);
  const filterProfileState = useFilterProfile();
  const confirmDialog = reactive<ConfirmDialogState>({
    visible: false,
    title: "",
    message: "",
    confirmLabel: "确认",
    loading: false,
    action: null,
  });
  let isPageActive = true;
  let hasBeenDeactivated = false;
  let refreshTimer: number | null = null;
  let pendingRealtimeRefresh = false;

  const expandedDetail = computed<JobDetail | null>(() => {
    if (!expandedJobId.value) return null;
    return detailCache.get(expandedJobId.value) ?? null;
  });
  const jobCandidateTotalPages = computed(() => Math.max(1, Math.ceil(jobCandidatesTotal.value / jobCandidatePageSize.value)));
  const jobCandidateOffset = computed(() => (jobCandidatePage.value - 1) * jobCandidatePageSize.value);
  const jobIntelligenceRangeLabel = computed(() => {
    if (jobCandidateTimeRange.value !== "custom") {
      return JOB_TIME_RANGE_OPTIONS.find((option) => option.value === jobCandidateTimeRange.value)?.label ?? "最近7天";
    }
    const start = jobCandidateCustomStartDate.value || "开始";
    const end = jobCandidateCustomEndDate.value || "结束";
    return `${start} 至 ${end}`;
  });
  const currentPageProcessedCount = computed(() => jobCandidates.value.filter(isProcessedJob).length);
  const currentPageUnprocessedCount = computed(() => jobCandidates.value.length - currentPageProcessedCount.value);

  async function syncBossChatStatus(): Promise<void> {
    error.value = null;
    bossChatStatusSyncMessage.value = null;
    if (!tauri) return;
    bossChatStatusSyncing.value = true;
    const beforeCount = runtime.bossChatStatusSyncedCount;
    const stop = watch(
      () => runtime.finishedCounter,
      () => {
        stop();
        bossChatStatusSyncing.value = false;
        const synced = runtime.bossChatStatusSyncedCount - beforeCount;
        bossChatStatusSyncMessage.value = synced > 0 ? `已同步 ${synced} 个 Boss 沟通状态。` : "未同步到可关联岗位的 Boss 聊天状态。";
      },
    );
    try {
      runtime.sidecarTask.running = true;
      runtime.sidecarTask.type = CRAWL_TASK_TYPE_CHAT_SYNC;
      await invoke<void>("sync_boss_chat_status");
      bossChatStatusSyncMessage.value = "正在读取 Boss 聊天页…";
    } catch (cause) {
      stop();
      error.value = cause instanceof Error ? cause.message : String(cause);
      bossChatStatusSyncing.value = false;
      if (runtime.sidecarTask.type === CRAWL_TASK_TYPE_CHAT_SYNC) {
        runtime.sidecarTask.running = false;
        runtime.sidecarTask.type = undefined;
      }
      return;
    }
  }
  function scheduleRealtimeRefresh(): void {
    if (!tauri || !canScheduleRealtimeRefresh(loading.value, isPageActive)) {
      pendingRealtimeRefresh = true;
      return;
    }
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void loadJobCandidates({ keepPage: true });
    }, JOBS_REALTIME_REFRESH_DELAY_MS);
  }
  function showConfirm(
    title: string,
    message: string,
    action: () => Promise<void>,
    confirmLabel = "确认删除",
  ): void {
    confirmDialog.title = title;
    confirmDialog.message = message;
    confirmDialog.confirmLabel = confirmLabel;
    confirmDialog.action = action;
    confirmDialog.loading = false;
    confirmDialog.visible = true;
  }
  function closeConfirm(): void {
    confirmDialog.visible = false;
    confirmDialog.action = null;
    confirmDialog.loading = false;
  }
  async function executeConfirm(): Promise<void> {
    if (!confirmDialog.action) return;
    confirmDialog.loading = true;
    try {
      await confirmDialog.action();
    } finally {
      closeConfirm();
    }
  }
  async function loadKeywords(options: LoadKeywordOptions = {}): Promise<void> {
    error.value = null;
    if (!tauri) return;
    loading.value = true;
    const preserveExpanded = options.preserveExpanded === true;
    const prevExpandedKeyword = expandedKeyword.value;
    const prevExpandedJobId = expandedJobId.value;
    if (!preserveExpanded) {
      expandedKeyword.value = null;
      expandedJobId.value = null;
    }

    const term = search.value.trim() || null;
    isSearchMode.value = !!term;

    try {
      const [nextGroups, nextFlatResults] = await Promise.all([
        invoke<KeywordGroup[]>("list_source_keywords", { search: term }),
        term
          ? invoke<JobRow[]>("list_jobs", { keyword: term, city: null, limit: SEARCH_JOB_LIMIT, offset: 0 })
          : Promise.resolve([]),
      ]);

      groups.value = nextGroups;
      flatResults.value = nextFlatResults;
      await restoreExpandedState(
        { groups, expandedKeyword, expandedJobId, keywordJobsCache, keywordJobsLoading },
        prevExpandedKeyword,
        prevExpandedJobId,
        options,
      );
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
      if (pendingRealtimeRefresh && isPageActive) {
        pendingRealtimeRefresh = false;
        scheduleRealtimeRefresh();
      }
    }
  }
  async function loadJobCandidates(options: { keepPage?: boolean } = {}): Promise<void> {
    error.value = null;
    if (!tauri) return;
    if (!options.keepPage) {
      jobCandidatePage.value = 1;
    }
    const { startDate, endDate } = jobTimeRangeBounds(
      jobCandidateTimeRange.value,
      jobCandidateCustomStartDate.value,
      jobCandidateCustomEndDate.value,
    );
    jobCandidatesLoading.value = true;
    try {
      const page = await invoke<JobCandidatePage>("list_job_candidates", {
        bucket: jobCandidateBucket.value,
        query: jobCandidateSearch.value.trim() || null,
        startDate,
        endDate,
        processed: jobCandidateProcessedFilter.value === "all" ? null : jobCandidateProcessedFilter.value,
        statusFilters: selectedJobStatusFilters.value,
        aiAuditFilters: selectedAiAuditFilters.value,
        sourcePlatforms: selectedSourcePlatformFilters.value,
        collectionMethods: selectedCollectionMethodFilters.value,
        limit: jobCandidatePageSize.value,
        offset: jobCandidateOffset.value,
      });
      jobCandidates.value = page.jobs;
      jobCandidatesTotal.value = page.total;
      if (jobCandidatePage.value > jobCandidateTotalPages.value) {
        jobCandidatePage.value = jobCandidateTotalPages.value;
        await loadJobCandidates({ keepPage: true });
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      jobCandidatesLoading.value = false;
    }
  }
  function toggleJobStatusFilter(value: JobStatusFilter): void {
    selectedJobStatusFilters.value = selectedJobStatusFilters.value.includes(value)
      ? selectedJobStatusFilters.value.filter((item) => item !== value)
      : [...selectedJobStatusFilters.value, value];
    void loadJobCandidates();
  }
  function toggleAiAuditFilter(value: "ai_passed" | "ai_rejected" | "ai_pending"): void {
    selectedAiAuditFilters.value = selectedAiAuditFilters.value.includes(value)
      ? selectedAiAuditFilters.value.filter((item) => item !== value)
      : [...selectedAiAuditFilters.value, value];
    void loadJobCandidates();
  }
  function toggleSourcePlatformFilter(value: string): void {
    selectedSourcePlatformFilters.value = selectedSourcePlatformFilters.value.includes(value)
      ? selectedSourcePlatformFilters.value.filter((item) => item !== value)
      : [...selectedSourcePlatformFilters.value, value];
    void loadJobCandidates();
  }
  function toggleCollectionMethodFilter(value: CollectionMethod): void {
    selectedCollectionMethodFilters.value = selectedCollectionMethodFilters.value.includes(value)
      ? selectedCollectionMethodFilters.value.filter((item) => item !== value)
      : [...selectedCollectionMethodFilters.value, value];
    void loadJobCandidates();
  }
  function clearJobCandidateFilters(): void {
    jobCandidateSearch.value = "";
    jobCandidateTimeRange.value = "last7";
    jobCandidateCustomStartDate.value = localDateInputValue(addDays(new Date(), -6));
    jobCandidateCustomEndDate.value = localDateInputValue(new Date());
    jobCandidateProcessedFilter.value = "all";
    jobCandidateBucket.value = "all";
    selectedJobStatusFilters.value = [];
    selectedAiAuditFilters.value = [];
    selectedSourcePlatformFilters.value = [];
    selectedCollectionMethodFilters.value = [];
    void loadJobCandidates();
  }

  function goJobCandidatePage(page: number): void {
    const nextPage = Math.min(Math.max(page, 1), jobCandidateTotalPages.value);
    if (nextPage === jobCandidatePage.value) return;
    jobCandidatePage.value = nextPage;
    void loadJobCandidates({ keepPage: true });
  }
  async function loadReviewCandidates(): Promise<void> {
    if (!tauri) return;
    reviewCandidatesLoading.value = true;
    try {
      reviewCandidates.value = await invoke<JobRow[]>("list_review_candidates", { limit: 20 });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      reviewCandidatesLoading.value = false;
    }
  }
  async function loadFavoritedJobs(): Promise<void> {
    if (!tauri) return;
    favoritedJobsLoading.value = true;
    try {
      favoritedJobs.value = await invoke<JobRow[]>("list_favorited_jobs", { limit: 20 });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      favoritedJobsLoading.value = false;
    }
  }
  async function loadApplicationReadyJobs(): Promise<void> {
    if (!tauri) return;
    applicationReadyJobsLoading.value = true;
    try {
      applicationReadyJobs.value = await invoke<JobRow[]>("list_application_ready_jobs", { limit: 20 });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      applicationReadyJobsLoading.value = false;
    }
  }
  async function loadCommunicationFollowupJobs(): Promise<void> {
    if (!tauri) return;
    communicationFollowupJobsLoading.value = true;
    try {
      communicationFollowupJobs.value = await invoke<JobRow[]>("list_communication_followup_jobs", { limit: 20 });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      communicationFollowupJobsLoading.value = false;
    }
  }
  async function loadFilteredJobs(): Promise<void> {
    if (!tauri) return;
    filteredJobsLoading.value = true;
    try {
      filteredJobs.value = await invoke<JobRow[]>("list_filtered_jobs", { limit: 20 });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      filteredJobsLoading.value = false;
    }
  }
  async function loadDailyIntelligence(): Promise<void> {
    if (!tauri) return;
    dailyIntelligenceLoading.value = true;
    try {
      dailyIntelligence.value = await invoke<JobDailyIntelligence>("get_daily_job_intelligence", {
        reportDate: null,
      });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      dailyIntelligenceLoading.value = false;
    }
  }
  async function loadJobBlacklist(): Promise<void> {
    if (!tauri) return;
    blacklistLoading.value = true;
    try {
      blacklistEntries.value = await invoke<JobBlacklistEntry[]>("list_job_blacklist", { kind: null });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      blacklistLoading.value = false;
    }
  }
  async function loadDefaultFilterProfile(): Promise<ReturnType<typeof filterProfileState.loadDefaultFilterProfile>> {
    if (!tauri) return null;
    filterProfileLoading.value = true;
    try {
      const profile = await filterProfileState.loadDefaultFilterProfile();
      filterProfileUpdatedAt.value = profile?.updated_at ?? null;
      return profile;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return null;
    } finally {
      filterProfileLoading.value = false;
    }
  }
  async function selectFilterProfile(profileId: string): Promise<void> {
    if (!tauri) return;
    filterProfileLoading.value = true;
    try {
      const profile = await filterProfileState.selectFilterProfile(profileId);
      filterProfileUpdatedAt.value = profile?.updated_at ?? filterProfileUpdatedAt.value;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      filterProfileLoading.value = false;
    }
  }
  async function saveActiveFilterProfile(): Promise<void> {
    if (!tauri) return;
    filterProfileLoading.value = true;
    filterRecomputeMessage.value = null;
    try {
      const profile = await filterProfileState.saveActiveFilterProfile();
      filterProfileUpdatedAt.value = profile?.updated_at ?? filterProfileUpdatedAt.value;
      filterRecomputeMessage.value = "已保存采后规则";
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      filterProfileLoading.value = false;
    }
  }
  async function createFilterProfile(): Promise<void> {
    if (!tauri) return;
    filterProfileLoading.value = true;
    filterRecomputeMessage.value = null;
    try {
      const profile = await filterProfileState.createFilterProfile();
      filterProfileUpdatedAt.value = profile?.updated_at ?? filterProfileUpdatedAt.value;
      filterRecomputeMessage.value = "已新建采后规则";
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      filterProfileLoading.value = false;
    }
  }
  async function setActiveFilterProfileAsDefault(): Promise<void> {
    if (!tauri) return;
    filterProfileLoading.value = true;
    filterRecomputing.value = true;
    filterRecomputeMessage.value = null;
    try {
      const profile = await filterProfileState.setActiveFilterProfileAsDefault();
      filterProfileUpdatedAt.value = profile?.updated_at ?? filterProfileUpdatedAt.value;
      const result = await invoke<RecomputeFilterProfileResult>("recompute_default_filter_profile");
      const aiResult = await recomputeAiPostCollectionJudgementForAllJobs();
      filterRecomputeMessage.value = `已设为默认规则，并重算普通+AI：普通规则 ${result.updated} 个职位；${formatAiPostCollectionJudgeSummary(aiResult)}`;
      await refreshAfterJobStateChange(false);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      filterRecomputing.value = false;
      filterProfileLoading.value = false;
    }
  }
  async function recomputeDefaultFilterProfile(): Promise<void> {
    error.value = null;
    filterRecomputeMessage.value = null;
    if (!tauri) return;
    filterRecomputing.value = true;
    try {
      const result = await filterProfileState.recomputeDefaultFilterProfile();
      if (result) {
        const aiResult = await recomputeAiPostCollectionJudgementForAllJobs();
        filterRecomputeMessage.value = `已重算普通+AI：普通规则 ${result.updated} 个职位；${formatAiPostCollectionJudgeSummary(aiResult)}`;
      }
      const profile = await loadDefaultFilterProfile();
      filterProfileUpdatedAt.value = profile?.updated_at ?? filterProfileUpdatedAt.value;
      await refreshAfterJobStateChange(false);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      filterRecomputing.value = false;
    }
  }
  async function rebuildCompanyScores(): Promise<void> {
    error.value = null;
    companyScoreRebuildMessage.value = null;
    aiCompanyScoreMessage.value = null;
    aiCompanyScoreError.value = null;
    if (!tauri) return;
    companyScoreRebuilding.value = true;
    try {
      const result = await invoke<CompanyScoreRebuildResult>("rebuild_company_scores");
      companyScoreRebuildMessage.value = `已重建 ${result.companies} 家公司评分，覆盖 ${result.jobs} 个岗位`;
      await refreshAfterJobStateChange(false);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      companyScoreRebuilding.value = false;
    }
  }
  async function generateAiCompanyScores(): Promise<void> {
    error.value = null;
    companyScoreRebuildMessage.value = null;
    aiCompanyScoreMessage.value = null;
    aiCompanyScoreError.value = null;
    if (!tauri) return;
    aiCompanyScoreGenerating.value = true;
    try {
      const result = await invoke<AiCompanyScoreBatchResult>("generate_ai_company_scores", { limit: 20 });
      aiCompanyScoreMessage.value = `AI 已更新 ${result.updated}/${result.companies} 家公司评分，覆盖 ${result.jobs} 个候选岗位${
        result.failed > 0 ? `，${result.failed} 家未更新` : ""
      }`;
      await refreshAfterJobStateChange(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      aiCompanyScoreError.value = describeAiCompanyScoreFailure(message);
      error.value = message;
    } finally {
      aiCompanyScoreGenerating.value = false;
    }
  }
  async function refreshAfterJobStateChange(refreshBlacklist = false): Promise<void> {
    keywordJobsCache.clear();
    detailCache.clear();
    const refreshes: Array<Promise<void>> = [loadJobCandidates({ keepPage: true })];
    if (refreshBlacklist) {
      refreshes.push(loadJobBlacklist());
    }
    await Promise.all(refreshes);
  }
  async function refreshPendingJobEvidence(job: JobRow): Promise<void> {
    error.value = null;
    pendingEvidenceRefreshMessage.value = null;
    if (!tauri) return;
    pendingEvidenceRefreshingJobId.value = job.encrypt_job_id;
    try {
      const result = await invoke<{ encrypt_job_id: string; status: string; message: string }>(
        "refresh_pending_job_evidence",
        { encryptJobId: job.encrypt_job_id },
      );
      pendingEvidenceRefreshMessage.value = result.message;
      detailCache.delete(job.encrypt_job_id);
      await refreshAfterJobStateChange(false);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      pendingEvidenceRefreshingJobId.value = null;
    }
  }
  async function toggleKeyword(group: KeywordGroup): Promise<void> {
    const key = groupKey(group);
    if (expandedKeyword.value === key) {
      expandedKeyword.value = null;
      expandedJobId.value = null;
      return;
    }

    expandedKeyword.value = key;
    expandedJobId.value = null;
    if (keywordJobsCache.has(key)) return;

    keywordJobsLoading.value = key;
    try {
      const jobs = await invoke<JobRow[]>("list_jobs_by_source", { sourceKeyword: group.keyword });
      keywordJobsCache.set(key, jobs);
    } catch {
      keywordJobsCache.set(key, []);
    } finally {
      keywordJobsLoading.value = null;
    }
  }
  async function toggleDetail(id: string): Promise<void> {
    if (expandedJobId.value === id) {
      expandedJobId.value = null;
      return;
    }

    expandedJobId.value = id;
    await loadJobDetail(id);
  }
  async function loadJobDetail(id: string): Promise<void> {
    if (detailCache.get(id)) return;

    detailLoading.value = id;
    try {
      const detail = await invoke<JobDetail | null>("get_job_detail", { encryptJobId: id });
      if (detail) {
        detailCache.set(id, detail);
      }
    } finally {
      detailLoading.value = null;
    }
  }
  async function copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  function updateGreetingDraft(jobId: string, message: string): void {
    greetingDrafts.set(jobId, message);
  }
  async function generateGreeting(job: JobRow): Promise<void> {
    if (!tauri) return;
    error.value = null;
    greetingErrors.delete(job.encrypt_job_id);
    greetingLoading.value = job.encrypt_job_id;
    try {
      const result = await invoke<GreetingMessageResult>("generate_greeting_message", {
        encryptJobId: job.encrypt_job_id,
        resumeText: null,
        contextText: null,
        resumeFiles: null,
        apiKey: null,
        baseUrl: null,
        model: null,
        apiMode: null,
        debug: null,
      });
      greetingCache.set(job.encrypt_job_id, result);
      greetingDrafts.set(job.encrypt_job_id, result.message);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      greetingErrors.set(job.encrypt_job_id, describeGreetingFailure(message));
      error.value = message;
    } finally {
      greetingLoading.value = null;
    }
  }
  async function copyGreeting(job: JobRow): Promise<void> {
    const message = greetingDrafts.get(job.encrypt_job_id)?.trim();
    if (!message) return;
    const copied = await copy(message);
    if (!copied || !tauri) return;
    try {
      await invoke<void>("set_job_review_state", {
        encryptJobId: job.encrypt_job_id,
        reviewStatus: null,
        communicationStatus: "greeted_unread",
        lastGreetedAt: new Date().toISOString(),
        notes: null,
      });
      await refreshAfterJobStateChange();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  async function copyApplicationPacket(job: JobRow): Promise<void> {
    if (job.review_status !== "ready_to_apply" && job.review_status !== "applied") {
      error.value = "请先人工确认岗位并标记为准备投递，再复制投递材料包。";
      return;
    }
    const copied = await copy(
      [buildApplicationPacket(job, greetingDrafts.get(job.encrypt_job_id), greetingCache.get(job.encrypt_job_id)), sourcePlatformModeTrace()].join("\n"),
    );
    if (!copied) {
      error.value = "复制投递材料包失败，请检查剪贴板权限后重试。";
    }
  }
  async function copyApplicationReadySummary(): Promise<void> {
    if (applicationReadyJobs.value.length === 0) {
      error.value = "暂无准备投递岗位可复制。";
      return;
    }

    const entries: ApplicationReadySummaryEntry[] = applicationReadyJobs.value.slice(0, 20).map((job) => ({
      job,
      greetingDraft: greetingDrafts.get(job.encrypt_job_id),
      greeting: greetingCache.get(job.encrypt_job_id),
    }));

    const copied = await copy([buildApplicationReadyJobsSummary(entries), sourcePlatformModeTrace()].join("\n"));
    if (!copied) {
      error.value = "复制投递准备清单失败，请检查剪贴板权限后重试。";
    }
  }
  async function copyReviewCandidatesSummary(): Promise<void> {
    if (reviewCandidates.value.length === 0) {
      error.value = "暂无 Top 20 候选岗位可复制。";
      return;
    }
    const copied = await copy([buildReviewCandidatesSummary(reviewCandidates.value), sourcePlatformModeTrace()].join("\n"));
    if (!copied) {
      error.value = "复制 Top 20 候选摘要失败，请检查剪贴板权限后重试。";
    }
  }
  async function copyCommunicationFollowupSummary(): Promise<void> {
    if (communicationFollowupJobs.value.length === 0) {
      error.value = "暂无沟通回溯记录可复制。";
      return;
    }
    const copied = await copy([buildCommunicationFollowupJobsSummary(communicationFollowupJobs.value), sourcePlatformModeTrace()].join("\n"));
    if (!copied) {
      error.value = "复制沟通回溯摘要失败，请检查剪贴板权限后重试。";
    }
  }
  async function copyDailyIntelligence(): Promise<void> {
    if (!dailyIntelligence.value?.notification_text) return;
    await copy(buildDailyIntelligenceCopyText(dailyIntelligence.value));
  }
  function sourcePlatformModeTrace(): string {
    return `来源策略：${filterProfileState.sourcePlatformModeLabel.value}；${filterProfileState.sourcePlatformModeHint.value}`;
  }
  function buildDailyIntelligenceCopyText(summary: JobDailyIntelligence): string {
    return [summary.notification_text, sourcePlatformModeTrace()].filter(Boolean).join("\n");
  }
  function dailyIntelligenceNotificationBrief(summary: JobDailyIntelligence): string {
    const brief = summary.notification_brief_text?.trim() || summary.notification_text;
    return [brief, sourcePlatformModeTrace()].filter(Boolean).join("\n");
  }
function buildDailyRecommendedCandidateSummary(candidate: JobDailyIntelligenceCandidate): string {
  const platform = candidate.source_platform?.trim() || "boss";
  const sourceKey = candidate.dedup_key?.trim() || candidate.encrypt_job_id;
  const sourceUrl = candidate.source_url?.trim();
  const resumeMatchEvidence = buildResumeMatchEvidenceTrace(candidate.score_reason_json);
  return [
    "【JobPilot 推荐候选摘要】",
    `岗位：${candidate.position_name ?? candidate.encrypt_job_id}`,
    `公司：${candidate.brand_name ?? "未知公司"}`,
    `城市：${candidate.city_name ?? "未知城市"}`,
    `来源：${platform} / 去重 ${sourceKey}`,
    sourceUrl ? `来源链接：${sourceUrl}` : null,
    `判断：Final ${formatPacketScore(candidate.final_score)}，Resume ${formatPacketScore(candidate.resume_match_score)}，Preference ${formatPacketScore(candidate.preference_score)}，Company ${formatPacketScore(candidate.company_score)}`,
    `推荐原因：${candidate.recommendation_reason || "达到当前推荐阈值"}`,
    `Resume Match 证据：\n${resumeMatchEvidence}`,
    `入口：打开 JobPilot 查看 Top 20 人工审核队列并人工确认 ${candidate.encrypt_job_id}`,
    "使用边界：仅供人工复制、研究和确认；不会自动发送或投递。",
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}
  async function copyDailyRecommendedCandidate(candidate: JobDailyIntelligenceCandidate): Promise<void> {
    const copied = await copy(buildDailyRecommendedCandidateSummary(candidate));
    if (!copied) {
      error.value = "复制推荐候选摘要失败，请检查剪贴板权限后重试。";
    }
  }
  function buildDailyIntelligenceMailtoUrl(summary: JobDailyIntelligence): string {
    const subject = `JobPilot 每日岗位情报 ${summary.report_date}`;
    const body = dailyIntelligenceNotificationBrief(summary);
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  async function openDailyIntelligenceEmailDraft(): Promise<void> {
    error.value = null;
    dailyIntelligenceExternalMessage.value = null;
    if (!dailyIntelligence.value?.notification_brief_text && !dailyIntelligence.value?.notification_text) {
      error.value = "暂无每日岗位情报可生成邮件草稿，请先刷新情报。";
      return;
    }

    const url = buildDailyIntelligenceMailtoUrl(dailyIntelligence.value);
    try {
      if (tauri) {
        await openUrl(url);
      } else {
        window.location.href = url;
      }
      dailyIntelligenceExternalMessage.value = "已打开邮件草稿，请在邮件客户端人工确认。";
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      error.value = `打开邮件草稿失败：${message}`;
    }
  }
  async function sendDailyIntelligenceTelegramNotification(): Promise<void> {
    error.value = null;
    dailyIntelligenceExternalMessage.value = null;
    if (!dailyIntelligence.value?.notification_brief_text && !dailyIntelligence.value?.notification_text) {
      error.value = "暂无每日岗位情报可发送，请先刷新情报。";
      return;
    }
    if (!tauri) {
      error.value = "Telegram 通知只在 Tauri 桌面端可用。";
      return;
    }

    dailyIntelligenceTelegramSending.value = true;
    try {
      const result = await invoke<{ report_date: string; channel: "telegram" }>("send_daily_job_intelligence_telegram_notification", {
        reportDate: dailyIntelligence.value.report_date || null,
      });
      dailyIntelligenceExternalMessage.value = `已发送 Telegram 摘要（${result.report_date}）；不会自动投递。`;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      error.value = `发送 Telegram 通知失败：${message}`;
    } finally {
      dailyIntelligenceTelegramSending.value = false;
    }
  }

  async function openJobSourceUrl(job: JobRow): Promise<void> {
    error.value = null;
    const url = jobSourceUrl(job);
    try {
      if (tauri) {
        await openUrl(url);
        return;
      }
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        throw new Error("浏览器阻止了新窗口，请复制来源链接后手动打开。");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      error.value = `打开来源链接失败：${message}`;
    }
  }
  async function copyFilteredJobsSummary(): Promise<void> {
    if (filteredJobs.value.length === 0) {
      error.value = "暂无过滤解释可复制。";
      return;
    }
    const copied = await copy([buildFilteredJobsSummary(filteredJobs.value), sourcePlatformModeTrace()].join("\n"));
    if (!copied) {
      error.value = "复制过滤摘要失败，请检查剪贴板权限后重试。";
    }
  }
  async function ensureDailyIntelligenceNotificationPermission(requestIfNeeded: boolean): Promise<boolean> {
    try {
      let granted = await isPermissionGranted();
      if (!granted && requestIfNeeded) {
        granted = (await requestPermission()) === "granted";
      }
      return granted;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`系统通知权限检查失败：${message}`);
    }
  }
  async function notifyDailyIntelligence(mode: "manual" | "auto"): Promise<boolean> {
    if (!dailyIntelligence.value?.notification_brief_text && !dailyIntelligence.value?.notification_text) {
      if (mode === "manual") error.value = "暂无每日岗位情报可通知，请先刷新情报。";
      return false;
    }
    if (!tauri) {
      if (mode === "manual") error.value = "本机通知只在 Tauri 桌面端可用。";
      return false;
    }
    const reportDate = dailyIntelligence.value.report_date?.trim();
    if (mode === "auto" && (!dailyIntelligenceAutoNotifyEnabled.value || !reportDate)) return false;
    if (mode === "auto" && localStorage.getItem(DAILY_INTELLIGENCE_AUTO_NOTIFY_LAST_KEY) === reportDate) return false;

    let granted = false;
    try {
      granted = await ensureDailyIntelligenceNotificationPermission(mode === "manual");
    } catch (cause) {
      if (mode === "manual") {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
      return false;
    }
    if (!granted) {
      if (mode === "manual") error.value = "未授予系统通知权限，无法发送每日岗位情报本机通知。";
      return false;
    }

    try {
      sendNotification({
        title: "每日岗位情报",
        body: dailyIntelligenceNotificationBrief(dailyIntelligence.value),
      });
    } catch (cause) {
      if (mode === "manual") {
        const message = cause instanceof Error ? cause.message : String(cause);
        error.value = `发送每日岗位情报本机通知失败：${message}`;
      }
      return false;
    }
    if (mode === "auto" && reportDate) {
      localStorage.setItem(DAILY_INTELLIGENCE_AUTO_NOTIFY_LAST_KEY, reportDate);
    }
    return true;
  }
  async function showDailyIntelligenceNotification(): Promise<void> {
    await notifyDailyIntelligence("manual");
  }
  async function enableDailyIntelligenceAutoNotify(): Promise<void> {
    const granted = await ensureDailyIntelligenceNotificationPermission(true);
    if (!granted) {
      dailyIntelligenceAutoNotifyEnabled.value = false;
      localStorage.setItem(DAILY_INTELLIGENCE_AUTO_NOTIFY_KEY, "0");
      error.value = "未授予系统通知权限，已关闭每日岗位情报自动通知。";
      return;
    }
    localStorage.setItem(DAILY_INTELLIGENCE_AUTO_NOTIFY_KEY, "1");
    await notifyDailyIntelligence("auto");
  }
  async function deleteJob(job: JobRow, groupKeyStr: string): Promise<void> {
    const name = job.position_name ?? job.encrypt_job_id;
    showConfirm("删除职位", `确认删除「${name}」？此操作不可撤销。`, async () => {
      try {
        await invoke<void>("delete_job", { encryptJobId: job.encrypt_job_id });
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        return;
      }

      removeJobFromCaches(
        { groups, expandedKeyword, expandedJobId, keywordJobsCache, detailCache },
        job,
        groupKeyStr,
      );
      jobCandidates.value = jobCandidates.value.filter((item) => item.encrypt_job_id !== job.encrypt_job_id);
      jobCandidatesTotal.value = Math.max(0, jobCandidatesTotal.value - 1);
      reviewCandidates.value = reviewCandidates.value.filter((item) => item.encrypt_job_id !== job.encrypt_job_id);
      favoritedJobs.value = favoritedJobs.value.filter((item) => item.encrypt_job_id !== job.encrypt_job_id);
      applicationReadyJobs.value = applicationReadyJobs.value.filter((item) => item.encrypt_job_id !== job.encrypt_job_id);
      communicationFollowupJobs.value = communicationFollowupJobs.value.filter((item) => item.encrypt_job_id !== job.encrypt_job_id);
      filteredJobs.value = filteredJobs.value.filter((item) => item.encrypt_job_id !== job.encrypt_job_id);
    });
  }
  async function deleteAllJobs(): Promise<void> {
    showConfirm(
      "清空全部职位",
      "确认清空全部职位数据？所有职位、详情、AI 报告都将被删除，此操作不可撤销。",
      async () => {
        try {
          await invoke<void>("delete_all_jobs");
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
          return;
        }

        groups.value = [];
        jobCandidates.value = [];
        jobCandidatesTotal.value = 0;
        reviewCandidates.value = [];
        favoritedJobs.value = [];
        applicationReadyJobs.value = [];
        communicationFollowupJobs.value = [];
        filteredJobs.value = [];
        dailyIntelligence.value = null;
        keywordJobsCache.clear();
        detailCache.clear();
        expandedKeyword.value = null;
        expandedJobId.value = null;
        await loadJobBlacklist();
      },
    );
  }
  async function applyReviewStatus(job: JobRow, status: ReviewStatus): Promise<void> {
    try {
      await invoke<void>("set_job_review_state", {
        encryptJobId: job.encrypt_job_id,
        reviewStatus: status,
        communicationStatus: null,
        lastGreetedAt: null,
        notes: null,
      });
      await refreshAfterJobStateChange();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  async function updateReviewStatus(job: JobRow, status: ReviewStatus): Promise<void> {
    if (status === "ready_to_apply") {
      showConfirm(
        "标记准备投递",
        [
          buildReadyToApplyConfirmationMessage(job, greetingDrafts.get(job.encrypt_job_id)),
          sourcePlatformModeTrace(),
        ].join("\n"),
        () => applyReviewStatus(job, status),
        "确认准备投递",
      );
      return;
    }
    if (status === "applied") {
      showConfirm(
        "标记已投递",
        `确认已在外部平台手动完成「${job.position_name ?? job.encrypt_job_id}」投递或沟通？该操作只记录本地已投递状态，不会自动投递。`,
        () => applyReviewStatus(job, status),
        "确认已手动投递",
      );
      return;
    }
    await applyReviewStatus(job, status);
  }
  async function restoreReviewCandidate(job: JobRow): Promise<void> {
    showConfirm(
      "恢复候选",
      `确认将「${job.position_name ?? job.encrypt_job_id}」恢复为待审核和未打招呼？该操作只恢复人工审核状态，岗位仍会继续受采后规则、黑名单和公司状态过滤。`,
      async () => {
        try {
          await invoke<void>("set_job_review_state", {
            encryptJobId: job.encrypt_job_id,
            reviewStatus: "pending",
            communicationStatus: "not_contacted",
            lastGreetedAt: null,
            notes: null,
          });
          await refreshAfterJobStateChange();
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
        }
      },
      "确认恢复",
    );
  }
  async function updateCommunicationStatus(job: JobRow, status: CommunicationStatus): Promise<void> {
    if (status === "manual_not_fit") {
      showConfirm(
        "岗位不合适",
        `确认将「${job.position_name ?? job.encrypt_job_id}」标记为岗位不合适？后续可通过岗位状态筛选查看这类岗位。`,
        async () => {
          try {
            await invoke<void>("set_job_review_state", {
              encryptJobId: job.encrypt_job_id,
              reviewStatus: null,
              communicationStatus: "manual_not_fit",
              lastGreetedAt: null,
              notes: job.review_notes?.trim() || "用户从职位库标记岗位不合适",
            });
            await refreshAfterJobStateChange();
          } catch (cause) {
            error.value = cause instanceof Error ? cause.message : String(cause);
          }
        },
        "标记岗位不合适",
      );
      return;
    }

    try {
      await invoke<void>("set_job_review_state", {
        encryptJobId: job.encrypt_job_id,
        reviewStatus: null,
        communicationStatus: status,
        lastGreetedAt: status === "greeted_unread" ? new Date().toISOString() : null,
        notes: null,
      });
      await refreshAfterJobStateChange();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  async function updateReviewNotes(job: JobRow): Promise<void> {
    const currentNotes = job.review_notes ?? "";
    const nextNotes = window.prompt("编辑岗位备注，留空可清空备注。", currentNotes);
    if (nextNotes === null) return;
    try {
      await invoke<void>("set_job_review_notes", {
        encryptJobId: job.encrypt_job_id,
        notes: nextNotes.trim() ? nextNotes : null,
      });
      await refreshAfterJobStateChange();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  async function updateCompanyReviewStatus(job: JobRow, status: CompanyReviewStatus): Promise<void> {
    const companyName = job.brand_name?.trim();
    if (!companyName) {
      error.value = "该职位缺少公司名称，无法标记公司状态。";
      return;
    }
    const title = status === "manual_not_fit" ? "公司不合适" : "恢复公司";
    const statusLabel = status === "manual_not_fit" ? "公司不合适" : "待判断";
    showConfirm(title, `确认将「${companyName}」标记为「${statusLabel}」？该公司同名岗位会按公司状态复用判断。`, async () => {
      try {
        await invoke<void>("set_company_review_state", {
          companyName,
          reviewStatus: status,
          notes: status === "manual_not_fit" ? `从职位「${job.position_name ?? job.encrypt_job_id}」标记` : null,
        });
        await refreshAfterJobStateChange();
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    }, title);
  }
  async function blacklistCompany(job: JobRow): Promise<void> {
    const companyName = job.brand_name?.trim();
    if (!companyName) {
      error.value = "该职位缺少公司名称，无法加入公司黑名单。";
      return;
    }
    showConfirm("拉黑公司", `确认把「${companyName}」加入公司黑名单？后续同公司岗位将不再进入候选队列。`, async () => {
      try {
        await invoke<void>("add_company_blacklist", {
          companyName,
          reason: `从职位「${job.position_name ?? job.encrypt_job_id}」加入公司黑名单`,
        });
        await refreshAfterJobStateChange(true);
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    }, "拉黑公司");
  }
  async function blacklistJob(job: JobRow): Promise<void> {
    showConfirm("拉黑职位", `确认把「${job.position_name ?? job.encrypt_job_id}」加入职位黑名单？`, async () => {
      try {
        await invoke<void>("add_job_blacklist", {
          encryptJobId: job.encrypt_job_id,
          reason: "用户从职位库加入职位黑名单",
        });
        await refreshAfterJobStateChange(true);
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    }, "拉黑职位");
  }
  async function blacklistKeyword(job: JobRow): Promise<void> {
    const suggestedKeyword = job.position_name?.trim() || job.brand_name?.trim() || "";
    const keyword = window.prompt("输入要加入黑名单的关键词", suggestedKeyword)?.trim() ?? "";
    if (!keyword) {
      return;
    }
    showConfirm("拉黑关键词", `确认把「${keyword}」加入关键词黑名单？后续命中该关键词的岗位将被过滤。`, async () => {
      try {
        await invoke<void>("add_keyword_blacklist", {
          keyword,
          reason: `从职位「${job.position_name ?? job.encrypt_job_id}」加入关键词黑名单`,
        });
        await refreshAfterJobStateChange(true);
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    }, "拉黑关键词");
  }
  async function deleteJobBlacklist(entry: JobBlacklistEntry): Promise<void> {
    showConfirm("移除黑名单", `确认移除「${entry.value}」？命中该规则的岗位会重新参与后续筛选。`, async () => {
      try {
        await invoke<void>("delete_job_blacklist", { blacklistId: entry.id });
        await refreshAfterJobStateChange(true);
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
      }
    }, "移除");
  }
  onMounted(() => {
    void loadJobCandidates();
    void loadDefaultFilterProfile();
  });

  onActivated(() => {
    isPageActive = true;
    if (!hasBeenDeactivated) return;
    pendingRealtimeRefresh = false;
    void loadJobCandidates({ keepPage: true });
    void loadDefaultFilterProfile();
  });

  onDeactivated(() => {
    isPageActive = false;
    hasBeenDeactivated = true;
    if (refreshTimer === null) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  });

  watch(
    () => runtime.finishedCounter,
    () => {
      keywordJobsCache.clear();
      detailCache.clear();
      expandedJobId.value = null;
      flatResults.value = [];
      void loadJobCandidates();
      void loadDefaultFilterProfile();
    },
  );
  watch(dailyIntelligenceAutoNotifyEnabled, (enabled) => {
    if (enabled) {
      void enableDailyIntelligenceAutoNotify();
      return;
    }
    localStorage.setItem(DAILY_INTELLIGENCE_AUTO_NOTIFY_KEY, "0");
  });
  watch(
    dailyIntelligence,
    () => {
      void notifyDailyIntelligence("auto");
    },
    { deep: true },
  );
  watch(
    () => runtime.progress.captured_job_list,
    () => {
      scheduleRealtimeRefresh();
    },
  );
  watch(
    () => runtime.lastDetailCapturedId,
    (id) => {
      if (id) detailCache.delete(id);
    },
  );
  return {
    tauri,
    search,
    loading,
    error,
    groups,
    flatResults,
    jobCandidates,
    jobCandidatesTotal,
    jobCandidatesLoading,
    jobCandidateSearch,
    jobCandidatePage,
    jobCandidatePageSize,
    jobCandidateTimeRange,
    jobCandidateCustomStartDate,
    jobCandidateCustomEndDate,
    jobCandidateProcessedFilter,
    jobCandidateBucket,
    selectedJobStatusFilters,
    selectedAiAuditFilters,
    selectedSourcePlatformFilters,
    selectedCollectionMethodFilters,
    jobCandidateTotalPages,
    jobIntelligenceRangeLabel,
    currentPageProcessedCount,
    currentPageUnprocessedCount,
    reviewCandidates,
    favoritedJobs,
    applicationReadyJobs,
    communicationFollowupJobs,
    filteredJobs,
    dailyIntelligence,
    dailyIntelligenceAutoNotifyEnabled,
    dailyIntelligenceExternalMessage,
    dailyIntelligenceTelegramSending,
    blacklistEntries,
    ...filterProfileState,
    filterProfileUpdatedAt,
    filterProfileLoading,
    filterRecomputing,
    filterRecomputeMessage,
    pendingEvidenceRefreshingJobId,
    pendingEvidenceRefreshMessage,
    isSearchMode,
    reviewCandidatesLoading,
    favoritedJobsLoading,
    applicationReadyJobsLoading,
    communicationFollowupJobsLoading,
    filteredJobsLoading,
    bossChatStatusSyncing,
    bossChatStatusSyncMessage,
    dailyIntelligenceLoading,
    companyScoreRebuilding,
    companyScoreRebuildMessage,
    aiCompanyScoreGenerating,
    aiCompanyScoreMessage,
    aiCompanyScoreError,
    blacklistLoading,
    expandedKeyword,
    expandedJobId,
    keywordJobsCache,
    keywordJobsLoading,
    detailLoading,
    greetingCache,
    greetingDrafts,
    greetingErrors,
    greetingLoading,
    confirmDialog,
    expandedDetail,
    groupKey,
    jobSourceUrl,
    syncBossChatStatus,
    loadKeywords,
    loadJobCandidates,
    toggleJobStatusFilter,
    toggleAiAuditFilter,
    toggleSourcePlatformFilter,
    toggleCollectionMethodFilter,
    clearJobCandidateFilters,
    goJobCandidatePage,
    JOB_TIME_RANGE_OPTIONS,
    PROCESSED_FILTER_OPTIONS,
    JOB_STATUS_FILTER_OPTIONS,
    AI_AUDIT_FILTER_OPTIONS,
    SOURCE_PLATFORM_FILTER_OPTIONS,
    COLLECTION_METHOD_FILTER_OPTIONS,
    loadReviewCandidates,
    loadFavoritedJobs,
    loadApplicationReadyJobs,
    loadCommunicationFollowupJobs,
    loadFilteredJobs,
    loadDailyIntelligence,
    loadJobBlacklist,
    loadDefaultFilterProfile,
    selectFilterProfile,
    saveActiveFilterProfile,
    createFilterProfile,
    setActiveFilterProfileAsDefault,
    recomputeDefaultFilterProfile,
    refreshPendingJobEvidence,
    rebuildCompanyScores,
    generateAiCompanyScores,
    toggleKeyword,
    toggleDetail,
    copy,
    generateGreeting,
    updateGreetingDraft,
    copyGreeting,
    copyApplicationPacket,
    copyApplicationReadySummary,
    copyReviewCandidatesSummary,
    copyCommunicationFollowupSummary,
    copyDailyIntelligence,
    copyDailyRecommendedCandidate,
    openDailyIntelligenceEmailDraft,
    sendDailyIntelligenceTelegramNotification,
    openJobSourceUrl,
    copyFilteredJobsSummary,
    showDailyIntelligenceNotification,
    deleteJob,
    deleteAllJobs,
    updateReviewStatus,
    restoreReviewCandidate,
    updateCommunicationStatus,
    updateReviewNotes,
    updateCompanyReviewStatus,
    blacklistCompany,
    blacklistJob,
    blacklistKeyword,
    deleteJobBlacklist,
    formatDate,
    closeConfirm,
    executeConfirm,
  };
}
