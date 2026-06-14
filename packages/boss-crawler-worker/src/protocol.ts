import { z } from "zod";

export const LoginStartPayloadSchema = z.object({
  executable_path: z.string().optional(),
  user_data_dir: z.string().optional(),
});

export const SessionStatePayloadSchema = z.object({
  cookies: z.any(),
  local_storage: z.any(),
});

export const SearchTaskPayloadSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  filters: z.any().optional().default({}),
  limits: z.any().optional().default({}),
  mode: z.string().optional(),
});

export const CrawlManualStartPayloadSchema = z.object({
  session: SessionStatePayloadSchema,
});

export const CrawlAutoStartPayloadSchema = z.object({
  session: SessionStatePayloadSchema,
  task: SearchTaskPayloadSchema,
});

export const BossMetaSyncPayloadSchema = z.object({
  session: SessionStatePayloadSchema,
});

export const AiAnalyzePayloadSchema = z.object({
  resume_text: z.string().min(1),
  context_text: z.string().optional(),
  resume_files: z.string().optional(),
  job_detail: z.any(),
  filter_reason: z.any().optional(),
  score_reason: z.any().optional(),
  source_context: z.any().optional(),
  review_context: z.any().optional(),
});

export const AiAnalyzeGroupPayloadSchema = z.object({
  context_text: z.string().min(1),
  jobs: z.array(z.any()).min(1),
});

export const AiGreetingPayloadSchema = z.object({
  resume_text: z.string().optional(),
  context_text: z.string().optional(),
  resume_files: z.string().optional(),
  job_detail: z.any(),
  match_report: z.any().optional(),
  filter_reason: z.any().optional(),
  score_reason: z.any().optional(),
  source_context: z.any().optional(),
  review_context: z.any().optional(),
});

export const AiCompanyScoreBatchPayloadSchema = z.object({
  companies: z
    .array(
      z.object({
        company_name: z.string().trim().min(1),
        jobs_count: z.number().int().nonnegative(),
        source_text: z.string().optional().default(""),
        jobs: z.array(z.any()).optional().default([]),
      }),
    )
    .min(1),
});

export const ResumeDiagnosePayloadSchema = z.object({
  resume_text: z.string().min(1),
  context_text: z.string().optional(),
  resume_files: z.string().optional(),
});

export const ResumeRewriteModulePayloadSchema = z.object({
  module: z.enum(["summary", "projects", "experience", "skills"]),
  resume_text: z.string().min(1),
  context_text: z.string().optional(),
  resume_files: z.string().optional(),
  module_input: z.string().min(1),
  confirmed_summary: z.string().optional(),
  confirmed_projects: z.string().optional(),
  confirmed_experience: z.string().optional(),
  confirmed_skills: z.string().optional(),
});

export const CommandInSchema = z.union([
  z.object({ type: z.literal("LOGIN_START"), payload: LoginStartPayloadSchema }),
  z.object({
    type: z.literal("CRAWL_MANUAL_START"),
    payload: CrawlManualStartPayloadSchema,
  }),
  z.object({
    type: z.literal("CRAWL_AUTO_START"),
    payload: CrawlAutoStartPayloadSchema,
  }),
  z.object({
    type: z.literal("BOSS_META_SYNC"),
    payload: BossMetaSyncPayloadSchema,
  }),
  z.object({ type: z.literal("AI_ANALYZE"), payload: AiAnalyzePayloadSchema }),
  z.object({ type: z.literal("AI_ANALYZE_GROUP"), payload: AiAnalyzeGroupPayloadSchema }),
  z.object({ type: z.literal("AI_GREETING"), payload: AiGreetingPayloadSchema }),
  z.object({ type: z.literal("AI_COMPANY_SCORE_BATCH"), payload: AiCompanyScoreBatchPayloadSchema }),
  z.object({ type: z.literal("RESUME_DIAGNOSE"), payload: ResumeDiagnosePayloadSchema }),
  z.object({ type: z.literal("RESUME_REWRITE_MODULE"), payload: ResumeRewriteModulePayloadSchema }),
  z.object({ type: z.literal("STOP") }),
  z.object({ type: z.literal("PAUSE") }),
  z.object({ type: z.literal("RESUME") }),
]);

export type CommandIn = z.infer<typeof CommandInSchema>;

export const LogPayloadSchema = z.object({
  level: z.string(),
  message: z.string(),
  ts: z.string().optional(),
});

export const ProgressPayloadSchema = z.object({
  keyword: z.string().optional(),
  current_page: z.number().int().nonnegative().optional(),
  captured_job_list: z.number().int().nonnegative().optional(),
  captured_job_detail: z.number().int().nonnegative().optional(),
  filtered_job: z.number().int().nonnegative().optional(),
});

export const LoginStatusPayloadSchema = z.object({
  status: z.string(),
  message: z.string().optional(),
});

export const CookieCollectedPayloadSchema = z.object({
  cookies: z.any(),
  local_storage: z.any(),
});

export const JobListCapturedPayloadSchema = z.object({
  keyword: z.string().optional(),
  filters: z.any().optional(),
  raw: z.any(),
});

export const JobDetailCapturedPayloadSchema = z.object({
  encrypt_job_id: z.string().min(1),
  zp_data: z.any(),
});

export const JobFilteredPayloadSchema = z.object({
  encrypt_job_id: z.string().optional(),
  keyword: z.string().optional(),
  filters: z.any().optional(),
  reason: z.object({
    eligible: z.boolean(),
    blocked_by: z.array(
      z.object({
        rule_type: z.string(),
        field: z.string(),
        value: z.string(),
        reason: z.string(),
      }),
    ),
    matched_preferences: z.array(z.string()),
    missing_preferences: z.array(z.string()),
  }),
  raw: z.any().optional(),
});

export const AiResultPayloadSchema = z.object({
  result: z.any(),
});

export const BossMetaSyncedPayloadSchema = z.object({
  synced_at: z.string().optional(),
  city_group: z.any().optional(),
  filter_conditions: z.any().optional(),
  industry_filter_exemption: z.any().optional(),
});

export const ErrorPayloadSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
});

export const EventOutSchema = z.union([
  z.object({ type: z.literal("LOG"), payload: LogPayloadSchema }),
  z.object({ type: z.literal("PROGRESS"), payload: ProgressPayloadSchema }),
  z.object({ type: z.literal("LOGIN_STATUS"), payload: LoginStatusPayloadSchema }),
  z.object({ type: z.literal("COOKIE_COLLECTED"), payload: CookieCollectedPayloadSchema }),
  z.object({ type: z.literal("JOB_LIST_CAPTURED"), payload: JobListCapturedPayloadSchema }),
  z.object({ type: z.literal("JOB_DETAIL_CAPTURED"), payload: JobDetailCapturedPayloadSchema }),
  z.object({ type: z.literal("JOB_FILTERED"), payload: JobFilteredPayloadSchema }),
  z.object({ type: z.literal("AI_RESULT"), payload: AiResultPayloadSchema }),
  z.object({ type: z.literal("BOSS_META_SYNCED"), payload: BossMetaSyncedPayloadSchema }),
  z.object({ type: z.literal("FINISHED") }),
  z.object({ type: z.literal("ERROR"), payload: ErrorPayloadSchema }),
]);

export type EventOut = z.infer<typeof EventOutSchema>;
