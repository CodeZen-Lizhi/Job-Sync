import { z } from "zod";

export const LoginStartPayloadSchema = z.object({
  source_platform: z.string().optional(),
  executable_path: z.string().optional(),
  user_data_dir: z.string().optional(),
});

export const SessionStatePayloadSchema = z.object({
  cookies: z.any(),
  local_storage: z.any(),
});

export const SearchTaskPayloadSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  source_platform: z.string().optional(),
  filters: z.any().optional().default({}),
  limits: z.any().optional().default({}),
  mode: z.string().optional(),
});

export const CrawlAutoStartPayloadSchema = z.object({
  session: SessionStatePayloadSchema,
  task: SearchTaskPayloadSchema,
  run_id: z.string().optional(),
  user_data_dir: z.string().optional(),
});

export const RefreshJobEvidencePayloadSchema = z.object({
  session: SessionStatePayloadSchema,
  encrypt_job_id: z.string().min(1),
  source_url: z.string().optional(),
  raw_payload: z.any().optional(),
  user_data_dir: z.string().optional(),
});

export const BossMetaSyncPayloadSchema = z.object({
  session: SessionStatePayloadSchema,
});

export const BossChatSyncPayloadSchema = z.object({
  session: SessionStatePayloadSchema,
  limits: z.any().optional().default({}),
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
  greeting_prompt_extra: z.string().optional(),
  job_detail: z.any(),
  match_report: z.any().optional(),
  filter_reason: z.any().optional(),
  score_reason: z.any().optional(),
  source_context: z.any().optional(),
  review_context: z.any().optional(),
});

export const AiOptimizeResumeForJobPayloadSchema = z.object({
  resume_text: z.string().trim().min(1),
  job_detail: z.any(),
  context_text: z.string().optional(),
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

export const AiPostCollectionJudgePayloadSchema = z.object({
  profile: z.any().optional(),
  job: z.any(),
  filter_reason: z.any().optional(),
});

export const AiPostCollectionJudgeBatchJobSchema = z.object({
  encrypt_job_id: z.string().trim().min(1),
  job: z.any(),
  filter_reason: z.any().optional(),
});

export const AiPostCollectionJudgeBatchPayloadSchema = z.object({
  profile: z.any().optional(),
  jobs: z.array(AiPostCollectionJudgeBatchJobSchema).min(1),
  concurrency: z.number().int().positive().optional(),
});

export const CommandInSchema = z.union([
  z.object({ type: z.literal("LOGIN_START"), payload: LoginStartPayloadSchema }),
  z.object({
    type: z.literal("CRAWL_AUTO_START"),
    payload: CrawlAutoStartPayloadSchema,
  }),
  z.object({
    type: z.literal("REFRESH_JOB_EVIDENCE"),
    payload: RefreshJobEvidencePayloadSchema,
  }),
  z.object({
    type: z.literal("BOSS_META_SYNC"),
    payload: BossMetaSyncPayloadSchema,
  }),
  z.object({
    type: z.literal("BOSS_CHAT_SYNC"),
    payload: BossChatSyncPayloadSchema,
  }),
  z.object({ type: z.literal("AI_ANALYZE"), payload: AiAnalyzePayloadSchema }),
  z.object({ type: z.literal("AI_ANALYZE_GROUP"), payload: AiAnalyzeGroupPayloadSchema }),
  z.object({ type: z.literal("AI_GREETING"), payload: AiGreetingPayloadSchema }),
  z.object({ type: z.literal("AI_OPTIMIZE_RESUME_FOR_JOB"), payload: AiOptimizeResumeForJobPayloadSchema }),
  z.object({ type: z.literal("AI_COMPANY_SCORE_BATCH"), payload: AiCompanyScoreBatchPayloadSchema }),
  z.object({ type: z.literal("AI_POST_COLLECTION_JUDGE"), payload: AiPostCollectionJudgePayloadSchema }),
  z.object({ type: z.literal("AI_POST_COLLECTION_JUDGE_BATCH"), payload: AiPostCollectionJudgeBatchPayloadSchema }),
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
  source_platform: z.string().optional(),
  cookies: z.any(),
  local_storage: z.any(),
});

export const JobListCapturedPayloadSchema = z.object({
  keyword: z.string().optional(),
  filters: z.any().optional(),
  capture_source: z.enum(["natural", "dom_fallback", "api_fallback"]).optional(),
  raw: z.any(),
});

export const JobDetailCapturedPayloadSchema = z.object({
  encrypt_job_id: z.string().min(1),
  zp_data: z.any(),
});

export const JobNormalizedCapturedPayloadSchema = z.object({
  encrypt_job_id: z.string().min(1),
  source_platform: z.string().min(1),
  source_url: z.string().optional(),
  dedup_key: z.string().min(1),
  position_name: z.string().optional(),
  boss_name: z.string().optional(),
  brand_name: z.string().optional(),
  city_name: z.string().optional(),
  salary_desc: z.string().optional(),
  experience_name: z.string().optional(),
  degree_name: z.string().optional(),
  jd_text: z.string().optional(),
  raw_payload: z.any(),
  keyword: z.string().optional(),
  filters: z.any().optional(),
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

export const BossChatStatusSyncedPayloadSchema = z.object({
  encrypt_job_id: z.string().min(1),
  communication_status: z.enum(["greeted_unread", "read_no_reply", "replied", "rejected"]),
  boss_name: z.string().optional(),
  brand_name: z.string().optional(),
  position_name: z.string().optional(),
  message_status: z.string().optional(),
  message_preview: z.string().optional(),
  raw_payload: z.any().optional(),
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
  z.object({ type: z.literal("JOB_NORMALIZED_CAPTURED"), payload: JobNormalizedCapturedPayloadSchema }),
  z.object({ type: z.literal("JOB_FILTERED"), payload: JobFilteredPayloadSchema }),
  z.object({ type: z.literal("AI_RESULT"), payload: AiResultPayloadSchema }),
  z.object({ type: z.literal("BOSS_META_SYNCED"), payload: BossMetaSyncedPayloadSchema }),
  z.object({ type: z.literal("BOSS_CHAT_STATUS_SYNCED"), payload: BossChatStatusSyncedPayloadSchema }),
  z.object({ type: z.literal("FINISHED") }),
  z.object({ type: z.literal("ERROR"), payload: ErrorPayloadSchema }),
]);

export type EventOut = z.infer<typeof EventOutSchema>;
