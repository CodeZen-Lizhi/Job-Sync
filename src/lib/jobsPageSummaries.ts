import {
  companyReviewStatusLabel,
  communicationStatusLabel,
  formatResumeMatchEvidence,
  formatScoreReasonSummary,
  parseScoreReasonJson,
  reviewStatusLabel,
  type GreetingMessageResult,
  type JobDailyIntelligenceCandidate,
  type JobRow,
} from "./jobs";
import { formatDate, jobSourceUrl } from "./jobsPageHelpers";

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
  const summary = job.filter_summary?.trim();
  if (summary) return summary;
  if (job.filter_eligible === true) return "通过筛选规则";
  if (job.filter_eligible === false) return "不满足筛选规则";
  return "暂无筛选规则结果";
}

export function isProcessedJob(job: JobRow): boolean {
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
  if (job.review_status !== "ready_to_apply" && job.review_status !== "applied") {
    gaps.push("人工确认：尚未标记准备投递");
  }
  if (job.filter_eligible === false) {
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

export function buildReadyToApplyConfirmationMessage(
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

export interface ApplicationReadySummaryEntry {
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

export function buildApplicationReadyJobsSummary(entries: ApplicationReadySummaryEntry[]): string {
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

export function buildReviewCandidatesSummary(jobs: JobRow[]): string {
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
  const filterSummary = formatApplicationFilterTrace(job);
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

export function buildFilteredJobsSummary(jobs: JobRow[]): string {
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

export function buildCommunicationFollowupJobsSummary(jobs: JobRow[]): string {
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

export function buildDailyRecommendedCandidateSummary(candidate: JobDailyIntelligenceCandidate): string {
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
