export interface KeywordGroup {
  keyword: string | null;
  label: string;
  job_count: number;
}

export interface JobDailyIntelligenceCandidate {
  encrypt_job_id: string;
  source_platform: string;
  source_url: string | null;
  dedup_key: string | null;
  position_name: string | null;
  brand_name: string | null;
  city_name: string | null;
  final_score: number;
  resume_match_score: number | null;
  preference_score: number;
  company_score: number;
  recommendation_reason: string;
  score_reason_json: string;
}

export interface JobDailyIntelligence {
  report_date: string;
  generated_at: string;
  today_new_jobs: number;
  high_match_jobs: number;
  eligible_jobs: number;
  recommended_jobs: number;
  ready_to_apply_jobs: number;
  applied_jobs: number;
  high_match_threshold: number;
  recommendation_threshold: number;
  recommended_candidates: JobDailyIntelligenceCandidate[];
  notification_text: string;
  notification_brief_text: string;
}

export interface DailyIntelligenceWebhookResult {
  report_date: string;
  channel: "wecom";
}

export interface CompanyScoreRebuildResult {
  companies: number;
  jobs: number;
}

export interface AiCompanyScoreBatchResult {
  companies: number;
  jobs: number;
  updated: number;
  failed: number;
}

export interface GreetingErrorState {
  title: string;
  hint: string;
  message: string;
}

export type BlacklistKind = "company" | "job" | "keyword";

export interface JobBlacklistEntry {
  id: number;
  kind: BlacklistKind;
  value: string;
  reason: string | null;
  created_at: string;
}

export interface JobRow {
  encrypt_job_id: string;
  source_platform: string;
  collection_method: CollectionMethod;
  source_url: string | null;
  dedup_key: string | null;
  position_name: string | null;
  boss_name: string | null;
  boss_active_status: string | null;
  brand_name: string | null;
  city_name: string | null;
  salary_desc: string | null;
  experience_name: string | null;
  degree_name: string | null;
  last_seen_at: string | null;
  filter_eligible: boolean | null;
  filter_reason_json: string | null;
  filter_updated_at: string | null;
  review_status: ReviewStatus | null;
  communication_status: CommunicationStatus | null;
  last_greeted_at: string | null;
  review_notes: string | null;
  review_updated_at: string | null;
  company_review_status: CompanyReviewStatus | null;
  company_review_notes: string | null;
  company_blacklisted: boolean;
  job_blacklisted: boolean;
  keyword_blacklisted: boolean;
  blacklist_reason: string | null;
  company_negative_communication_count: number;
  latest_company_negative_communication_status: CommunicationStatus | null;
  latest_company_negative_communication_at: string | null;
  resume_match_score: number | null;
  preference_score: number;
  company_score: number;
  final_score: number;
  score_reason_json: string;
}

export interface JobCandidatePage {
  jobs: JobRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface FilterBlockedReason {
  rule_type: string;
  field: string;
  value: string;
  reason: string;
}

export interface FilterReasonDimensions {
  detected_work_modes?: string[];
  city_name?: string | null;
  source_platform?: string | null;
  boss_active_status?: string | null;
  review_status?: string | null;
  communication_status?: string | null;
  company_review_status?: string | null;
  salary?: {
    raw?: string | null;
    min_k?: number | null;
    max_k?: number | null;
    negotiable?: boolean | null;
  };
  experience?: {
    raw?: string | null;
    min_years?: number | null;
    max_years?: number | null;
    unknown?: boolean | null;
  };
  salary_desc?: string | null;
  experience_name?: string | null;
  degree_name?: string | null;
  last_seen_at?: string | null;
}

export interface AiPostCollectionJudgement {
  bucket?: "recommended" | "pending_confirmation" | "filtered" | string;
  confidence?: number;
  summary?: string;
  evidence?: string[];
  risks?: string[];
}

export interface FilterReasonJson {
  eligible?: boolean;
  bucket?: "recommended" | "pending_confirmation" | "filtered" | string;
  blocked_by?: FilterBlockedReason[];
  matched_preferences?: string[];
  missing_preferences?: string[];
  dimensions?: FilterReasonDimensions;
  ai_judgement?: AiPostCollectionJudgement;
}

export interface ScoreReasonJson {
  weights?: {
    resume?: number;
    preference?: number;
    company?: number;
  };
  resume?: {
    resume_match_score?: number;
    matched_stack?: string[];
    matched_direction?: string[];
    matched_resume_evidence?: string[];
    experience_fit?: string | null;
    missing_points?: string[];
    confidence?: number;
    strengths?: string[];
    gaps?: string[];
    keywordSuggestions?: string[];
    riskNotes?: string[];
  };
  preference?: {
    matched?: string[];
    missing?: string[];
  };
  company?: {
    company_score?: number;
    risk_flags?: string[];
    evidence?: string[];
    confidence?: number;
  };
}

export type ReviewStatus = "pending" | "favorited" | "ready_to_apply" | "applied" | "ignored";
export type CompanyReviewStatus = "pending" | "manual_not_fit";
export type CollectionMethod = "manual" | "automatic";
export type CommunicationStatus =
  | "not_contacted"
  | "greeted_unread"
  | "read_no_reply"
  | "replied"
  | "rejected"
  | "manual_not_fit";

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "待审核",
  favorited: "已收藏",
  ready_to_apply: "准备投递",
  applied: "已投递",
  ignored: "已忽略",
};

export const COMPANY_REVIEW_STATUS_LABELS: Record<CompanyReviewStatus, string> = {
  pending: "公司待判断",
  manual_not_fit: "公司不合适",
};

export const COMMUNICATION_STATUS_LABELS: Record<CommunicationStatus, string> = {
  not_contacted: "未打招呼",
  greeted_unread: "已打招呼未读",
  read_no_reply: "已读未回",
  replied: "已回复",
  rejected: "已拒绝",
  manual_not_fit: "手动不合适",
};

export const COLLECTION_METHOD_LABELS: Record<CollectionMethod, string> = {
  manual: "手动",
  automatic: "自动",
};

export const JOB_BLACKLIST_KIND_LABELS: Record<BlacklistKind, string> = {
  company: "公司",
  job: "职位",
  keyword: "关键词",
};

export const COMPANY_RISK_FLAG_LABELS: Record<string, string> = {
  outsourcing_risk: "外包风险",
  training_risk: "培训机构风险",
  sales_like_risk: "销售导向风险",
  low_info_risk: "信息过少",
  onsite_risk: "驻场/到岗风险",
  agency_risk: "招聘中介风险",
};

export function reviewStatusLabel(status?: ReviewStatus | null): string {
  return REVIEW_STATUS_LABELS[status ?? "pending"];
}

export function companyReviewStatusLabel(status?: CompanyReviewStatus | null): string {
  return COMPANY_REVIEW_STATUS_LABELS[status ?? "pending"];
}

export function communicationStatusLabel(status?: CommunicationStatus | null): string {
  return COMMUNICATION_STATUS_LABELS[status ?? "not_contacted"];
}

export function blacklistKindLabel(kind: BlacklistKind): string {
  return JOB_BLACKLIST_KIND_LABELS[kind];
}

export function companyRiskFlagLabel(flag: string): string {
  return COMPANY_RISK_FLAG_LABELS[flag] ?? flag;
}

function uniqStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function preferenceSignalLabel(value: string): string {
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  if (parts.length < 2) return trimmed;
  const prefix = parts[0].trim().toLowerCase();
  const label = parts.slice(1).join(":").trim();
  if (!label) return trimmed;
  if (prefix === "direction") return `方向：${label}`;
  if (prefix === "tech") return `技术：${label}`;
  if (prefix === "work_mode") return `工作方式：${label}`;
  if (prefix === "company") return `公司：${label}`;
  if (prefix === "keyword") return `关键词：${label}`;
  return label;
}

export function formatPreferenceSignals(values: readonly string[], limit = 5): string {
  const labels = uniqStrings(values).map(preferenceSignalLabel);
  if (labels.length === 0) return "";
  return `${labels.slice(0, limit).join("、")}${labels.length > limit ? ` 等${labels.length}项` : ""}`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseJsonObject<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

export function parseFilterReasonJson(json: string | null | undefined): FilterReasonJson | null {
  const parsed = parseJsonObject<FilterReasonJson>(json);
  if (!parsed) return null;
  return {
    eligible: typeof parsed.eligible === "boolean" ? parsed.eligible : undefined,
    blocked_by: Array.isArray(parsed.blocked_by)
      ? parsed.blocked_by
          .map((item) => ({
            rule_type: asString(item?.rule_type) ?? "unknown",
            field: asString(item?.field) ?? "unknown",
            value: asString(item?.value) ?? "",
            reason: asString(item?.reason) ?? "",
          }))
          .filter((item) => item.reason.length > 0 || item.value.length > 0)
      : undefined,
    matched_preferences: asStringArray(parsed.matched_preferences),
    missing_preferences: asStringArray(parsed.missing_preferences),
    ai_judgement: parsed.ai_judgement
      ? {
          bucket: asString(parsed.ai_judgement.bucket) ?? undefined,
          confidence: asFiniteNumber(parsed.ai_judgement.confidence) ?? undefined,
          summary: asString(parsed.ai_judgement.summary) ?? undefined,
          evidence: asStringArray(parsed.ai_judgement.evidence),
          risks: asStringArray(parsed.ai_judgement.risks),
        }
      : undefined,
    dimensions: parsed.dimensions
      ? {
          detected_work_modes: asStringArray(parsed.dimensions.detected_work_modes),
          city_name: asString(parsed.dimensions.city_name),
          source_platform: asString(parsed.dimensions.source_platform),
          review_status: asString(parsed.dimensions.review_status),
          communication_status: asString(parsed.dimensions.communication_status),
          company_review_status: asString(parsed.dimensions.company_review_status),
          salary: parsed.dimensions.salary
            ? {
                raw: asString(parsed.dimensions.salary.raw),
                min_k: asFiniteNumber(parsed.dimensions.salary.min_k),
                max_k: asFiniteNumber(parsed.dimensions.salary.max_k),
                negotiable: asBoolean(parsed.dimensions.salary.negotiable),
              }
            : undefined,
          experience: parsed.dimensions.experience
            ? {
                raw: asString(parsed.dimensions.experience.raw),
                min_years: asFiniteNumber(parsed.dimensions.experience.min_years),
                max_years: asFiniteNumber(parsed.dimensions.experience.max_years),
                unknown: asBoolean(parsed.dimensions.experience.unknown),
              }
            : undefined,
          salary_desc: asString(parsed.dimensions.salary_desc) ?? asString(parsed.dimensions.salary?.raw),
          experience_name: asString(parsed.dimensions.experience_name) ?? asString(parsed.dimensions.experience?.raw),
          degree_name: asString(parsed.dimensions.degree_name),
          last_seen_at: asString(parsed.dimensions.last_seen_at),
        }
      : undefined,
  };
}

export function filterBucketLabel(bucket?: string | null): string {
  if (bucket === "recommended") return "推荐";
  if (bucket === "pending_confirmation") return "待确认";
  if (bucket === "filtered") return "过滤";
  return bucket || "未判断";
}

export function formatAiPostCollectionJudgement(judgement: AiPostCollectionJudgement | null | undefined): string {
  if (!judgement) return "暂无 AI 采后判断";
  const parts: string[] = [`AI：${filterBucketLabel(judgement.bucket)}`];
  if (typeof judgement.confidence === "number") {
    parts.push(`置信度 ${Math.round(judgement.confidence * 100)}%`);
  }
  if (judgement.summary) {
    parts.push(judgement.summary);
  }
  return parts.join("；");
}

export function parseScoreReasonJson(json: string | null | undefined): ScoreReasonJson | null {
  const parsed = parseJsonObject<ScoreReasonJson>(json);
  if (!parsed) return null;
  return {
    weights: parsed.weights
      ? {
          resume: typeof parsed.weights.resume === "number" ? parsed.weights.resume : undefined,
          preference: typeof parsed.weights.preference === "number" ? parsed.weights.preference : undefined,
          company: typeof parsed.weights.company === "number" ? parsed.weights.company : undefined,
      }
      : undefined,
    resume: parsed.resume
      ? {
          resume_match_score: asFiniteNumber(parsed.resume.resume_match_score) ?? undefined,
          matched_stack: asStringArray(parsed.resume.matched_stack),
          matched_direction: asStringArray(parsed.resume.matched_direction),
          matched_resume_evidence: asStringArray(parsed.resume.matched_resume_evidence),
          experience_fit: asString(parsed.resume.experience_fit),
          missing_points: asStringArray(parsed.resume.missing_points),
          confidence: asFiniteNumber(parsed.resume.confidence) ?? undefined,
          strengths: asStringArray(parsed.resume.strengths),
          gaps: asStringArray(parsed.resume.gaps),
          keywordSuggestions: asStringArray(parsed.resume.keywordSuggestions),
          riskNotes: asStringArray(parsed.resume.riskNotes),
        }
      : undefined,
    preference: parsed.preference
      ? {
          matched: asStringArray(parsed.preference.matched),
          missing: asStringArray(parsed.preference.missing),
        }
      : undefined,
    company: parsed.company
      ? {
          company_score: asFiniteNumber(parsed.company.company_score) ?? undefined,
          risk_flags: asStringArray(parsed.company.risk_flags),
          evidence: asStringArray(parsed.company.evidence),
          confidence: asFiniteNumber(parsed.company.confidence) ?? undefined,
        }
      : undefined,
  };
}

export function formatFilterReasonSummary(reason: FilterReasonJson | null | undefined): string {
  if (!reason) return "不满足筛选规则";

  const parts: string[] = [];
  const blockedBy = reason.blocked_by ?? [];
  const matched = reason.matched_preferences ?? [];
  const missing = reason.missing_preferences ?? [];

  if (blockedBy.length > 0) {
    const blockedSummary = blockedBy
      .slice(0, 2)
      .map((item) => item.reason || item.value)
      .filter((item) => item.length > 0);
    if (blockedSummary.length > 0) {
      parts.push(`硬限制：${blockedSummary.join("；")}${blockedBy.length > blockedSummary.length ? ` 等${blockedBy.length}项` : ""}`);
    } else {
      parts.push(`硬限制：${blockedBy.length}项`);
    }
  }

  if (matched.length > 0) {
    const matchedSummary = matched.slice(0, 3).map(preferenceSignalLabel).join("、");
    parts.push(`偏好命中：${matchedSummary}${matched.length > 3 ? ` 等${matched.length}项` : ""}`);
  }

  if (missing.length > 0) {
    const missingSummary = missing.slice(0, 3).map(preferenceSignalLabel).join("、");
    parts.push(`偏好缺失：${missingSummary}${missing.length > 3 ? ` 等${missing.length}项` : ""}`);
  }

  return parts.join("；") || "不满足筛选规则";
}

export function formatScoreReasonSummary(reason: ScoreReasonJson | null | undefined): string {
  if (!reason) return "暂无额外评分原因";

  const parts: string[] = [];
  const matched = reason.preference?.matched ?? [];
  const missing = reason.preference?.missing ?? [];
  const strengths = reason.resume?.strengths ?? [];
  const gaps = reason.resume?.gaps ?? [];
  const matchedStack = reason.resume?.matched_stack ?? [];
  const matchedDirection = reason.resume?.matched_direction ?? [];
  const riskFlags = reason.company?.risk_flags ?? [];
  const evidence = reason.company?.evidence ?? [];

  if (matchedStack.length > 0) {
    parts.push(`匹配技术栈：${matchedStack.slice(0, 4).join("、")}${matchedStack.length > 4 ? ` 等${matchedStack.length}项` : ""}`);
  }

  if (matchedDirection.length > 0) {
    parts.push(`匹配方向：${matchedDirection.slice(0, 3).join("、")}${matchedDirection.length > 3 ? ` 等${matchedDirection.length}项` : ""}`);
  }

  if (strengths.length > 0) {
    parts.push(`简历匹配：${strengths.slice(0, 2).join("；")}${strengths.length > 2 ? ` 等${strengths.length}项` : ""}`);
  }

  if (gaps.length > 0) {
    parts.push(`简历缺口：${gaps.slice(0, 2).join("；")}${gaps.length > 2 ? ` 等${gaps.length}项` : ""}`);
  }

  if (matched.length > 0) {
    parts.push(`加分项：${matched.slice(0, 3).map(preferenceSignalLabel).join("、")}${matched.length > 3 ? ` 等${matched.length}项` : ""}`);
  }

  if (missing.length > 0) {
    parts.push(`缺少加分项：${missing.slice(0, 3).map(preferenceSignalLabel).join("、")}${missing.length > 3 ? ` 等${missing.length}项` : ""}`);
  }

  if (riskFlags.length > 0) {
    parts.push(`风险标签：${riskFlags.slice(0, 3).map(companyRiskFlagLabel).join("、")}${riskFlags.length > 3 ? ` 等${riskFlags.length}项` : ""}`);
  }

  if (evidence.length > 0) {
    parts.push(`公司风险：${evidence.slice(0, 2).join("；")}${evidence.length > 2 ? ` 等${evidence.length}项` : ""}`);
  }

  return parts.join("；") || "暂无额外评分原因";
}

export function formatResumeMatchEvidence(reason: ScoreReasonJson | null | undefined): string {
  const resume = reason?.resume;
  if (!resume) return "暂无结构化 Resume Match 证据";

  const parts: string[] = [];
  const matchedStack = resume.matched_stack ?? [];
  const matchedDirection = resume.matched_direction ?? [];
  const resumeEvidence = resume.matched_resume_evidence ?? [];
  const missingPoints = resume.missing_points ?? [];

  if (typeof resume.resume_match_score === "number") {
    parts.push(`匹配分：${Math.round(resume.resume_match_score)}`);
  }
  if (matchedStack.length > 0) {
    parts.push(`匹配技术栈：${matchedStack.join("、")}`);
  }
  if (matchedDirection.length > 0) {
    parts.push(`匹配方向：${matchedDirection.join("、")}`);
  }
  if (resume.experience_fit) {
    parts.push(`经验匹配：${resume.experience_fit}`);
  }
  if (resumeEvidence.length > 0) {
    parts.push(`简历证据：${resumeEvidence.join("；")}`);
  }
  if (missingPoints.length > 0) {
    parts.push(`未覆盖要求：${missingPoints.join("；")}`);
  }
  if (typeof resume.confidence === "number") {
    parts.push(`置信度：${Math.round(resume.confidence * 100)}%`);
  }

  return parts.join("\n") || "暂无结构化 Resume Match 证据";
}

export interface JobDetail {
  securityId?: string;
  lid?: string;
  jobInfo?: {
    jobName?: string;
    positionName?: string;
    postDescription?: string;
    address?: string;
    cityName?: string;
    locationName?: string;
    salaryDesc?: string;
    experienceName?: string;
    degreeName?: string;
    skills?: string[];
    showSkills?: string[];
    jobLabels?: string[];
    jobStatusDesc?: string;
  };
  brandInfo?: {
    brandName?: string;
    industryName?: string;
    scaleName?: string;
    stage?: string;
  };
  brandComInfo?: {
    brandName?: string;
    industryName?: string;
    scaleName?: string;
    stageName?: string;
  };
  bossInfo?: {
    bossName?: string;
    bossTitle?: string;
    name?: string;
    title?: string;
    activeTimeDesc?: string;
  };
  [key: string]: unknown;
}

export interface LoadKeywordOptions {
  preserveExpanded?: boolean;
  refreshExpandedList?: boolean;
}

export interface GreetingMessageResult {
  message: string;
  jobEvidence: string[];
  candidateEvidence: string[];
  overlapKeywords: string[];
  editNotes: string[];
}
