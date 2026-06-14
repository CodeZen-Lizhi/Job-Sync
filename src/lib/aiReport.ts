export interface AiResumeRewrite {
  summaryRewrite?: string;
  experienceBulletsRewrite?: string[];
}

export interface AiResumeReport {
  resume_match_score?: number;
  matched_stack?: string[];
  matched_direction?: string[];
  matched_resume_evidence?: string[];
  experience_fit?: string;
  missing_points?: string[];
  confidence?: number;
  matchScore: number;
  strengths: string[];
  gaps: string[];
  keywordSuggestions: string[];
  resumeRewrite?: AiResumeRewrite;
  riskNotes: string[];
}

export interface AiLearningItem {
  topic: string;
  why: string;
  expectedOutput: string[];
}

export interface AiGroupJobRankingItem {
  encrypt_job_id: string;
  position_name?: string | null;
  brand_name?: string | null;
  matchScore: number;
  conclusion: string;
  reasons: string[];
  risks: string[];
  placeholder?: boolean;
}

export interface AiGroupReport {
  summary: string;
  jobRanking: AiGroupJobRankingItem[];
  commonRequirements: {
    mustHave: string[];
    niceToHave: string[];
    responsibilities: string[];
    keywords: string[];
  };
  resumeStrategy: {
    positioning: string;
    mustHighlight: string[];
    bullets: string[];
  };
  projectBoosters: Array<{
    title: string;
    why: string;
    deliverables: string[];
    resumeBullets: string[];
  }>;
  learningPlan: {
    p0: AiLearningItem[];
    p1: AiLearningItem[];
    p2: AiLearningItem[];
  };
  assumptions: string[];
  questions: string[];
  riskNotes: string[];
  nextSteps: string[];
  placeholderCount?: number;
}

export function isAiGroupReportComplete(report: AiGroupReport, expectedJobIds: string[] = []): boolean {
  if (!expectedJobIds.length) return true;
  const rankingIds = new Set(report.jobRanking.map((item) => item.encrypt_job_id.trim()).filter(Boolean));
  return expectedJobIds.every((id) => rankingIds.has(id.trim())) && (report.placeholderCount ?? 0) === 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((it) => typeof it === "string");
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function isAiResumeReport(v: unknown): v is AiResumeReport {
  if (!isRecord(v)) return false;
  if (!isNumber(v.matchScore)) return false;
  if (v.resume_match_score !== undefined && !isNumber(v.resume_match_score)) return false;
  if (v.matched_stack !== undefined && !isStringArray(v.matched_stack)) return false;
  if (v.matched_direction !== undefined && !isStringArray(v.matched_direction)) return false;
  if (v.matched_resume_evidence !== undefined && !isStringArray(v.matched_resume_evidence)) return false;
  if (v.experience_fit !== undefined && typeof v.experience_fit !== "string") return false;
  if (v.missing_points !== undefined && !isStringArray(v.missing_points)) return false;
  if (v.confidence !== undefined && !isNumber(v.confidence)) return false;
  if (!isStringArray(v.strengths)) return false;
  if (!isStringArray(v.gaps)) return false;
  if (!isStringArray(v.keywordSuggestions)) return false;
  if (!isStringArray(v.riskNotes)) return false;
  return true;
}

export function isAiGroupReport(v: unknown): v is AiGroupReport {
  if (!isRecord(v)) return false;
  if (typeof v.summary !== "string") return false;
  if (!Array.isArray(v.jobRanking) || v.jobRanking.length === 0) return false;
  if (!isRecord(v.commonRequirements)) return false;
  if (!isRecord(v.resumeStrategy)) return false;
  if (!Array.isArray(v.projectBoosters)) return false;
  if (!isRecord(v.learningPlan)) return false;
  if (!isStringArray(v.assumptions)) return false;
  if (!isStringArray(v.questions)) return false;
  if (!isStringArray(v.riskNotes)) return false;
  if (!isStringArray(v.nextSteps)) return false;

  const first = v.jobRanking[0];
  if (!isRecord(first)) return false;
  if (typeof first.encrypt_job_id !== "string" || !first.encrypt_job_id.trim()) return false;
  if (!isNumber(first.matchScore)) return false;
  if (typeof first.conclusion !== "string") return false;
  if (!isStringArray(first.reasons)) return false;
  if (!isStringArray(first.risks)) return false;

  return true;
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

export type ScoreTone = "success" | "warning" | "danger";

export function scoreTone(score: number): ScoreTone {
  const s = clampScore(score);
  if (s >= 60) return "success";
  if (s >= 40) return "warning";
  return "danger";
}
