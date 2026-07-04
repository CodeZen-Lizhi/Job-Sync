import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function projectFileExists(path) {
  return existsSync(resolve(root, path));
}

function invokedCommands(source) {
  return [...source.matchAll(/invoke(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("review workflow contract", () => {
  it("keeps the unified paginated job candidate list wired with filters, actions and source metadata", () => {
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsQueries = readProjectFile("src-tauri/src/commands/jobs/queries.rs");
    const jobsModels = readProjectFile("src-tauri/src/commands/jobs/models.rs");
    const jobsCommand = readProjectFile("src-tauri/src/commands/jobs.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");

    assert.match(jobsPage, /职位库工作台/);
    assert.match(jobsPage, /视图筛选/);
    assert.match(jobsPage, /\{\{ activeBucket\.label \}\}/);
    assert.match(jobsPage, /自动采集先保留岗位事实/);
    assert.match(jobsPage, /推荐查看/);
    assert.match(jobsPage, /待确认/);
    assert.match(jobsPage, /已过滤/);
    assert.match(jobsPage, /全部入库/);
    assert.match(jobsPage, /JOB_TIME_RANGE_OPTIONS/);
    assert.match(jobsPage, /PROCESSED_FILTER_OPTIONS/);
    assert.match(jobsPage, /JOB_STATUS_FILTER_OPTIONS/);
    assert.match(jobsPage, /AI_AUDIT_FILTER_OPTIONS/);
    assert.match(jobsPage, /SOURCE_PLATFORM_FILTER_OPTIONS/);
    assert.match(jobsPage, /COLLECTION_METHOD_FILTER_OPTIONS/);
    assert.match(jobsPage, /selectedJobStatusFilters/);
    assert.match(jobsPage, /selectedAiAuditFilters/);
    assert.match(jobsPage, /selectedSourcePlatformFilters/);
    assert.match(jobsPage, /selectedCollectionMethodFilters/);
    assert.match(jobsPage, /goJobCandidatePage/);
    assert.match(jobsPage, /jobCandidatePageSize/);
    assert.match(jobsPage, /岗位平台/);
    assert.match(jobsPage, /采集方式/);

    for (const removedEntry of [
      "最近过滤解释",
      "工作队列",
      "每日岗位情报",
      "投递准备台",
    ]) {
      assert.doesNotMatch(jobsPage, new RegExp(removedEntry));
    }

    assert.match(jobsLogic, /invoke<JobCandidatePage>\("list_job_candidates"/);
    assert.match(jobsLogic, /jobCandidateBucket/);
    assert.match(jobsLogic, /bucket: jobCandidateBucket\.value/);
    assert.match(jobsPage, /jobCandidateBucket\.value = bucket === "confirm" \? "pending_confirmation" : bucket/);
    assert.match(jobsLogic, /function loadJobCandidates/);
    const jobsMountedSource = jobsLogic.match(/onMounted\(\(\) => \{[\s\S]*?\n  \}\);/)?.[0] ?? "";
    assert.doesNotMatch(jobsMountedSource, /loadJobCandidates/);
    assert.match(jobsPage, /route\.path, route\.query\.jobId/);
    assert.match(jobsLogic, /function isProcessedJob/);
    assert.match(jobsLogic, /processed: jobCandidateProcessedFilter/);
    assert.match(jobsLogic, /statusFilters: selectedJobStatusFilters/);
    assert.match(jobsLogic, /aiAuditFilters: selectedAiAuditFilters/);
    assert.match(jobsLogic, /sourcePlatforms: selectedSourcePlatformFilters/);
    assert.match(jobsLogic, /collectionMethods: selectedCollectionMethodFilters/);
    assert.match(jobsLogic, /toggleJobStatusFilter/);
    assert.match(jobsLogic, /toggleAiAuditFilter/);
    assert.match(jobsLogic, /toggleSourcePlatformFilter/);
    assert.match(jobsLogic, /toggleCollectionMethodFilter/);
    assert.match(jobsPage, /clearCurrentViewFilters/);

    assert.match(jobsCommand, /pub fn list_job_candidates/);
    assert.match(tauriLib, /commands::jobs::list_job_candidates/);
    assert.match(jobsQueries, /list_job_candidates_on_conn/);
    assert.match(jobsQueries, /fn job_processed_sql/);
    assert.match(jobsQueries, /JOB_COLLECTION_METHOD_SQL/);
    assert.match(jobsQueries, /processed: Option<String>/);
    assert.match(jobsQueries, /status_filters: Option<Vec<String>>/);
    assert.match(jobsQueries, /ai_audit_filters: Option<Vec<String>>/);
    assert.match(jobsQueries, /source_platforms: Option<Vec<String>>/);
    assert.match(jobsQueries, /collection_methods: Option<Vec<String>>/);
    assert.match(jobsQueries, /LIMIT \? OFFSET \?/);
    assert.match(jobsQueries, /ORDER BY j\.last_seen_at DESC, j\.encrypt_job_id ASC/);
    assert.match(jobsQueries, /list_job_candidates_pages_all_jobs_by_time_range/);
    assert.match(jobsQueries, /list_job_candidates_filters_status_source_and_collection_method/);
    assert.match(jobsTypes, /export interface JobCandidatePage/);
    assert.match(jobsTypes, /collection_method: CollectionMethod/);
    assert.match(jobsTypes, /ai_audit_status: string/);
    assert.match(jobsTypes, /ai_audit_summary: string/);
    assert.match(jobsTypes, /filter_summary: string/);
    assert.match(jobsTypes, /export type CollectionMethod = "manual" \| "automatic"/);
    assert.match(jobsTypes, /COLLECTION_METHOD_LABELS/);
    assert.match(jobsModels, /#\[serde\(skip_serializing\)\]\s+pub filter_reason_json/);
    assert.match(jobsModels, /fn summarize_ai_audit/);
    assert.match(jobsModels, /fn summarize_filter_reason/);
    assert.match(jobsModels, /ai_audit_status: ai_audit\.status/);
    assert.match(jobsModels, /ai_audit_summary: ai_audit\.summary/);
    assert.match(jobsModels, /filter_summary/);

    assert.match(jobItem, /AI 结果：\{\{ aiAuditStatusLabel\(aiAuditStatus\) \}\}/);
    assert.match(jobItem, /props\.job\.ai_audit_status/);
    assert.match(jobItem, /props\.job\.ai_audit_summary/);
    assert.doesNotMatch(jobItem, /formatFilterReasonSummary/);
    assert.doesNotMatch(jobItem, /parseFilterReasonJson/);
    assert.match(jobItem, /平台：\{\{ sourcePlatformLabel\(job\.source_platform\) \}\}/);
    assert.match(jobItem, /岗位状态：\{\{ reviewStatusLabel\(job\.review_status\) \}\}/);
    assert.match(jobItem, /原因：\{\{ aiAuditReasonText \}\}/);
    assert.doesNotMatch(jobItem, /综合分/);
    assert.doesNotMatch(jobItem, /简历分/);
    assert.doesNotMatch(jobItem, /偏好分/);
    assert.doesNotMatch(jobItem, /公司分/);
    assert.doesNotMatch(jobItem, /实际权重/);
    assert.doesNotMatch(jobItem, /偏好摘要/);
    assert.doesNotMatch(jobItem, /评分摘要/);
    assert.match(jobsTypes, /COMPANY_RISK_FLAG_LABELS/);
    assert.match(jobsTypes, /low_info_risk: "信息过少"/);
    assert.match(jobsTypes, /companyRiskFlagLabel/);
    assert.match(jobsTypes, /风险标签：/);
    assert.match(jobsTypes, /company_score\?: number/);
    assert.match(jobsTypes, /company_score: asFiniteNumber\(parsed\.company\.company_score\)/);
    assert.match(jobsTypes, /confidence\?: number/);
    assert.match(jobsTypes, /confidence: asFiniteNumber\(parsed\.company\.confidence\)/);

    assert.match(jobsLogic, /async function updateReviewStatus/);
    assert.match(jobsLogic, /async function restoreReviewCandidate/);
    assert.match(jobsLogic, /async function updateCommunicationStatus/);
    assert.match(jobsLogic, /async function updateReviewNotes/);
    assert.match(jobsLogic, /async function blacklistCompany/);
    assert.match(jobsLogic, /async function blacklistJob/);
    assert.match(jobsLogic, /async function blacklistKeyword/);
    assert.match(jobsPage, /import JobsConfirmDialog/);
    assert.match(jobsPage, /confirmDialog/);
    assert.match(jobsPage, /closeConfirm/);
    assert.match(jobsPage, /executeConfirm/);
    assert.match(jobsPage, /<JobsConfirmDialog/);
    assert.match(jobsPage, /:visible="confirmDialog\.visible"/);
    assert.match(jobsPage, /@close="closeConfirm"/);
    assert.match(jobsPage, /@confirm="executeConfirm"/);

    assert.match(jobItem, /平台：\{\{ sourcePlatformLabel\(job\.source_platform\) \}\}/);
    assert.match(jobItem, /职位 ID\/去重：\{\{ job\.dedup_key \}\}/);
    assert.match(jobItem, /来源链接：\{\{ job\.source_url \}\}/);
    assert.match(jobsTypes, /review_updated_at: string \| null/);
    assert.match(jobsLogic, /lastGreetedAt/);
    assert.match(jobItem, /沟通更新/);
    assert.match(jobItem, /import UiActionMenu/);
    assert.match(jobItem, /<UiActionMenu/);
    assert.match(jobItem, /@select="handleReviewAction"/);
    assert.match(jobItem, /@select="handleCommunicationAction"/);
    assert.match(jobItem, /@select="handleMoreAction"/);
    assert.match(jobItem, /:summary="reviewStatusLabel\(job\.review_status\)"/);
    assert.match(jobItem, /:summary="communicationStatusLabel\(job\.communication_status\)"/);
    assert.match(jobsLogic, /async function updateCommunicationStatus/);
    assert.match(jobsQueries, /rs\.updated_at/);
  });

  it("passes Top 20 filter, score, source and communication evidence into AI prompts", () => {
    const rustProtocol = readProjectFile("src-tauri/src/ipc/protocol.rs");
    const aiShared = readProjectFile("src-tauri/src/commands/ai/shared.rs");
    const greeting = readProjectFile("src-tauri/src/commands/ai/greeting.rs");
    const aiCommand = readProjectFile("src-tauri/src/commands/ai.rs");
    const postCollectionJudge = readProjectFile("src-tauri/src/commands/ai/post_collection_judge.rs");
    const workerProtocol = readProjectFile("packages/boss-crawler-worker/src/protocol.ts");
    const workerPrompt = readProjectFile("packages/boss-crawler-worker/src/ai/prompt.ts");
    const workerSingle = readProjectFile("packages/boss-crawler-worker/src/modes/ai/single.ts");
    const workerGreeting = readProjectFile("packages/boss-crawler-worker/src/modes/ai/greeting.ts");
    const workerAiContract = readProjectFile("packages/boss-crawler-worker/test/ai-contract.test.ts");

    for (const field of ["filter_reason", "score_reason", "source_context", "review_context"]) {
      assert.match(rustProtocol, new RegExp(`pub ${field}: Option<Value>`));
      assert.match(workerProtocol, new RegExp(`${field}: z\\.any\\(\\)\\.optional\\(\\)`));
      assert.match(workerPrompt, new RegExp(field));
      assert.match(workerAiContract, new RegExp(field));
    }

    assert.match(aiShared, /pub\(super\) struct JobAiContext/);
    assert.match(aiShared, /pub\(super\) fn load_job_ai_context/);
    assert.match(aiShared, /source_platform/);
    assert.match(aiShared, /allowed_source_platforms/);
    assert.match(aiShared, /communication_status/);
    assert.match(aiShared, /resume_match_score/);
    assert.match(aiShared, /attach_latest_resume_score_reason/);
    assert.match(aiShared, /matched_stack/);
    assert.match(aiShared, /matched_resume_evidence/);
    assert.match(aiShared, /company_score/);

    assert.match(aiCommand, /generate_greeting_message/);
    assert.match(aiCommand, /recompute_ai_post_collection_judgement/);
    assert.match(aiCommand, /generate_ai_company_scores/);
    assert.match(postCollectionJudge, /recompute_default_filter_profile_for_job_on_conn/);
    assert.match(postCollectionJudge, /recompute_default_filter_profile_on_conn/);
    assert.match(postCollectionJudge, /AiPostCollectionJudgeBatchPayload/);
    assert.match(postCollectionJudge, /CommandIn::AiPostCollectionJudgeBatch/);
    assert.match(postCollectionJudge, /default_post_collection_judge_concurrency/);
    assert.doesNotMatch(postCollectionJudge, /CommandIn::AiPostCollectionJudge\(payload\)/);
    assert.match(greeting, /let job_context = load_job_ai_context/);
    assert.match(greeting, /score_reason\["resume"\]\["matched_stack"\]\[0\]/);
    assert.match(greeting, /review_context: job_context\.review_context/);

    assert.match(workerSingle, /filterReason: payload\.filter_reason/);
    assert.match(workerSingle, /sourceContext: payload\.source_context/);
    assert.match(workerGreeting, /reviewContext: payload\.review_context/);
    assert.match(workerProtocol, /AiPostCollectionJudgeBatchPayloadSchema/);
    assert.match(workerProtocol, /AI_POST_COLLECTION_JUDGE_BATCH/);
    assert.match(workerPrompt, /筛选\/排序\/来源上下文 JSON/);
    assert.match(workerPrompt, /岗位摘要中的 filter_reason、score_reason、source_context、review_context/);
    assert.match(workerPrompt, /不能替代简历原文中的候选人事实/);
    assert.match(workerPrompt, /来源与审核摘要 JSON/);
    assert.match(workerPrompt, /不得写进 message、candidateEvidence 或 jobEvidence/);
    assert.match(workerPrompt, /优先使用匹配报告或评分理由中的 resume\.matched_stack/);
    assert.match(workerPrompt, /candidateEvidence 必须来自简历原文、当前情况说明、匹配报告或评分理由/);
    assert.match(workerAiContract, /matched_resume_evidence: \["候选人建设过 Kubernetes 多集群发布平台"/);
    assert.match(workerAiContract, /builds group prompts with per-job filter, score, source and review context/);
    assert.match(workerAiContract, /greeted_unread/);
    assert.match(workerAiContract, /allowed_source_platforms/);
  });

  it("keeps job-specific optimized resume generation preview-only and wired through the resume library", () => {
    const rustProtocol = readProjectFile("src-tauri/src/ipc/protocol.rs");
    const aiCommand = readProjectFile("src-tauri/src/commands/ai.rs");
    const optimizedResumeCommand = readProjectFile("src-tauri/src/commands/ai/optimized_resume.rs");
    const resumeLibrary = readProjectFile("src-tauri/src/resume_library.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const workerProtocol = readProjectFile("packages/boss-crawler-worker/src/protocol.ts");
    const workerAiMode = readProjectFile("packages/boss-crawler-worker/src/modes/ai.ts");
    const workerMain = readProjectFile("packages/boss-crawler-worker/src/main.ts");
    const workerPrompt = readProjectFile("packages/boss-crawler-worker/src/ai/prompt.ts");
    const workerSchema = readProjectFile("packages/boss-crawler-worker/src/modes/ai/schemas.ts");
    const workerResumeOptimize = readProjectFile("packages/boss-crawler-worker/src/modes/ai/resumeOptimize.ts");
    const workerAiContract = readProjectFile("packages/boss-crawler-worker/test/ai-contract.test.ts");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const frontendResumeLibrary = readProjectFile("src/lib/resumeLibrary.ts");
    const optimizedResumeProductionCode = optimizedResumeCommand.split("#[cfg(test)]")[0];

    assert.match(workerProtocol, /AiOptimizeResumeForJobPayloadSchema/);
    assert.match(workerProtocol, /AI_OPTIMIZE_RESUME_FOR_JOB/);
    assert.match(workerAiMode, /runAiOptimizeResumeForJobMode/);
    assert.match(workerMain, /case "AI_OPTIMIZE_RESUME_FOR_JOB"/);
    assert.match(workerPrompt, /buildResumeOptimizePrompts/);
    assert.match(workerPrompt, /不能编造事实/);
    assert.match(workerPrompt, /不得新增候选人没有提供的公司、项目、指标、技术栈、证书、学历、职责或成果/);
    assert.match(workerPrompt, /optimized_resume_markdown/);
    assert.match(workerSchema, /AiOptimizeResumeForJobResultSchema/);
    assert.match(workerSchema, /optimized_resume_markdown/);
    assert.match(workerSchema, /evidence/);
    assert.match(workerSchema, /risks/);
    assert.match(workerResumeOptimize, /AiOptimizeResumeForJobResultSchema\.safeParse/);
    assert.match(workerResumeOptimize, /AI_RESULT/);
    assert.match(workerAiContract, /builds job-specific resume prompts/);
    assert.match(workerAiContract, /rejects incomplete Markdown/);

    assert.match(rustProtocol, /AiOptimizeResumeForJobPayload/);
    assert.match(rustProtocol, /AiOptimizeResumeForJob\(AiOptimizeResumeForJobPayload\)/);
    assert.match(aiCommand, /pub async fn generate_optimized_resume_for_job/);
    assert.match(optimizedResumeCommand, /resolve_source_resume/);
    assert.match(optimizedResumeCommand, /resolve_resume_text_by_id/);
    assert.match(optimizedResumeCommand, /resolve_resume_text_for_job/);
    assert.match(optimizedResumeCommand, /CommandIn::AiOptimizeResumeForJob/);
    assert.match(optimizedResumeCommand, /source_resume/);
    assert.match(optimizedResumeCommand, /请先在简历库为该岗位关联简历，或设置一份默认简历/);
    assert.doesNotMatch(optimizedResumeProductionCode, /create_resume|link_resume_to_jobs|update_resume/);
    assert.match(resumeLibrary, /pub struct ResolvedResume/);
    assert.match(resumeLibrary, /pub fn resolve_resume_text_by_id/);
    assert.match(tauriLib, /commands::ai::generate_optimized_resume_for_job/);

    assert.match(frontendResumeLibrary, /export interface OptimizedResumeForJobResult/);
    assert.match(jobItem, /生成岗位版简历/);
    assert.match(jobItem, /generate-optimized-resume/);
    assert.match(jobsPage, /岗位版简历预览/);
    assert.match(jobsPage, /保存并关联岗位/);
    assert.match(jobsPage, /复制 Markdown/);
    assert.match(jobsLogic, /invoke<OptimizedResumeForJobResult>\("generate_optimized_resume_for_job"/);
    assert.match(jobsLogic, /createResume\(title, preview\.optimized_resume_markdown\)/);
    assert.match(jobsLogic, /linkResumeToJobs\(createdResumeId, \[job\.encrypt_job_id\]\)/);
    assert.match(jobsLogic, /loadResumeStatusesForJobs\(jobCandidates\.value\)/);
    assert.doesNotMatch(jobsLogic, /updateResume\(/);
    assert.doesNotMatch(jobsPage, /resume-workspace/);
    assert.doesNotMatch(jobItem, /自动投递|自动发送/);
  });

  it("keeps resume library navigation and job resume-status loading free of duplicate work", () => {
    const appShell = readProjectFile("src/App.vue");
    const resumeLibraryRust = readProjectFile("src-tauri/src/resume_library.rs");
    const resumeLibraryTypes = readProjectFile("src/lib/resumeLibrary.ts");
    const resumeLibraryPageLogic = readProjectFile("src/lib/useResumeLibraryPage.ts");
    const resumeLibraryPage = readProjectFile("src/pages/ResumeLibrary.vue");
    const resumeLibraryCommand = readProjectFile("src-tauri/src/commands/resume_library.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const resumeListItemSource =
      resumeLibraryRust.match(/pub struct ResumeListItem[\s\S]*?\n}\n/)?.[0] ?? "";
    const resumeOverviewSource =
      resumeLibraryRust.match(/pub struct ResumeLibraryOverview[\s\S]*?\n}\n/)?.[0] ?? "";
    const frontendResumeListItemSource =
      resumeLibraryTypes.match(/export interface ResumeListItem[\s\S]*?\n}\n/)?.[0] ?? "";
    const frontendResumeOverviewSource =
      resumeLibraryTypes.match(/export interface ResumeLibraryOverview[\s\S]*?\n}\n/)?.[0] ?? "";
    const getStatusesSource =
      resumeLibraryRust.match(/pub fn get_statuses_for_jobs[\s\S]*?\n}\n\npub fn resolve_resume_text_for_job/)?.[0] ?? "";
    const selectResumeSource =
      resumeLibraryPageLogic.match(/async function selectResume[\s\S]*?\n  }\n/)?.[0] ?? "";

    assert.doesNotMatch(appShell, /<KeepAlive>/);
    assert.match(resumeLibraryRust, /pub struct ResumeListItem/);
    assert.doesNotMatch(resumeListItemSource, /body:/);
    assert.match(resumeLibraryRust, /pub struct ResumeLibraryOverview/);
    assert.doesNotMatch(resumeOverviewSource, /ResumeRecord|body:/);
    assert.match(resumeLibraryRust, /pub selected_resume: Option<ResumeRecord>/);
    assert.match(resumeLibraryRust, /pub fn get_overview/);
    assert.match(resumeLibraryRust, /pub fn get_record/);
    assert.match(resumeLibraryRust, /fn overview_omits_resume_body_and_record_loads_it_on_demand/);
    assert.match(resumeLibraryCommand, /pub fn get_resume_library_overview/);
    assert.match(resumeLibraryCommand, /pub fn get_resume_record/);
    assert.match(tauriLib, /commands::resume_library::get_resume_library_overview/);
    assert.match(tauriLib, /commands::resume_library::get_resume_record/);
    assert.match(resumeLibraryTypes, /export interface ResumeRecord extends ResumeListItem/);
    assert.doesNotMatch(frontendResumeListItemSource, /body:/);
    assert.match(resumeLibraryTypes, /export interface ResumeLibraryOverview/);
    assert.doesNotMatch(frontendResumeOverviewSource, /body:/);
    assert.match(resumeLibraryTypes, /"get_resume_library_overview"/);
    assert.match(resumeLibraryTypes, /"get_resume_record"/);

    assert.match(resumeLibraryRust, /fn status_for_job_from_index/);
    assert.match(getStatusesSource, /let index = read_index\(app_data_dir\)\?/);
    assert.match(getStatusesSource, /status_for_job_from_index\(&index, job_id\)/);
    assert.doesNotMatch(getStatusesSource, /get_status_for_job\(app_data_dir, job_id\)/);

    assert.match(resumeLibraryPageLogic, /watch\(\s*\(\) => route\.query\.resumeId/);
    assert.match(selectResumeSource, /router\.replace\(\{ path: "\/resume-library"/);
    assert.doesNotMatch(selectResumeSource, /load\(resumeId\)/);
    assert.match(resumeLibraryPageLogic, /getResumeLibraryOverview/);
    assert.match(resumeLibraryPageLogic, /getResumeRecord/);
    assert.match(resumeLibraryPageLogic, /async function ensureSelectedResumeLoaded/);
    assert.match(resumeLibraryPageLogic, /detailRequestId/);

    assert.match(resumeLibraryPage, /const renderPreview = ref\(false\)/);
    assert.match(resumeLibraryPage, /await ensureSelectedResumeLoaded\(\)/);
    assert.match(resumeLibraryPage, /window\.requestAnimationFrame\(\(\) => \{/);
    assert.match(resumeLibraryPage, /v-if="renderPreview"[\s\S]{0,120}v-html="renderedResumeHtml"/);
  });

  it("keeps navigation hot-path reads out of database migration work", () => {
    const dbModule = readProjectFile("src-tauri/src/db/mod.rs");
    const jobsShared = readProjectFile("src-tauri/src/commands/jobs/shared.rs");
    const filterProfileCommands = readProjectFile("src-tauri/src/commands/filter_profile.rs");
    const resumeLibraryRust = readProjectFile("src-tauri/src/resume_library.rs");
    const dbTests = readProjectFile("src-tauri/src/db/tests.rs");
    const getDefaultFilterSource =
      filterProfileCommands.match(/pub fn get_default_filter_profile[\s\S]*?\n}\n\n#\[tauri::command\]/)?.[0] ?? "";
    const listProfilesSource =
      filterProfileCommands.match(/pub fn list_filter_profiles[\s\S]*?\n}\n\n#\[tauri::command\]/)?.[0] ?? "";

    assert.match(dbModule, /pub fn init_db[\s\S]*?migrate::migrate\(&conn\)\?/);
    assert.match(dbModule, /pub fn connect_db[\s\S]*?open_db\(app_data_dir\)/);
    assert.match(jobsShared, /db::connect_db\(app_data_dir\)/);
    assert.doesNotMatch(jobsShared, /db::init_db\(app_data_dir\)/);
    assert.match(getDefaultFilterSource, /db::connect_db\(&app_data_dir\)/);
    assert.match(listProfilesSource, /db::connect_db\(&app_data_dir\)/);
    assert.match(resumeLibraryRust, /fn job_summaries_for_ids[\s\S]*?db::connect_db\(app_data_dir\)/);
    assert.doesNotMatch(resumeLibraryRust, /fn job_summaries_for_ids[\s\S]*?db::init_db\(app_data_dir\)/);
    assert.match(dbTests, /connect_db_opens_runtime_connection_without_running_migrations/);
  });

  it("keeps job library rows free of raw filter evidence on the frontend hot path", () => {
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobsModels = readProjectFile("src-tauri/src/commands/jobs/models.rs");
    const qualityGuide = readProjectFile(".trellis/spec/boss-crawler-worker/frontend/quality-guidelines.md");

    assert.match(jobsTypes, /filter_reason_json\?: string \| null/);
    assert.match(jobsTypes, /filter_summary: string/);
    assert.match(jobsModels, /#\[serde\(skip_serializing\)\]\s+pub filter_reason_json/);
    assert.match(jobsModels, /pub filter_summary: String/);
    assert.match(jobsModels, /struct SummaryProjection/);
    assert.match(jobsModels, /unwrap_or_else\(\|\| summarize_filter_reason/);
    assert.match(jobsLogic, /job\.filter_summary\?\.trim\(\)/);
    assert.doesNotMatch(jobsLogic, /parseFilterReasonJson\(job\.filter_reason_json\)/);
    assert.doesNotMatch(jobItem, /parseFilterReasonJson/);
    assert.doesNotMatch(jobItem, /filter_reason_json/);
    assert.match(qualityGuide, /Do not make every row component parse large JSON/);
  });

  it("keeps local Company Score batch rebuild wired without adding a separate jobs-page panel", () => {
    const dbModels = readProjectFile("src-tauri/src/db/models/company_score.rs");
    const dbExports = readProjectFile("src-tauri/src/db/models.rs");
    const dbTests = readProjectFile("src-tauri/src/db/tests.rs");
    const jobsCommand = readProjectFile("src-tauri/src/commands/jobs.rs");
    const jobsMutations = readProjectFile("src-tauri/src/commands/jobs/mutations.rs");
    const jobsModels = readProjectFile("src-tauri/src/commands/jobs/models.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");

    assert.match(dbModels, /pub\(crate\) fn rebuild_company_scores/);
    assert.match(dbModels, /DELETE FROM company_score/);
    assert.match(dbModels, /GROUP_CONCAT/);
    assert.match(dbExports, /rebuild_company_scores/);
    assert.match(dbTests, /rebuild_company_scores_recomputes_local_batch_cache_from_jobs/);
    assert.match(jobsModels, /pub struct CompanyScoreRebuildResult/);
    assert.match(jobsMutations, /pub fn rebuild_company_scores/);
    assert.match(jobsCommand, /pub fn rebuild_company_scores/);
    assert.match(tauriLib, /commands::jobs::rebuild_company_scores/);
    assert.match(jobsTypes, /export interface CompanyScoreRebuildResult/);
    assert.match(jobsLogic, /invoke<CompanyScoreRebuildResult>\("rebuild_company_scores"\)/);
    assert.match(jobsLogic, /companyScoreRebuildMessage/);
    assert.match(jobsLogic, /refreshAfterJobStateChange\(false\)/);
  });

  it("keeps database indexes for jobs and resume library performance hot paths", () => {
    const schema = readProjectFile("src-tauri/src/db/schema.sql");
    const migrate = readProjectFile("src-tauri/src/db/migrate.rs");
    const dbTests = readProjectFile("src-tauri/src/db/tests.rs");

    for (const indexName of [
      "idx_job_last_seen_id",
      "idx_job_source_link_keyword_job",
      "idx_ai_report_latest_resume",
      "idx_job_detail_projection_hash",
      "idx_job_source_payload_hash",
      "idx_job_search_projection_hash",
      "idx_job_list_summary_projection_hash",
    ]) {
      assert.match(schema, new RegExp(indexName));
      assert.match(migrate, new RegExp(indexName));
      assert.match(dbTests, new RegExp(indexName));
    }

    const jobsQueries = readProjectFile("src-tauri/src/commands/jobs/queries.rs");
    const jobsModels = readProjectFile("src-tauri/src/db/models/jobs.rs");
    const jobProjection = readProjectFile("src-tauri/src/db/models/job_projection.rs");

    assert.match(schema, /CREATE TABLE IF NOT EXISTS job_detail_projection/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS job_source_payload/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS job_search_projection/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS job_list_summary_projection/);
    assert.match(jobProjection, /pub\(crate\) fn build_job_detail_projection/);
    assert.match(jobProjection, /pub\(crate\) fn backfill_job_detail_projections/);
    assert.match(jobsModels, /upsert_job_detail_projection\(conn, encrypt_job_id, zp_data_json\)/);
    assert.match(jobsModels, /refresh_job_derived_projections/);
    assert.match(migrate, /refresh_all_job_projections\(conn\)\?/);
    assert.match(jobsModels, /pub\(crate\) fn refresh_all_job_projections/);
    assert.match(jobsModels, /backfill_job_source_payloads\(conn\)\?/);
    assert.match(jobsModels, /backfill_job_detail_projections\(conn\)\?/);
    assert.match(jobsModels, /backfill_job_search_projections\(conn\)\?/);
    assert.match(jobsModels, /backfill_job_list_summary_projections\(conn\)\?/);
    assert.match(migrate, /job_search_projection p/);
    assert.doesNotMatch(migrate, /SELECT zp_data_json FROM job_detail_raw d WHERE d\.encrypt_job_id = NEW\.encrypt_job_id/);
    assert.match(migrate, /fn ensure_performance_indexes/);
    assert.match(dbTests, /init_db_creates_library_performance_indexes/);
    assert.match(dbTests, /job_detail_projection_backfill_is_idempotent_and_refreshes_changed_raw_detail/);
    assert.match(dbTests, /job_source_payload_backfill_and_upsert_keep_raw_payload_cold/);
    assert.match(dbTests, /job_search_projection_backfill_feeds_fts_without_raw_json/);
    assert.match(jobsQueries, /fn build_job_candidate_from_sql/);
    assert.match(jobsQueries, /LEFT JOIN job_search_projection sp ON sp\.encrypt_job_id = j\.encrypt_job_id/);
    assert.match(jobsQueries, /LEFT JOIN job_list_summary_projection lsp ON lsp\.encrypt_job_id = j\.encrypt_job_id/);
    assert.match(jobsQueries, /OR sp\.search_text LIKE \?/);
    assert.doesNotMatch(jobsQueries, /j\.raw_payload_json/);
    assert.doesNotMatch(jobsQueries, /cs\.evidence_json/);
    assert.doesNotMatch(jobsQueries, /SELECT ar\.result_json/);
    assert.match(jobsQueries, /lsp\.score_reason_json/);
    assert.match(jobsQueries, /SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = \?1/);
    assert.match(jobsQueries, /list_job_candidates_skips_detail_join_until_detail_search_is_needed/);
    assert.match(jobsQueries, /detail search should not touch raw detail JSON/);
  });

  it("keeps AI Company Score batch generation wired to worker and cache", () => {
    const workerProtocol = readProjectFile("packages/boss-crawler-worker/src/protocol.ts");
    const workerAiMode = readProjectFile("packages/boss-crawler-worker/src/modes/ai.ts");
    const workerMain = readProjectFile("packages/boss-crawler-worker/src/main.ts");
    const workerPrompt = readProjectFile("packages/boss-crawler-worker/src/ai/prompt.ts");
    const workerCompanyScore = readProjectFile("packages/boss-crawler-worker/src/modes/ai/companyScore.ts");
    const rustProtocol = readProjectFile("src-tauri/src/ipc/protocol.rs");
    const aiCommand = readProjectFile("src-tauri/src/commands/ai.rs");
    const aiCompanyScoreCommand = readProjectFile("src-tauri/src/commands/ai/company_score.rs");
    const dbModels = readProjectFile("src-tauri/src/db/models/company_score.rs");
    const dbExports = readProjectFile("src-tauri/src/db/models.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");

    assert.match(workerProtocol, /AiCompanyScoreBatchPayloadSchema/);
    assert.match(workerProtocol, /AI_COMPANY_SCORE_BATCH/);
    assert.match(workerAiMode, /runAiCompanyScoreBatchMode/);
    assert.match(workerMain, /case "AI_COMPANY_SCORE_BATCH"/);
    assert.match(workerPrompt, /buildCompanyScoreBatchPrompts/);
    assert.match(workerPrompt, /Company Score 用于人工审核排序，不是自动投递或自动联系动作/);
    assert.match(workerCompanyScore, /AiCompanyScoreBatchResultSchema/);
    assert.match(workerCompanyScore, /AI 公司评分缺少/);
    assert.match(rustProtocol, /AiCompanyScoreBatchPayload/);
    assert.match(rustProtocol, /AiCompanyScoreBatch\(AiCompanyScoreBatchPayload\)/);
    assert.match(aiCommand, /pub async fn generate_ai_company_scores/);
    assert.match(aiCompanyScoreCommand, /recompute_missing_default_filter_profile_on_conn/);
    assert.match(aiCompanyScoreCommand, /NOT IN \('favorited', 'ready_to_apply', 'ignored', 'applied'\)/);
    assert.match(aiCompanyScoreCommand, /CommandIn::AiCompanyScoreBatch/);
    assert.match(aiCompanyScoreCommand, /upsert_company_score/);
    assert.match(dbModels, /pub\(crate\) fn upsert_company_score/);
    assert.match(dbExports, /upsert_company_score/);
    assert.match(tauriLib, /commands::ai::generate_ai_company_scores/);
    assert.match(jobsTypes, /export interface AiCompanyScoreBatchResult/);
    assert.match(jobsLogic, /invoke<AiCompanyScoreBatchResult>\("generate_ai_company_scores"/);
    assert.match(jobsLogic, /aiCompanyScoreGenerating/);
    assert.match(jobsLogic, /interface AiCompanyScoreErrorState/);
    assert.match(jobsLogic, /describeAiCompanyScoreFailure/);
    assert.match(jobsLogic, /AI 公司评分结构化输出解析失败/);
    assert.match(jobsLogic, /模型返回的公司评分不符合 JSON 或字段约束/);
    assert.match(jobsLogic, /暂无可评分公司/);
    assert.match(jobsLogic, /aiCompanyScoreError\.value = describeAiCompanyScoreFailure\(message\)/);
    assert.match(jobsLogic, /refreshAfterJobStateChange\(false\)/);
  });

  it("keeps filter reason dimensions compatible with nested salary and experience output", () => {
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const filterProfileCommand = readProjectFile("src-tauri/src/commands/filter_profile.rs");

    assert.match(filterProfileCommand, /"salary": \{/);
    assert.match(filterProfileCommand, /"experience": \{/);
    assert.match(jobsTypes, /salary_desc: asString\(parsed\.dimensions\.salary_desc\) \?\? asString\(parsed\.dimensions\.salary\?\.raw\)/);
    assert.match(jobsTypes, /experience_name: asString\(parsed\.dimensions\.experience_name\) \?\? asString\(parsed\.dimensions\.experience\?\.raw\)/);
    assert.match(jobsTypes, /review_status: asString\(parsed\.dimensions\.review_status\)/);
    assert.match(jobItem, /AI 结果：\{\{ aiAuditStatusLabel\(aiAuditStatus\) \}\}/);
    assert.match(jobItem, /原因：\{\{ aiAuditReasonText \}\}/);
    assert.match(jobItem, /props\.job\.ai_audit_status/);
    assert.match(jobItem, /props\.job\.ai_audit_summary/);
    assert.match(jobItem, /aiAuditReasonText/);
    assert.match(jobItem, /aiPostCollectionJudgementText/);
    assert.doesNotMatch(jobItem, /filterDimensions\.(salary_desc|experience_name|review_status)/);
  });

  it("keeps the default profile biased toward target tech directions without hard-filtering them", () => {
    const crawlTypes = readProjectFile("src/lib/crawl.ts");
    const filterProfile = readProjectFile("src/lib/filterProfile.ts");
    const dbDefaults = readProjectFile("src-tauri/src/db/models/filter_results.rs");
    const dbTests = readProjectFile("src-tauri/src/db/tests.rs");

    assert.match(crawlTypes, /DEFAULT_PREFERENCE_DIRECTIONS/);
    assert.match(crawlTypes, /DEFAULT_PREFERENCE_DIRECTIONS[\s\S]{0,180}"Go"[\s\S]{0,80}"云原生"/);
    assert.match(crawlTypes, /DEFAULT_PREFERENCE_TECH_TAGS/);
    assert.match(crawlTypes, /DEFAULT_PREFERENCE_TECH_TAGS[\s\S]{0,180}"Go"[\s\S]{0,80}"Terraform"/);
    assert.match(filterProfile, /DEFAULT_PREFERENCE_DIRECTIONS\.join\("\\n"\)/);
    assert.match(filterProfile, /DEFAULT_PREFERENCE_TECH_TAGS\.join\("\\n"\)/);
    assert.match(dbDefaults, /"preferenceDirections"/);
    assert.match(dbDefaults, /"preferenceDirections"[\s\S]*"Go"[\s\S]*"云原生"/);
    assert.match(dbDefaults, /"preferenceTechTags"/);
    assert.match(dbDefaults, /"preferenceTechTags"[\s\S]*"Go"[\s\S]*"Terraform"/);
    assert.match(dbDefaults, /"requiredDirections"\.to_string\(\), Value::Array\(vec!\[\]\)/);
    assert.match(dbDefaults, /"requiredTechTags"\.to_string\(\), Value::Array\(vec!\[\]\)/);
    assert.match(dbTests, /default preference direction/);
    assert.match(dbTests, /default preference tech tag/);
  });

  it("keeps a single default post-collection rule config in the user-facing pages", () => {
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const dbModels = readProjectFile("src-tauri/src/db/models/filter_results.rs");
    const filterProfileCommand = readProjectFile("src-tauri/src/commands/filter_profile.rs");
    const filterProfile = readProjectFile("src/lib/filterProfile.ts");
    const crawlPage = readProjectFile("src/pages/Crawl.vue");
    const crawlPageLogic = readProjectFile("src/lib/useCrawlPage.ts");
    const crawlConfigPage = readProjectFile("src/pages/CrawlConfig.vue");

    for (const command of ["list_filter_profiles", "save_filter_profile", "set_default_filter_profile_id"]) {
      assert.match(tauriLib, new RegExp(`commands::filter_profile::${command}`));
      assert.match(filterProfileCommand, new RegExp(`pub fn ${command}`));
      assert.match(filterProfile, new RegExp(`"${command}"`));
    }

    assert.match(dbModels, /pub\(crate\) fn list_filter_profiles/);
    assert.match(dbModels, /pub\(crate\) fn upsert_filter_profile/);
    assert.match(dbModels, /pub\(crate\) fn set_default_filter_profile_id/);
    assert.match(filterProfileCommand, /clean_filter_profile_name/);
    assert.match(filterProfileCommand, /new_filter_profile_id/);
    assert.match(filterProfileCommand, /profile_id/);
    assert.match(filterProfile, /filterProfiles = ref<FilterProfileRecord\[\]>\(\[\]\)/);
    assert.match(filterProfile, /activeFilterProfileId = ref\("default"\)/);
    assert.match(filterProfile, /activeFilterProfileName = ref\("默认采后规则"\)/);
    assert.match(filterProfile, /function applyFilterProfileRecord/);
    assert.match(filterProfile, /function selectFilterProfile/);
    assert.match(filterProfile, /function saveActiveFilterProfile/);
    assert.match(filterProfile, /function createFilterProfile/);
    assert.match(filterProfile, /function setActiveFilterProfileAsDefault/);
    assert.match(filterProfileCommand, /fn set_default_filter_profile_id_on_conn/);
    assert.match(filterProfileCommand, /recompute_default_filter_profile_on_conn\(conn\)\?/);

    assert.doesNotMatch(crawlPage, /采后规则集/);
    assert.doesNotMatch(crawlPage, /activeFilterProfileId/);
    assert.doesNotMatch(crawlPage, /selectFilterProfile/);
    assert.match(crawlConfigPage, /默认采后规则/);
    assert.match(crawlConfigPage, /保存配置/);
    assert.match(crawlConfigPage, /保存并重算/);
    for (const removedCopy of ["当前规则集", "规则集名称", "新建规则集", "保存规则集", "设为默认", "默认策略"]) {
      assert.doesNotMatch(crawlConfigPage, new RegExp(removedCopy));
    }
    assert.doesNotMatch(crawlConfigPage, /activeFilterProfileId/);
    assert.doesNotMatch(crawlConfigPage, /selectFilterProfile/);
    assert.doesNotMatch(crawlConfigPage, /createFilterProfile/);
    assert.doesNotMatch(crawlConfigPage, /setActiveFilterProfileAsDefault/);
    assert.match(crawlPageLogic, /filterRecomputeMessage\.value = "已保存采后规则"/);
  });

  it("keeps the crawl page focused on automatic collection with delay only", () => {
    const crawlPage = readProjectFile("src/pages/Crawl.vue");
    const crawlLogic = readProjectFile("src/lib/useCrawlPage.ts");
    const crawlTypes = readProjectFile("src/lib/crawl.ts");
    const workerMain = readProjectFile("packages/boss-crawler-worker/src/main.ts");
    const crawlConfigPage = readProjectFile("src/pages/CrawlConfig.vue");

    assert.match(crawlPage, /自动采集/);
    assert.match(crawlPage, /延迟 \(ms\)/);
    assert.doesNotMatch(crawlPage, /手动采集/);
    assert.doesNotMatch(crawlPage, /最大页数/);
    assert.doesNotMatch(crawlPage, /最大职位数/);
    assert.doesNotMatch(crawlConfigPage, /采集限制/);
    assert.doesNotMatch(crawlConfigPage, /最大页数/);
    assert.doesNotMatch(crawlConfigPage, /最大职位数/);
    assert.doesNotMatch(crawlLogic, /mode === "manual"/);
    assert.doesNotMatch(crawlLogic, /crawl_manual_start/);
    assert.doesNotMatch(crawlTypes, /DEFAULT_CRAWL_MODE/);
    assert.doesNotMatch(crawlTypes, /CRAWL_TASK_TYPE_MANUAL/);
    assert.doesNotMatch(workerMain, /CRAWL_MANUAL_START/);
  });

  it("keeps crawl entry navigation lightweight without loading the cron editor in the route shell", () => {
    const appShell = readProjectFile("src/App.vue");
    const router = readProjectFile("src/router.ts");
    const crawlPage = readProjectFile("src/pages/Crawl.vue");
    const crawlConfigPage = readProjectFile("src/pages/CrawlConfig.vue");
    const crawlLogic = readProjectFile("src/lib/useCrawlPage.ts");
    const frontendQualityGuide = readProjectFile(".trellis/spec/boss-crawler-worker/frontend/quality-guidelines.md");
    const configInitializer =
      crawlLogic.match(/async function initialize\(\): Promise<void> \{[\s\S]*?\n  }\n/)?.[0] ?? "";
    const runtimeInitializer =
      crawlLogic.match(/async function initializeRuntime\(\): Promise<void> \{[\s\S]*?\n  }\n/)?.[0] ?? "";

    assert.match(router, /import Crawl from "\.\/pages\/Crawl\.vue"/);
    assert.match(router, /import CrawlConfig from "\.\/pages\/CrawlConfig\.vue"/);
    assert.match(router, /path: "\/crawl", component: Crawl/);
    assert.match(router, /path: "\/crawl-config", component: CrawlConfig/);
    assert.doesNotMatch(appShell, /import\("\.\/pages\/CrawlConfig\.vue"\)/);
    assert.match(crawlConfigPage, /defineAsyncComponent\(async \(\) => \(await import\("@vue-js-cron\/light"\)\)\.CronLight\)/);
    assert.match(crawlConfigPage, /runAfterInitialPaint\(\(\) => \{[\s\S]{0,80}cronEditorReady\.value = true/);
    assert.match(crawlConfigPage, /v-if="cronEditorReady"/);
    assert.match(crawlPage, /useCrawlPage\(\{ initialize: "runtime" \}\)/);
    assert.match(crawlLogic, /type CrawlPageInitializeMode = "full" \| "runtime" \| "schedule"/);
    assert.match(configInitializer, /initializeSchedule/);
    assert.match(configInitializer, /loadCollectionSources/);
    assert.match(configInitializer, /runAfterInitialPaint\(\(\) => \{/);
    assert.match(configInitializer, /loadBossMeta/);
    assert.match(configInitializer, /loadDefaultFilterProfile/);
    assert.doesNotMatch(configInitializer, /refreshCollectionSourceState/);
    assert.match(crawlLogic, /options\.initialize === "runtime"[\s\S]{0,120}runAfterInitialPaint\(\(\) => void state\.initializeRuntime\(\)\)/);
    assert.match(runtimeInitializer, /initializeSchedule/);
    assert.match(runtimeInitializer, /refreshCollectionSourceState/);
    assert.doesNotMatch(runtimeInitializer, /loadBossMeta/);
    assert.doesNotMatch(runtimeInitializer, /loadDefaultFilterProfile/);
    assert.match(frontendQualityGuide, /Split heavy widgets out of primary route shells/);
  });

  it("shows a short success log when normalized jobs are captured", () => {
    const runtime = readProjectFile("src/lib/runtime.ts");
    const crawlPanel = readProjectFile("src/components/crawl/CrawlRuntimePanel.vue");

    assert.match(runtime, /case "JOB_NORMALIZED_CAPTURED"/);
    assert.match(runtime, /已入库：\$\{evt\.payload\.position_name \?\? evt\.payload\.encrypt_job_id\}/);
    assert.match(crawlPanel, /运行日志/);
    assert.match(crawlPanel, /v-for="\(line, index\) in logs"/);
  });

  it("keeps scheduled crawl config app-open only and wired to the existing crawl flow", () => {
    const appShell = readProjectFile("src/App.vue");
    const crawlConfig = readProjectFile("src/pages/CrawlConfig.vue");
    const crawlLogic = readProjectFile("src/lib/useCrawlPage.ts");

    assert.match(appShell, /useCrawlPage\(\{ initialize: "schedule" \}\)/);
    assert.match(crawlConfig, /定时采集/);
    assert.match(crawlConfig, /crawlScheduleEnabled/);
    assert.match(crawlConfig, /crawlScheduleExpression/);
    assert.match(crawlConfig, /CronLight/);
    assert.match(crawlConfig, /未来 3 次触发/);
    assert.match(crawlConfig, /crawlScheduleNextRunLabel/);
    assert.match(crawlConfig, /crawlScheduleLastStatusLabel/);
    assert.match(crawlConfig, /crawlScheduleLastMessage/);

    assert.match(crawlLogic, /crawlScheduleEnabled\?: boolean/);
    assert.match(crawlLogic, /crawlScheduleExpression\?: string/);
    assert.match(crawlLogic, /crawlScheduleTime\?: string/);
    assert.match(crawlLogic, /DEFAULT_CRAWL_SCHEDULE_EXPRESSION/);
    assert.match(crawlLogic, /dailyTimeToCronExpression/);
    assert.match(crawlLogic, /resolveScheduleExpression/);
    assert.match(crawlLogic, /new Cron\(/);
    assert.match(crawlLogic, /mode: "5-part"/);
    assert.match(crawlLogic, /cronstrue/);
    assert.match(crawlLogic, /initializeSchedule/);
    assert.match(crawlLogic, /async function initializeSchedule\(\): Promise<void> \{[\s\S]*await Promise\.all\(\[[\s\S]*loadCollectionSources\(\),[\s\S]*loadDefaultFilterProfile\(\),[\s\S]*\]\);[\s\S]*await loadCollectionConfig\(\);[\s\S]*\}/);
    assert.match(crawlLogic, /rescheduleCrawlTimer/);
    assert.match(crawlLogic, /runScheduledCrawl/);
    assert.match(crawlLogic, /await start\(\)/);
    assert.match(crawlLogic, /采集任务正在运行，本次定时采集已跳过/);
    assert.match(crawlLogic, /collectionConfig: buildCollectionConfigPayload\(\)/);
    assert.doesNotMatch(crawlLogic, /system scheduler|后台常驻/);
  });

  it("keeps company scale, financing stage and industry wired as filter-profile dimensions", () => {
    const crawlTypes = readProjectFile("src/lib/crawl.ts");
    const filterProfile = readProjectFile("src/lib/filterProfile.ts");
    const dbDefaults = readProjectFile("src-tauri/src/db/models/filter_results.rs");
    const filterProfileCommand = readProjectFile("src-tauri/src/commands/filter_profile.rs");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const crawlConfigPage = readProjectFile("src/pages/CrawlConfig.vue");

    for (const field of [
      "companyRequiredScales",
      "companyExcludedScales",
      "companyPreferenceScales",
      "companyRequiredFinancingStages",
      "companyExcludedFinancingStages",
      "companyPreferenceFinancingStages",
      "companyRequiredIndustries",
      "companyExcludedIndustries",
      "companyPreferenceIndustries",
    ]) {
      assert.match(crawlTypes, new RegExp(`${field}: string\\[\\]`));
      assert.match(filterProfile, new RegExp(`${field}: parseList`));
      assert.match(filterProfile, new RegExp(`formatList\\(json\\.${field}\\)`));
      assert.match(dbDefaults, new RegExp(`"${field}"\\.to_string\\(\\)[\\s\\S]{0,120}Value::Array\\(vec!\\[\\]\\)`));
    }

    for (const rule of [
      "company_required_scale",
      "company_excluded_scale",
      "company_required_financing_stage",
      "company_excluded_financing_stage",
      "company_required_industries",
      "company_excluded_industries",
      "company_preference_industries",
      "company_scale",
      "company_financing",
      "company_industry",
    ]) {
      assert.match(filterProfileCommand, new RegExp(rule));
    }

    for (const removedConfigLabel of ["必须公司规模", "排除公司规模", "必须融资阶段", "排除融资阶段", "必须行业", "排除行业"]) {
      assert.doesNotMatch(crawlConfigPage, new RegExp(removedConfigLabel));
    }
    for (const legacySoftLabel of ["偏好公司规模", "偏好融资阶段", "偏好行业"]) {
      assert.doesNotMatch(crawlConfigPage, new RegExp(legacySoftLabel));
    }
  });

  it("keeps Boss config focused on verified platform-side filters", () => {
    const crawlConfig = readProjectFile("src/pages/CrawlConfig.vue");
    const crawlTypes = readProjectFile("src/lib/crawl.ts");
    const crawlLogic = readProjectFile("src/lib/useCrawlPage.ts");
    const workerShared = readProjectFile("packages/boss-crawler-worker/src/modes/auto/shared.ts");

    assert.match(crawlConfig, /Boss 搜索关键词/);
    assert.match(crawlConfig, /Go 远程/);
    assert.match(crawlTypes, /SECONDARY_BOSS_FILTER_FIELDS = new Set\(\["stage", "jobType"\]\)/);
    assert.doesNotMatch(crawlLogic, /buildBossSearchKeywordsFromIntent/);
    for (const supportedField of ["multiSubway", "multiBusinessDistrict", "position", "jobType", "stage"]) {
      assert.match(workerShared, new RegExp(`params\\.set\\("${supportedField}"`));
    }
    assert.doesNotMatch(crawlConfig, /Boss 活跃状态/);
    assert.doesNotMatch(crawlConfig, /最新排序/);
  });

  it("removes the generic collection intent layer from config UI and collection payloads", () => {
    const crawlConfig = readProjectFile("src/pages/CrawlConfig.vue");
    const crawlLogic = readProjectFile("src/lib/useCrawlPage.ts");

    for (const removedSymbol of [
      "collectionKeywordsText",
      "collectionTargetCitiesText",
      "collectionWorkModesText",
      "collectionTechStackText",
      "collectionExcludedKeywordsText",
      "collectionDegreesText",
      "collectionMinimumSalaryK",
      "collectionMaximumSalaryK",
      "collectionMinimumExperienceYears",
      "collectionMaximumExperienceYears",
      "collectionIntentSyncLabel",
      "syncCollectionIntentToPlatforms",
      "bossSyncMappedFields",
      "bossSyncUnmappedFields",
      "bossSyncMessage",
    ]) {
      assert.doesNotMatch(crawlConfig, new RegExp(removedSymbol));
      assert.doesNotMatch(crawlLogic, new RegExp(removedSymbol));
    }

    assert.doesNotMatch(crawlConfig, /同步到.*平台配置/);
    assert.doesNotMatch(crawlConfig, /<div class="ui-field-label">城市<\/div>/);
    assert.doesNotMatch(crawlConfig, /<div class="ui-field-label">方式<\/div>/);
    assert.doesNotMatch(crawlLogic, /collection_intent/);
  });

  it("keeps product copy centered on precise job research instead of automation", () => {
    const appShell = readProjectFile("src/App.vue");
    const crawlPage = readProjectFile("src/pages/Crawl.vue");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");

    assert.match(appShell, /精准求职工作台/);
    assert.match(crawlPage, /岗位采集/);
    assert.match(crawlPage, /只写入职位库/);
    assert.match(jobsPage, /职位库工作台/);
    assert.match(jobsPage, /自动采集先保留岗位事实/);
  });

  it("removes standalone AI report and resume workspace routes and commands", () => {
    const appShell = readProjectFile("src/App.vue");
    const router = readProjectFile("src/router.ts");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const aiCommand = readProjectFile("src-tauri/src/commands/ai.rs");
    const workerProtocol = readProjectFile("packages/boss-crawler-worker/src/protocol.ts");
    const workerMain = readProjectFile("packages/boss-crawler-worker/src/main.ts");

    for (const removedPath of [
      "src/pages/AiReports.vue",
      "src/pages/ResumeWorkspace.vue",
      "src/lib/useAiReportsPage.ts",
      "src/lib/useResumeWorkspacePage.ts",
      "src/lib/resumeWorkspace.ts",
      "src-tauri/src/commands/resume_workspace.rs",
      "packages/boss-crawler-worker/src/modes/resumeWorkspace.ts",
    ]) {
      assert.equal(projectFileExists(removedPath), false, `${removedPath} should be removed`);
    }

    for (const removedText of ["简历优化", "分析结果", "/resume-workspace", "/ai-reports"]) {
      assert.doesNotMatch(appShell, new RegExp(removedText));
      assert.doesNotMatch(router, new RegExp(removedText));
      assert.doesNotMatch(jobsPage, new RegExp(removedText));
      assert.doesNotMatch(jobsLogic, new RegExp(removedText));
    }

    for (const removedCommand of [
      "list_ai_reports",
      "get_ai_report",
      "clear_ai_reports",
      "get_resume_workspace_state",
      "create_resume_workspace",
      "diagnose_resume_workspace",
      "rewrite_resume_workspace_module",
      "export_resume_workspace_pdf",
    ]) {
      assert.doesNotMatch(aiCommand, new RegExp(removedCommand));
      assert.doesNotMatch(tauriLib, new RegExp(removedCommand));
    }

    assert.doesNotMatch(workerProtocol, /RESUME_DIAGNOSE/);
    assert.doesNotMatch(workerProtocol, /RESUME_REWRITE_MODULE/);
    assert.doesNotMatch(workerMain, /runResumeDiagnoseMode|runResumeRewriteModuleMode/);
  });

  it("keeps jobs page manual confirmation without applying automatically", () => {
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");

    assert.match(jobsPage, /职位库工作台/);
    assert.match(jobsLogic, /async function updateReviewStatus/);
    assert.match(jobsLogic, /status === "ready_to_apply"/);
    assert.match(jobsLogic, /确认准备投递/);
    assert.doesNotMatch(jobsLogic, /submit.*resume|auto.*apply|batch.*apply/i);
  });

  it("keeps resume-match reports aligned with requirement-doc structured evidence fields", () => {
    const workerPrompt = readProjectFile("packages/boss-crawler-worker/src/ai/prompt.ts");
    const workerSchema = readProjectFile("packages/boss-crawler-worker/src/modes/ai/schemas.ts");
    const workerNormalize = readProjectFile("packages/boss-crawler-worker/src/modes/ai/normalizeResume.ts");
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const workerAiContract = readProjectFile("packages/boss-crawler-worker/test/ai-contract.test.ts");

    for (const field of [
      "resume_match_score",
      "matched_stack",
      "matched_direction",
      "matched_resume_evidence",
      "experience_fit",
      "missing_points",
      "confidence",
    ]) {
      assert.match(workerPrompt, new RegExp(field));
      assert.match(workerSchema, new RegExp(field));
      assert.match(workerNormalize, new RegExp(field));
      assert.match(jobsTypes, new RegExp(field));
      assert.match(workerAiContract, new RegExp(field));
    }

    assert.match(workerPrompt, /matched_resume_evidence 必须引用简历原文中的具体经历或项目/);
    assert.match(workerNormalize, /matchedResumeEvidence/);
    assert.match(workerNormalize, /matchScore: resumeMatchScore/);
  });

  it("keeps candidate score reasons carrying structured resume-match evidence into job cards", () => {
    const jobsModels = readProjectFile("src-tauri/src/commands/jobs/models.rs");
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");

    for (const field of [
      "resume_match_score",
      "matched_stack",
      "matched_direction",
      "matched_resume_evidence",
      "experience_fit",
      "missing_points",
      "confidence",
    ]) {
      assert.match(jobsModels, new RegExp(field));
      assert.match(jobsTypes, new RegExp(field));
    }

    assert.match(jobsModels, /json_string_from_keys/);
    assert.match(jobsModels, /compute_score_projection_reads_requirement_doc_resume_reason_fields/);
    assert.match(jobsModels, /reason\["resume"\]\["matched_stack"\]\[0\]/);
    assert.match(jobsTypes, /matched_stack: asStringArray\(parsed\.resume\.matched_stack\)/);
    assert.match(jobsTypes, /matched_resume_evidence: asStringArray\(parsed\.resume\.matched_resume_evidence\)/);
    assert.match(jobsTypes, /confidence: asFiniteNumber\(parsed\.resume\.confidence\)/);
    assert.match(jobsTypes, /匹配技术栈：\$\{matchedStack/);
    assert.match(jobsTypes, /function formatResumeMatchEvidence/);
    assert.match(jobsTypes, /Resume Match 证据/);
    assert.match(jobsTypes, /简历证据：\$\{resumeEvidence\.join\("；"\)\}/);
    assert.match(jobItem, /AI 结果：\{\{ aiAuditStatusLabel\(aiAuditStatus\) \}\}/);
    assert.match(jobItem, /原因：\{\{ aiAuditReasonText \}\}/);
    assert.match(jobItem, /aiAuditReasonText/);
    assert.match(jobItem, /aiPostCollectionJudgementText/);
    assert.doesNotMatch(jobItem, /scoreResumeMatchedStack|scoreResumeMatchedDirection|scoreResumeEvidence|scoreResumeMissingPoints|简历判断依据|补充说明|公司判断依据/);
  });

  it("keeps blacklist actions and filtering available from the unified jobs page", () => {
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");

    assert.match(jobsLogic, /list_job_blacklist/);
    assert.match(jobsLogic, /\{ value: "blacklisted", label: "黑名单" \}/);
    assert.match(jobsPage, /JOB_STATUS_FILTER_OPTIONS/);
    assert.match(jobsPage, /岗位状态/);
    assert.match(jobsLogic, /async function blacklistCompany/);
    assert.match(jobsLogic, /async function blacklistJob/);
    assert.match(jobsLogic, /async function blacklistKeyword/);
    assert.match(jobsPage, /open-source-url/);
    assert.match(jobItem, /copy-link/);
    assert.match(jobItem, /open-source-url/);
    assert.doesNotMatch(jobsPage, /<h2[^>]*>黑名单管理/);
  });

  it("exposes AI preference fields in the crawl config and filter profile state", () => {
    const crawlConfig = readProjectFile("src/pages/CrawlConfig.vue");
    const filterProfile = readProjectFile("src/lib/filterProfile.ts");
    const crawlTypes = readProjectFile("src/lib/crawl.ts");

    assert.match(crawlConfig, /默认采后规则/);
    assert.match(crawlConfig, /AI 软排除/);
    assert.match(crawlConfig, /不确定策略/);
    for (const legacyHardLabel of [
      "必须命中的正文信号",
      "正文排除信号",
      "必须岗位方向",
      "排除岗位方向",
      "必须技术标签",
      "排除技术标签",
      "必须工作方式",
      "排除工作方式",
      "必须 Boss 活跃状态",
      "排除 Boss 活跃状态",
      "可接受城市",
      "排除城市",
      "允许候选来源",
      "允许沟通状态",
      "允许学历要求",
      "排除学历要求",
      "公司必须条件",
      "公司排除条件",
    ]) {
      assert.doesNotMatch(crawlConfig, new RegExp(legacyHardLabel));
    }
    for (const legacySoftLabel of ["正文偏好信号", "偏好岗位方向", "偏好技术标签", "偏好工作方式", "公司偏好条件", "Preference 权重"]) {
      assert.doesNotMatch(crawlConfig, new RegExp(legacySoftLabel));
    }
    assert.match(filterProfile, /aiPreferredText/);
    assert.match(filterProfile, /aiRejectedText/);
    assert.match(filterProfile, /aiRiskText/);
    assert.match(filterProfile, /aiUncertainStrategy/);
    assert.match(crawlTypes, /DEFAULT_AI_PREFERRED_TEXT/);
    assert.match(crawlTypes, /DEFAULT_AI_REJECTED_TEXT/);
    assert.match(crawlTypes, /DEFAULT_AI_RISK_TEXT/);
    assert.match(crawlTypes, /DEFAULT_AI_UNCERTAIN_STRATEGY/);
  });

  it("recomputes filter explanations when blacklist rules change", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsMutations = readProjectFile("src-tauri/src/commands/jobs/mutations.rs");
    const filterProfileCommand = readProjectFile("src-tauri/src/commands/filter_profile.rs");

    assert.match(jobsLogic, /await refreshAfterJobStateChange\(true\)/);
    assert.match(jobsMutations, /fn upsert_blacklist_on_conn/);
    assert.match(jobsMutations, /fn recompute_after_blacklist_change/);
    assert.match(jobsMutations, /recompute_default_filter_profile_for_company_on_conn\([\s\S]{0,120}conn,[\s\S]{0,80}&scope\.value/);
    assert.match(jobsMutations, /recompute_default_filter_profile_for_job_on_conn\([\s\S]{0,120}conn,[\s\S]{0,80}&scope\.value/);
    assert.match(jobsMutations, /recompute_default_filter_profile_on_conn\(conn\)/);
    assert.match(jobsMutations, /fn add_and_delete_keyword_blacklist_recomputes_filter_result/);
    assert.match(filterProfileCommand, /fn load_blacklist_hits_for_job/);
    assert.match(filterProfileCommand, /company_blacklist/);
    assert.match(filterProfileCommand, /job_blacklist/);
    assert.match(filterProfileCommand, /keyword_blacklist/);
    assert.match(filterProfileCommand, /fn recompute_default_filter_profile_marks_blacklist_hits/);
  });

  it("does not let jobs without or with stale filter results bypass hard restrictions", () => {
    const jobsQueries = readProjectFile("src-tauri/src/commands/jobs/queries.rs");
    const filterProfileCommand = readProjectFile("src-tauri/src/commands/filter_profile.rs");

    assert.match(filterProfileCommand, /fn recompute_missing_default_filter_profile_on_conn/);
    assert.match(filterProfileCommand, /let profile_updated_at = profile\.updated_at\.clone\(\)/);
    assert.match(filterProfileCommand, /OR r\.updated_at < \?2/);
    assert.match(jobsQueries, /recompute_missing_default_filter_profile_on_conn\(conn\)/);
    assert.match(jobsQueries, /WHERE r\.eligible = 1/);
    assert.doesNotMatch(jobsQueries, /COALESCE\(r\.eligible, 1\) != 0/);
    assert.match(jobsQueries, /review_candidates_recompute_missing_filter_results_before_sorting/);
    assert.match(jobsQueries, /review_candidates_recompute_stale_filter_results_before_sorting/);
  });

  it("keeps sidecar-captured eligible jobs using the Rust filter projection", () => {
    const sidecar = readProjectFile("src-tauri/src/sidecar/mod.rs");

    assert.match(sidecar, /commands(?:::\{[\s\S]*filter_profile|::filter_profile)/);
    assert.match(sidecar, /recompute_default_filter_profile_for_job_on_conn\([\s\S]{0,120}&payload\.encrypt_job_id/);
    assert.match(sidecar, /upsert_job_from_list_item_with_outcome/);
    assert.match(sidecar, /filters_json =[\s\S]{0,120}payload[\s\S]{0,80}\.filters[\s\S]{0,80}\.as_ref\(\)[\s\S]{0,80}\.and_then\(\|v\| serde_json::to_string\(v\)\.ok\(\)\)/);
    assert.match(sidecar, /insert_job_source_link\([\s\S]*payload\.keyword\.as_deref\(\),[\s\S]*filters_json\.as_deref\(\),[\s\S]*\)/);
  });

  it("keeps post-collection AI judgement triggered once after all selected crawl sources finish", () => {
    const crawlLogic = readProjectFile("src/lib/useCrawlPage.ts");
    const sidecar = readProjectFile("src-tauri/src/sidecar/mod.rs");
    const crawlCommand = readProjectFile("src-tauri/src/commands/crawl.rs");

    assert.match(crawlLogic, /for \(const source of selectedSources\)/);
    assert.match(crawlCommand, /pub fn list_collection_run_inserted_job_ids/);
    assert.match(sidecar, /record_collection_run_job_inserted/);
    assert.match(crawlLogic, /const runId = await invoke<string>\("crawl_auto_start"/);
    assert.match(crawlLogic, /loadCollectionRunInsertedJobIds\(runId\)/);
    assert.match(crawlLogic, /recomputeAiPostCollectionJudgementForJobIds\(\[\.\.\.insertedJobIds\]\)/);
    assert.match(crawlLogic, /recomputeAiPostCollectionJudgementForAllJobs\(\)/);
    assert.doesNotMatch(sidecar, /auto_recompute_ai_after_collection/);
    assert.doesNotMatch(sidecar, /commands::\{ai,/);
    assert.doesNotMatch(sidecar, /EventOut::Finished[\s\S]{0,260}recompute_ai_post_collection_judgement/);
  });

  it("keeps sidecar-filtered jobs stored and explained by the Rust filter projection", () => {
    const sidecar = readProjectFile("src-tauri/src/sidecar/mod.rs");

    assert.match(sidecar, /EventOut::JobFiltered/);
    assert.match(sidecar, /fn extract_job_id_from_list_item\(item: &Value\) -> Option<String>/);
    assert.match(sidecar, /let fallback_id =[\s\S]{0,80}payload\.raw\.as_ref\(\)\.and_then\(extract_job_id_from_list_item\)/);
    assert.match(sidecar, /let encrypt_job_id =[\s\S]{0,80}payload\.encrypt_job_id\.as_deref\(\)\.or\(fallback_id\.as_deref\(\)\)/);
    assert.match(sidecar, /payload\.raw\.as_ref\(\)/);
    assert.match(sidecar, /upsert_job_from_list_item_with_outcome\([\s\S]{0,120}conn,[\s\S]{0,80}encrypt_job_id,[\s\S]{0,80}raw/);
    assert.match(sidecar, /let filters_json =[\s\S]{0,120}payload[\s\S]{0,80}\.filters[\s\S]{0,80}\.as_ref\(\)[\s\S]{0,80}\.and_then\(\|v\| serde_json::to_string\(v\)\.ok\(\)\)/);
    assert.match(sidecar, /insert_job_source_link\([\s\S]*payload\.keyword\.as_deref\(\),[\s\S]*filters_json\.as_deref\(\),[\s\S]*\)/);
    assert.match(sidecar, /recompute_default_filter_profile_for_job_on_conn\([\s\S]{0,120}conn,[\s\S]{0,80}encrypt_job_id/);
  });

  it("keeps sidecar maxJobs strict across same-page list overflow and filtered events", () => {
    const sidecar = readProjectFile("src-tauri/src/sidecar/mod.rs");

    assert.match(sidecar, /fn should_skip_new_insert_for_limit/);
    assert.match(sidecar, /ActiveCollectionRun::insert_limit_reached/);
    assert.match(sidecar, /limit_reached && !local_job_exists\(conn, encrypt_job_id\)/);
    assert.match(sidecar, /EventOut::JobDetailCaptured\(payload\) => \{[\s\S]{0,180}should_skip_new_insert_for_limit/);
    assert.match(sidecar, /fn persist_normalized_capture\([\s\S]*should_skip_new_insert_for_limit\([\s\S]*&payload\.encrypt_job_id/);
    assert.match(sidecar, /EventOut::JobNormalizedCaptured\(payload\) => \{[\s\S]{0,260}persist_normalized_capture\(/);
    assert.match(sidecar, /fn persist_job_list_capture\([\s\S]*for item in jobs \{[\s\S]*should_skip_new_insert_for_limit[\s\S]*break;/);
    assert.match(sidecar, /EventOut::JobListCaptured\(payload\) => \{[\s\S]{0,240}persist_job_list_capture\(/);
    assert.match(sidecar, /EventOut::JobFiltered\(payload\) => \{[\s\S]*should_skip_new_insert_for_limit/);
    assert.match(sidecar, /EventOut::JobFiltered[\s\S]*request_stop_when_ready\(\s*&active_collection_run,\s*&inner,\s*\)/);
  });

  it("keeps worker filtered-job events carrying the same source filter context into Rust", () => {
    const workerRun = readProjectFile("packages/boss-crawler-worker/src/modes/auto/run.ts");
    const workerProtocol = readProjectFile("packages/boss-crawler-worker/src/protocol.ts");
    const frontendProtocol = readProjectFile("src/lib/protocol.ts");
    const rustProtocol = readProjectFile("src-tauri/src/ipc/protocol.rs");

    assert.match(workerRun, /type: "JOB_FILTERED"[\s\S]*filters: payload\.task\.filters/);
    assert.match(workerProtocol, /export const JobFilteredPayloadSchema = z\.object\([\s\S]*filters: z\.any\(\)\.optional\(\)/);
    assert.match(frontendProtocol, /type: "JOB_FILTERED"[\s\S]*filters\?: unknown/);
    assert.match(rustProtocol, /pub struct JobFilteredPayload[\s\S]*pub filters: Option<Value>/);
  });

  it("keeps collection run summaries, failures and pending evidence refresh wired outside collection config without adding apply or chat actions", () => {
    const schema = readProjectFile("src-tauri/src/db/schema.sql");
    const crawlCommand = readProjectFile("src-tauri/src/commands/crawl.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const sidecar = readProjectFile("src-tauri/src/sidecar/mod.rs");
    const workerProtocol = readProjectFile("packages/boss-crawler-worker/src/protocol.ts");
    const workerMain = readProjectFile("packages/boss-crawler-worker/src/main.ts");
    const workerEvidenceRefresh = readProjectFile("packages/boss-crawler-worker/src/modes/evidenceRefresh.ts");
    const crawlPageLogic = readProjectFile("src/lib/useCrawlPage.ts");
    const jobsPageLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");

    assert.match(schema, /CREATE TABLE IF NOT EXISTS collection_run/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS collection_failure/);
    for (const command of ["list_collection_runs", "list_collection_failures", "refresh_pending_job_evidence"]) {
      assert.match(tauriLib, new RegExp(`commands::crawl::${command}`));
      assert.match(crawlCommand, new RegExp(`pub fn ${command}`));
    }
    assert.match(crawlCommand, /create_collection_run/);
    assert.match(crawlCommand, /pub fn crawl_stop[\s\S]*stop_collection_by_user\(\)/);
    assert.match(crawlCommand, /RefreshJobEvidencePayload/);
    assert.match(crawlCommand, /pub fn refresh_pending_job_evidence[\s\S]*let session = load_session_optional\(sidecar\.app_data_dir\(\), "boss"\)/);
    assert.match(sidecar, /active_collection_run/);
    assert.match(sidecar, /pub fn stop_collection_by_user/);
    assert.match(sidecar, /pub fn stop_collection_by_user[\s\S]*record_collection_failure\([\s\S]*&conn,[\s\S]*Some\(active_run\),[\s\S]*"STOP"/);
    assert.match(sidecar, /models::fail_collection_run\(&conn, &active_run\.id, reason\)/);
    assert.match(sidecar, /record_collection_failure/);
    assert.match(sidecar, /refresh_collection_run_bucket_counts/);
    assert.match(workerProtocol, /REFRESH_JOB_EVIDENCE/);
    assert.match(workerProtocol, /RefreshJobEvidencePayloadSchema[\s\S]*user_data_dir: z\.string\(\)\.optional\(\)/);
    assert.match(workerMain, /runRefreshJobEvidenceMode/);
    assert.match(crawlCommand, /user_data_dir:\s*Some\([\s\S]*storage::boss_browser_profile_path/);
    assert.match(workerEvidenceRefresh, /launchBrowser\(\{\s*headless:\s*false,\s*user_data_dir:\s*payload\.user_data_dir,\s*stealth:\s*false,\s*preserve_on_disconnect:\s*true,\s*\}\)/);
    assert.match(workerEvidenceRefresh, /waitUntilBossLoginReady\(page, ctx, "Boss 登录态已就绪，开始补充岗位证据。"\)/);
    assert.match(workerEvidenceRefresh, /requestBossJsonWithRiskRecovery\(page, ctx, "job\/detail"/);
    assert.match(crawlPageLogic, /list_collection_runs/);
    assert.match(crawlPageLogic, /list_collection_failures/);
    assert.match(jobsPageLogic, /refreshPendingJobEvidence/);
    assert.doesNotMatch(jobsPage, /AI 重算当前页/);
    assert.match(jobItem, /copy-link/);
    assert.match(jobItem, /open-source-url/);
    assert.doesNotMatch(jobsPageLogic, /apply_job|send_greeting|open_chat/);
  });

  it("keeps Boss auto crawl using shared job-list id extraction before filtering and optional detail fetch", () => {
    const workerRun = readProjectFile("packages/boss-crawler-worker/src/modes/auto/run.ts");
    const parser = readProjectFile("packages/boss-crawler-worker/src/boss/parser.ts");

    assert.match(parser, /export function pickBossJobIdFromListItem\(item: unknown\): string \| null/);
    assert.match(parser, /obj\.securityId/);
    assert.match(parser, /jobInfo\?\.securityId/);
    assert.match(parser, /obj\.encryptJobId/);
    assert.match(parser, /jobInfo\?\.encrypt_job_id/);
    assert.match(workerRun, /import \{ pickBossJobIdFromListItem \} from "\.\.\/\.\.\/boss\/parser\.js"/);
    assert.match(workerRun, /const securityId = pickBossJobIdFromListItem\(job\) \?\? undefined/);
    assert.match(workerRun, /const securityId = pickBossJobIdFromListItem\(job\);\n\s+if \(!securityId\) continue/);
    assert.doesNotMatch(workerRun, /typeof job\?\.securityId === "string"/);
  });

  it("keeps a low-volume Boss canary smoke command for real browser verification", () => {
    const packageJson = readProjectFile("package.json");
    const canaryScript = readProjectFile("scripts/boss-canary.mjs");
    const gitignore = readProjectFile(".gitignore");

    assert.match(packageJson, /"boss:canary": "node scripts\/boss-canary\.mjs"/);
    assert.match(packageJson, /"test:boss-canary": "node --test test\/boss-canary\.test\.js"/);
    assert.match(gitignore, /\.tmp\//);
    assert.match(canaryScript, /"\.jobpilot", "boss-canary", "boss-browser-profile"/);
    assert.match(canaryScript, /type: "LOGIN_START"/);
    assert.match(canaryScript, /type: "CRAWL_AUTO_START"/);
    assert.match(canaryScript, /user_data_dir: options\.profileDir/);
    assert.match(canaryScript, /bossDetailFetchLimit: options\.detailLimit/);
    assert.match(canaryScript, /const pageSize = Math\.max\(1, Math\.min\(options\.maxJobs, 15\)\)/);
    assert.match(canaryScript, /pageSize,/);
    assert.match(canaryScript, /--allow-fallback-source/);
    assert.match(canaryScript, /allowFallbackSource/);
    assert.match(canaryScript, /required source=\$\{options\.allowFallbackSource \? "any" : "natural"\}/);
    assert.match(canaryScript, /JOB_LIST_CAPTURED/);
    assert.match(canaryScript, /event\.payload\?\.capture_source/);
    assert.match(canaryScript, /captureSources/);
    assert.match(canaryScript, /naturalJobListJobs/);
    assert.match(canaryScript, /summary\.naturalJobListJobs <= 0/);
    assert.match(canaryScript, /no capture_source=natural JOB_LIST_CAPTURED event with jobs was observed/);
    assert.match(canaryScript, /!summary\.cookieCollected \|\| summary\.cookieCount <= 0/);
    assert.match(canaryScript, /summary\.finishedEvents !== 1/);
    assert.match(canaryScript, /0 disables timeout/);
    assert.match(canaryScript, /Canary did not meet success criteria/);
    assert.match(canaryScript, /已捕获搜索页自然 joblist 响应/);
    assert.match(canaryScript, /This direct worker smoke verifies capture events only; it does not write DB rows/);
    assert.doesNotMatch(canaryScript, /apply_job|send_greeting|sendGreeting|autoSend|open_chat|submit.*resume/i);
  });

  it("keeps a low-volume Zhilian canary smoke command for real worker verification", () => {
    const packageJson = readProjectFile("package.json");
    const canaryScript = readProjectFile("scripts/zhilian-canary.mjs");
    const canaryTest = readProjectFile("test/zhilian-canary.test.js");
    const scriptsReadme = readProjectFile("scripts/README.md");

    assert.match(packageJson, /"zhilian:canary": "node scripts\/zhilian-canary\.mjs"/);
    assert.match(packageJson, /"test:zhilian-canary": "node --test test\/zhilian-canary\.test\.js"/);
    assert.match(scriptsReadme, /zhilian-canary\.mjs/);
    assert.match(canaryScript, /"\.jobpilot", "zhilian-canary", "zhilian-browser-profile"/);
    assert.match(canaryScript, /source_platform: "zhilian"/);
    assert.match(canaryScript, /JOB_NORMALIZED_CAPTURED/);
    assert.match(canaryScript, /summary\.normalizedJobs <= 0/);
    assert.match(canaryScript, /first captured job is missing a zhilian:<id> encrypt_job_id/);
    assert.match(canaryScript, /This direct worker smoke verifies capture events only; app-side insertion is handled by Tauri sidecar/);
    assert.match(canaryTest, /Zhilian canary passes collect mode when normalized jobs are captured/);
    assert.match(canaryTest, /Zhilian canary rejects login mode when the profile is still under verification/);
    assert.match(canaryTest, /Zhilian canary rejects non-Zhilian normalized ids/);
    assert.doesNotMatch(canaryScript, /apply_job|send_greeting|sendGreeting|autoSend|open_chat|submit.*resume/i);
  });

  it("keeps a read-only Boss App DB canary that verifies sidecar persistence, not worker finish alone", () => {
    const packageJson = readProjectFile("package.json");
    const dbCanaryScript = readProjectFile("scripts/boss-db-canary.mjs");
    const scriptsReadme = readProjectFile("scripts/README.md");

    assert.match(packageJson, /"boss:db-canary": "node scripts\/boss-db-canary\.mjs"/);
    assert.match(scriptsReadme, /boss-db-canary\.mjs/);
    assert.match(scriptsReadme, /read-only Boss App DB canary/);
    assert.match(dbCanaryScript, /"com\.administrator\.jobpilot"/);
    assert.match(dbCanaryScript, /"Application Support"/);
    assert.match(dbCanaryScript, /sqliteReadOnlyUri/);
    assert.match(dbCanaryScript, /mode=ro&cache=shared/);
    assert.match(dbCanaryScript, /"\.timeout 5000"/);
    assert.match(dbCanaryScript, /source_platform = 'boss'/);
    assert.match(dbCanaryScript, /status !== "finished"/);
    assert.match(dbCanaryScript, /finished_at/);
    assert.match(dbCanaryScript, /error_message/);
    assert.match(dbCanaryScript, /captured=\$\{captured\}, expected > 0/);
    assert.match(dbCanaryScript, /inserted\+updated\+duplicate/);
    assert.match(dbCanaryScript, /--require-insert/);
    assert.match(dbCanaryScript, /collection_failure/);
    assert.match(dbCanaryScript, /event_type IN/);
    assert.match(dbCanaryScript, /"ERROR", "WORKER_EXIT", "CRAWL_AUTO_START"/);
    assert.match(dbCanaryScript, /job_source_link/);
    assert.match(dbCanaryScript, /s\.captured_at >=/);
    assert.match(dbCanaryScript, /job_detail_raw/);
    assert.match(dbCanaryScript, /detailStatus/);
    assert.match(dbCanaryScript, /postDescription/);
    assert.match(dbCanaryScript, /detail_status \|\| ""\) === "list_only"/);
    assert.match(dbCanaryScript, /job_filter_result/);
    assert.match(dbCanaryScript, /reason_json/);
    assert.match(dbCanaryScript, /filter_updated_after_link/);
    assert.match(dbCanaryScript, /"recommended", "pending_confirmation", "filtered"/);
    assert.match(dbCanaryScript, /source_url.*zhipin\.com\/job_detail/s);
    assert.match(dbCanaryScript, /raw_payload_json_valid/);
    assert.match(dbCanaryScript, /filters_json_valid/);
    assert.match(dbCanaryScript, /detail_json_valid/);
    assert.match(dbCanaryScript, /reason_json_valid/);
    assert.match(dbCanaryScript, /latest Boss run within/);
    assert.doesNotMatch(dbCanaryScript, /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/);
  });

  it("keeps a read-only Zhilian App DB canary that verifies unified library persistence", () => {
    const packageJson = readProjectFile("package.json");
    const dbCanaryScript = readProjectFile("scripts/zhilian-db-canary.mjs");
    const dbCanaryTest = readProjectFile("test/zhilian-db-canary.test.js");
    const scriptsReadme = readProjectFile("scripts/README.md");

    assert.match(packageJson, /"zhilian:db-canary": "node scripts\/zhilian-db-canary\.mjs"/);
    assert.match(packageJson, /"zhilian:sidecar-canary": "cargo test --manifest-path src-tauri\/Cargo\.toml real_zhilian_worker_events_persist_through_sidecar_path -- --ignored --nocapture"/);
    assert.match(packageJson, /"test:zhilian-db-canary": "node --test test\/zhilian-db-canary\.test\.js"/);
    assert.match(scriptsReadme, /zhilian-db-canary\.mjs/);
    assert.match(scriptsReadme, /zhilian:sidecar-canary/);
    assert.match(scriptsReadme, /read-only Zhilian App DB canary/);
    assert.match(dbCanaryScript, /"com\.administrator\.jobpilot"/);
    assert.match(dbCanaryScript, /sqliteReadOnlyUri/);
    assert.match(dbCanaryScript, /mode=ro&cache=shared/);
    assert.match(dbCanaryScript, /"\.timeout 5000"/);
    assert.match(dbCanaryScript, /source_platform = 'zhilian'/);
    assert.match(dbCanaryScript, /status !== "finished"/);
    assert.match(dbCanaryScript, /captured=\$\{captured\}, expected > 0/);
    assert.match(dbCanaryScript, /inserted\+updated\+duplicate/);
    assert.match(dbCanaryScript, /--require-insert/);
    assert.match(dbCanaryScript, /collection_failure/);
    assert.match(dbCanaryScript, /"ERROR", "WORKER_EXIT", "CRAWL_AUTO_START"/);
    assert.match(dbCanaryScript, /job_source_link/);
    assert.match(dbCanaryScript, /job_detail_raw/);
    assert.match(dbCanaryScript, /postDescription/);
    assert.match(dbCanaryScript, /\["missing", "blocked", "detail"\]/);
    assert.match(dbCanaryScript, /function isZhilianJobDetailUrl/);
    assert.match(dbCanaryScript, /url\.hostname === "www\.zhaopin\.com"/);
    assert.match(dbCanaryScript, /url\.pathname\.startsWith\("\/jobdetail\/"\)/);
    assert.match(dbCanaryScript, /isZhilianJobDetailUrl\(row\.source_url\)/);
    assert.match(dbCanaryScript, /raw_payload_json_valid/);
    assert.match(dbCanaryScript, /filters_json_valid/);
    assert.match(dbCanaryScript, /detail_json_valid/);
    assert.match(dbCanaryScript, /latest Zhilian run within/);
    assert.match(dbCanaryTest, /Zhilian DB canary accepts list-level sidecar evidence/);
    assert.match(dbCanaryTest, /Zhilian DB canary rejects non-Zhilian detail URLs/);
    assert.doesNotMatch(dbCanaryScript, /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/);
  });

  it("keeps Boss job-list capture source observable across worker, Rust, frontend, and canary", () => {
    const workerRun = readProjectFile("packages/boss-crawler-worker/src/modes/auto/run.ts");
    const workerProtocol = readProjectFile("packages/boss-crawler-worker/src/protocol.ts");
    const rustProtocol = readProjectFile("src-tauri/src/ipc/protocol.rs");
    const frontendProtocol = readProjectFile("src/lib/protocol.ts");
    const canaryScript = readProjectFile("scripts/boss-canary.mjs");

    assert.match(workerRun, /capture_source:\s*"natural"/);
    assert.match(workerRun, /capture_source:\s*"dom_fallback"/);
    assert.match(workerRun, /capture_source:\s*"api_fallback"/);
    assert.match(workerProtocol, /capture_source:\s*z\.enum\(\["natural", "dom_fallback", "api_fallback"\]\)\.optional\(\)/);
    assert.match(rustProtocol, /pub capture_source: Option<String>/);
    assert.match(frontendProtocol, /capture_source\?: "natural" \| "dom_fallback" \| "api_fallback"/);
    assert.match(canaryScript, /const source = event\.payload\?\.capture_source \?\? "unknown"/);
    assert.match(canaryScript, /source=\$\{source\}/);
  });

  it("keeps Boss HTML login/risk responses and empty lists from becoming false success", () => {
    const workerRun = readProjectFile("packages/boss-crawler-worker/src/modes/auto/run.ts");
    const workerShared = readProjectFile("packages/boss-crawler-worker/src/modes/auto/shared.ts");

    assert.match(workerShared, /response_url\?: string/);
    assert.match(workerShared, /content_type\?: string/);
    assert.match(workerShared, /text\?: string/);
    assert.match(workerShared, /res\.status === 401/);
    assert.match(workerShared, /contentType\.includes\("text\/html"\)/);
    assert.match(workerShared, /text\.includes\("验证码"\)/);
    assert.match(workerShared, /text\.includes\("geetest"\)/);
    assert.match(workerRun, /total_extracted_job_list_items === 0/);
    assert.match(workerRun, /没有采集到任何岗位列表数据/);
    assert.match(workerRun, /total_stable_job_ids === 0/);
    assert.match(workerRun, /未解析到稳定岗位 ID/);
  });

  it("keeps job review commands local-first without automatic apply or send actions", () => {
    const source = readProjectFile("src/lib/useJobsPage.ts");
    const commands = invokedCommands(source);
    const allowedDraftCommands = new Set([
      "generate_greeting_message",
      "send_daily_job_intelligence_wecom_notification",
      "send_daily_job_intelligence_telegram_notification",
      "sync_boss_chat_status",
    ]);
    const forbiddenPattern = /(apply|deliver|send|chat|message|auto_apply|autoApply|batch_apply|batchApply)/i;
    const forbiddenCommands = commands.filter((command) => forbiddenPattern.test(command));

    assert.deepEqual(forbiddenCommands.filter((command) => !allowedDraftCommands.has(command)), []);
    assert.ok(commands.includes("set_job_review_state"));
    assert.ok(commands.includes("set_job_review_notes"));
    assert.ok(commands.includes("set_company_review_state"));
    assert.ok(commands.includes("generate_greeting_message"));
  });

  it("makes manual job-not-fit marking explicit before filtering future candidates", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsQueries = readProjectFile("src-tauri/src/commands/jobs/queries.rs");
    const jobsMutations = readProjectFile("src-tauri/src/commands/jobs/mutations.rs");
    const filterProfileCommand = readProjectFile("src-tauri/src/commands/filter_profile.rs");

    assert.match(jobsLogic, /status === "manual_not_fit"/);
    assert.match(jobsLogic, /确认将「\$\{job\.position_name \?\? job\.encrypt_job_id\}」标记为岗位不合适/);
    assert.match(jobsLogic, /后续可通过岗位状态筛选查看这类岗位/);
    assert.match(jobsLogic, /notes: job\.review_notes\?\.trim\(\) \|\| "用户从职位库标记岗位不合适"/);
    assert.match(jobsLogic, /标记岗位不合适/);
    assert.match(jobsQueries, /NOT IN \('read_no_reply', 'rejected', 'manual_not_fit'\)/);
    assert.match(jobsQueries, /NOT IN \('favorited', 'ready_to_apply', 'ignored', 'applied'\)/);
    assert.match(jobsMutations, /review_status\.is_some\(\) \|\| communication_status\.is_some\(\)/);
    assert.match(filterProfileCommand, /"review_status": review_status/);
    assert.match(jobsMutations, /recompute_default_filter_profile_for_job_on_conn\([\s\S]{0,120}(?:&conn|conn),[\s\S]{0,80}&encrypt_job_id/);
    assert.match(filterProfileCommand, /fn recompute_default_filter_profile_for_job_updates_changed_communication_status/);
  });

  it("folds filtered and blacklisted candidates into the unified candidate list filters", () => {
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobsQueries = readProjectFile("src-tauri/src/commands/jobs/queries.rs");

    assert.doesNotMatch(jobsPage, /最近过滤解释/);
    assert.doesNotMatch(jobsPage, /刷新过滤解释/);
    assert.doesNotMatch(jobsPage, /复制过滤摘要/);
    assert.doesNotMatch(jobsPage, /job-blacklist-panel/);
    assert.doesNotMatch(jobsPage, /<h2[^>]*>黑名单管理/);
    assert.match(jobsPage, /JOB_STATUS_FILTER_OPTIONS/);
    assert.match(jobsPage, /岗位状态/);
    assert.match(jobsPage, /视图筛选/);
    assert.match(jobsLogic, /\{ value: "has_notes", label: "有备注" \}/);
    assert.match(jobsLogic, /\{ value: "company_not_fit", label: "公司不合适" \}/);
    assert.match(jobsLogic, /\{ value: "blacklisted", label: "黑名单" \}/);
    assert.match(jobsQueries, /fn job_processed_sql/);
    assert.match(jobsQueries, /jb\.id IS NOT NULL/);
    assert.match(jobsQueries, /cb\.id IS NOT NULL/);
    assert.match(jobsQueries, /kb\.kind = 'keyword'/);
    assert.match(jobsQueries, /"blacklisted" => status_parts\.push/);
    assert.match(jobsQueries, /COALESCE\(crs\.review_status, 'pending'\) = 'manual_not_fit'/);
    assert.match(jobsQueries, /NULLIF\(TRIM\(COALESCE\(rs\.notes, ''\)\), ''\) IS NOT NULL/);
    assert.match(jobsLogic, /async function restoreReviewCandidate/);
    assert.match(jobsLogic, /showConfirm\(\s*"恢复候选"/);
    assert.match(jobsLogic, /确认恢复/);
    assert.match(jobsLogic, /该操作只恢复人工审核状态/);
    assert.match(jobsLogic, /岗位仍会继续受采后规则、黑名单和公司状态过滤/);
    assert.match(jobsLogic, /reviewStatus: "pending"/);
    assert.match(jobsLogic, /communicationStatus: "not_contacted"/);
  });

  it("lets users edit and clear local review notes for communication follow-up", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobGroup = readProjectFile("src/components/jobs/JobsGroupCard.vue");
    const jobsCommand = readProjectFile("src-tauri/src/commands/jobs.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const jobsDb = readProjectFile("src-tauri/src/db/models/job_review.rs");

    assert.match(jobsLogic, /async function updateReviewNotes/);
    assert.match(jobsLogic, /window\.prompt\("编辑岗位备注，留空可清空备注。"/);
    assert.match(jobsLogic, /set_job_review_notes/);
    assert.match(jobsLogic, /notes: nextNotes\.trim\(\) \? nextNotes : null/);
    assert.match(jobsCommand, /pub fn set_job_review_notes/);
    assert.match(tauriLib, /commands::jobs::set_job_review_notes/);
    assert.match(jobsDb, /pub\(crate\) fn set_job_review_notes/);
    assert.match(jobsDb, /notes = excluded\.notes/);
  });

  it("surfaces same-company negative communication history before blacklisting", () => {
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobsQueries = readProjectFile("src-tauri/src/commands/jobs/queries.rs");
    const jobsMutations = readProjectFile("src-tauri/src/commands/jobs/mutations.rs");
    const filterProfileCommand = readProjectFile("src-tauri/src/commands/filter_profile.rs");

    assert.match(jobsTypes, /company_negative_communication_count: number/);
    assert.match(jobsTypes, /latest_company_negative_communication_status: CommunicationStatus \| null/);
    assert.match(jobsTypes, /latest_company_negative_communication_at: string \| null/);
    assert.match(jobsQueries, /review_candidates_mark_company_negative_communication_history/);
    assert.match(jobsQueries, /company_job\.brand_name = j\.brand_name/);
    assert.match(jobsQueries, /company_job\.encrypt_job_id != j\.encrypt_job_id/);
    assert.match(jobItem, /黑名单: \{\{ job\.blacklist_reason \?\? "已加入黑名单" \}\}/);
    assert.match(jobItem, /岗位状态：\{\{ reviewStatusLabel\(job\.review_status\) \}\}/);
    assert.match(jobsMutations, /recompute_default_filter_profile_for_company_on_conn\(&conn, &company_name\)/);
    assert.match(filterProfileCommand, /company_review_status/);
    assert.match(filterProfileCommand, /fn recompute_default_filter_profile_for_company_updates_company_manual_not_fit_jobs/);
  });

  it("exposes greeting as an editable draft instead of a send action", () => {
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const greetingCommand = readProjectFile("src-tauri/src/commands/ai/greeting.rs");

    assert.match(jobItem, /AI 结果：\{\{ aiAuditStatusLabel\(aiAuditStatus\) \}\}/);
    assert.match(jobItem, /岗位详情/);
    assert.match(jobItem, /复制/);
    assert.match(jobItem, /复制打招呼/);
    assert.match(greetingCommand, /ensure_greeting_allowed_review_status/);
    assert.match(greetingCommand, /ready_to_apply/);
    assert.match(greetingCommand, /greeting_requires_manual_ready_to_apply_review_status/);
    assert.doesNotMatch(greetingCommand, /get_final_resume_text_for_job/);
    assert.doesNotMatch(greetingCommand, /linked_final_resume_text/);
    assert.match(greetingCommand, /ensure_greeting_has_candidate_context/);
    assert.match(greetingCommand, /请先提供简历或当前情况说明，或先为该岗位生成简历匹配报告/);
    assert.match(greetingCommand, /greeting_requires_candidate_context_or_match_report/);
    assert.match(jobsLogic, /generateGreeting/);
    assert.match(jobsLogic, /copyGreeting/);
    assert.doesNotMatch(jobItem, /send-greeting|sendGreeting|auto-send|自动发送消息/);
    assert.doesNotMatch(jobsPage, /send-greeting|sendGreeting|auto-send|自动发送消息/);
  });

  it("keeps greeting generation failures explicit and retryable per job", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobGroup = readProjectFile("src/components/jobs/JobsGroupCard.vue");

    assert.match(jobsLogic, /function describeGreetingFailure/);
    assert.match(jobsLogic, /结构化输出解析失败/);
    assert.match(jobsLogic, /greetingErrors\.set\(job\.encrypt_job_id, describeGreetingFailure\(message\)\)/);
    assert.match(jobsLogic, /greetingErrors\.delete\(job\.encrypt_job_id\)/);
    assert.match(jobGroup, /copy-link/);
    assert.match(jobsLogic, /greetingLoading/);
    assert.match(jobsLogic, /greetingDrafts/);
    assert.match(jobsLogic, /模型返回的打招呼文案不符合 JSON 或字段约束/);
  });

  it("records copied greeting drafts as greeted unread without sending messages", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");

    assert.match(jobsLogic, /async function copyGreeting/);
    assert.match(jobsLogic, /const copied = await copy\(message\)/);
    assert.match(jobsLogic, /if \(!copied \|\| !tauri\) return/);
    assert.match(jobsLogic, /communicationStatus: "greeted_unread"/);
    assert.match(jobsLogic, /lastGreetedAt: new Date\(\)\.toISOString\(\)/);
    assert.match(jobsLogic, /await refreshAfterJobStateChange\(\)/);
    assert.match(jobsLogic, /copyGreeting/);
    assert.match(jobItem, /上次打招呼: \{\{ formatDate\(job\.last_greeted_at\) \}\}/);
    assert.doesNotMatch(jobsLogic, /sendGreeting|send_message|sendMessage|autoSend/i);
  });

  it("removes local application-packet copy controls while keeping manual review flow", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");

    assert.match(jobsLogic, /function buildApplicationChecklist/);
    assert.match(jobsLogic, /function buildApplicationReadinessGaps/);
    assert.match(jobsLogic, /function formatApplicationReadinessPreflight/);
    assert.match(jobsLogic, /function buildGreetingEvidenceTrace/);
    assert.match(jobsLogic, /function formatApplicationFilterTrace/);
    assert.match(jobsLogic, /function buildResumeMatchEvidenceTrace/);
    assert.match(jobsLogic, /function buildReadyToApplyConfirmationMessage/);
    assert.match(jobsLogic, /buildApplicationChecklist\(job, greetingDraft\)/);
    assert.match(jobsLogic, /formatApplicationReadinessPreflight\(job, greetingDraft\)/);
    assert.match(jobsLogic, /待分析，建议先生成简历匹配报告/);
    assert.match(jobsLogic, /投递准备预检：\\n\$\{readinessPreflight\}/);
    assert.match(jobsLogic, /投递准备清单：\\n\$\{checklist\}/);
    assert.match(jobsLogic, /该操作只记录本地准备投递状态，不会自动发送或投递。/);
    assert.match(jobsLogic, /function formatCommunicationTrace/);
    assert.match(jobsLogic, /const statusLabel = communicationStatusLabel\(job\.communication_status\);/);
    assert.match(jobsLogic, /沟通追踪：\$\{formatCommunicationTrace\(job\)\}/);
    assert.match(jobsLogic, /上次打招呼 \$\{formatDate\(job\.last_greeted_at\)\}/);
    assert.match(jobsLogic, /备注 \$\{notes\}/);
    assert.match(jobsLogic, /function formatSourceTrace/);
    assert.match(jobsLogic, /来源追踪：\$\{formatSourceTrace\(job\)\}/);
    assert.match(jobsLogic, /去重 \$\{dedupKey\}/);
    assert.match(jobsLogic, /采集 \$\{formatDate\(job\.last_seen_at\)\}/);
    assert.match(jobsLogic, /不会自动发送或投递/);
    assert.doesNotMatch(jobsLogic, /function buildApplicationPacket/);
    assert.doesNotMatch(jobsLogic, /async function copyApplicationPacket/);
    assert.doesNotMatch(jobsLogic, /投递材料包|复制投递材料包|【JobPilot 投递材料包】/);
    assert.match(jobsLogic, /async function openJobSourceUrl\(job: JobRow\)/);
    assert.match(jobsLogic, /await openUrl\(url\)/);
    assert.match(jobsLogic, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
    assert.match(jobsLogic, /打开来源链接失败/);
    assert.match(jobItem, /AI 结果：\{\{ aiAuditStatusLabel\(aiAuditStatus\) \}\}/);
    assert.match(jobItem, /岗位详情/);
    assert.match(jobItem, /复制/);
    assert.match(jobItem, /复制打招呼/);
    assert.doesNotMatch(jobItem, /复制材料包|copy-application-packet/);
    assert.match(jobsLogic, /updateReviewStatus/);
    assert.match(jobsLogic, /applyReviewStatus/);
    assert.match(jobItem, /@click="\$emit\('open-source-url', job\)"/);
    assert.match(jobsLogic, /updateReviewStatus/);
    assert.match(jobsLogic, /buildReadyToApplyConfirmationMessage/);
    assert.match(jobsLogic, /async function applyReviewStatus/);
    assert.match(jobsLogic, /status === "ready_to_apply"/);
    assert.match(jobsLogic, /buildReadyToApplyConfirmationMessage\(job, greetingDrafts\.get\(job\.encrypt_job_id\)\)/);
    assert.match(jobsLogic, /buildReadyToApplyConfirmationMessage\(job, greetingDrafts\.get\(job\.encrypt_job_id\)\)[\s\S]{0,120}sourcePlatformModeTrace\(\)/);
    assert.match(jobsLogic, /确认准备投递/);
    assert.match(jobsLogic, /status === "applied"/);
    assert.match(jobsLogic, /确认已在外部平台手动完成/);
    assert.match(jobsLogic, /该操作只记录本地已投递状态，不会自动投递。/);
    assert.match(jobsLogic, /确认已手动投递/);
    assert.match(jobsPage, /@open-source-url="\(job\) => openJobSourceUrl\(job\)"/);
    assert.match(jobsPage, /copy-link/);
    assert.doesNotMatch(jobsPage, /@copy-application-packet/);
  });

  it("uses multi-select status filters instead of separate favorite, application and follow-up queues", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobsQueries = readProjectFile("src-tauri/src/commands/jobs/queries.rs");

    for (const option of [
      /\{ value: "favorited", label: "收藏" \}/,
      /\{ value: "ready_to_apply", label: "准备投递" \}/,
      /\{ value: "greeted_unread", label: "已打招呼" \}/,
      /\{ value: "read_no_reply", label: "已读未回" \}/,
      /\{ value: "replied", label: "已回复" \}/,
      /\{ value: "rejected", label: "已拒绝" \}/,
      /\{ value: "applied", label: "已投递" \}/,
      /\{ value: "has_notes", label: "有备注" \}/,
    ]) {
      assert.match(jobsLogic, option);
    }

    assert.match(jobsPage, /JOB_STATUS_FILTER_OPTIONS/);
    assert.match(jobsPage, /<UiMultiSelect/);
    assert.match(jobsPage, /selectedJobStatusFilterModel/);
    assert.match(jobsPage, /empty-label="全部岗位状态"/);
    assert.match(jobsPage, /AI_AUDIT_FILTER_OPTIONS/);
    assert.match(jobsPage, /selectedAiAuditFilterModel/);
    assert.match(jobsPage, /empty-label="全部 AI 结果"/);
    assert.match(jobsPage, /selectedSourcePlatformFilterModel/);
    assert.match(jobsPage, /empty-label="全部岗位平台"/);
    assert.match(jobsPage, /selectedCollectionMethodFilterModel/);
    assert.match(jobsPage, /empty-label="全部采集方式"/);
    assert.doesNotMatch(jobsPage, /toggleJobStatusFilter\(option\.value\)/);
    assert.doesNotMatch(jobsPage, /toggleAiAuditFilter\(option\.value\)/);
    assert.match(jobsLogic, /async function updateReviewStatus/);
    assert.match(jobsLogic, /async function updateCommunicationStatus/);
    assert.match(jobsQueries, /"favorited" \| "ready_to_apply" \| "applied" \| "ignored"/);
    assert.match(jobsQueries, /"greeted_unread" \| "read_no_reply" \| "replied" \| "rejected" \| "manual_not_fit"/);
    assert.match(jobsQueries, /"has_notes"/);
    assert.doesNotMatch(jobsPage, /application-ready-queue/);
    assert.doesNotMatch(jobsPage, /favorited-jobs-queue/);
    assert.doesNotMatch(jobsPage, /communication-followup-queue/);
    assert.doesNotMatch(jobsPage, /投递准备台/);
    assert.doesNotMatch(jobsPage, /已收藏岗位/);
    assert.doesNotMatch(jobsPage, /沟通回溯台/);
    assert.doesNotMatch(jobsPage, /auto.*apply|batch.*apply|submit.*resume|send.*resume/i);
  });

  it("shows job intelligence as a time-range summary without delivery controls on the jobs page", () => {
    const jobsPageLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsPageView = readProjectFile("src/pages/Jobs.vue");

    assert.match(jobsPageView, /JOB_TIME_RANGE_OPTIONS/);
    assert.match(jobsPageView, /jobCandidateTimeRange === 'custom'/);
    assert.match(jobsPageView, /jobCandidateCustomStartDate/);
    assert.match(jobsPageView, /jobCandidateCustomEndDate/);
    assert.match(jobsPageLogic, /function jobTimeRangeBounds/);
    assert.match(jobsPageLogic, /startDate/);
    assert.match(jobsPageLogic, /endDate/);
    assert.match(jobsPageLogic, /loadJobCandidates/);

    for (const removedEntry of [
      "每日岗位情报",
      "推荐候选预览",
      "复制理由",
      "查看 Top 20",
      "邮件草稿",
      "企业微信通知",
      "本机通知",
      "dailyIntelligenceWecomSending",
      "dailyIntelligenceExternalMessage",
      "openDailyIntelligenceEmailDraft",
      "sendDailyIntelligenceWecomNotification",
    ]) {
      assert.doesNotMatch(jobsPageView, new RegExp(removedEntry));
    }
    assert.doesNotMatch(jobsPageLogic, /auto.*apply|batch.*apply|submit.*resume|send.*resume/i);
  });

  it("keeps the unified job source registry visible with manual import adapters", () => {
    const settingsPage = readProjectFile("src/pages/Settings.vue");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const crawlPage = readProjectFile("src/pages/Crawl.vue");
    const crawlConfigPage = readProjectFile("src/pages/CrawlConfig.vue");
    const crawlLogic = readProjectFile("src/lib/useCrawlPage.ts");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const filterProfile = readProjectFile("src/lib/filterProfile.ts");
    const crawlTypes = readProjectFile("src/lib/crawl.ts");
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const jobsCommand = readProjectFile("src-tauri/src/commands/jobs.rs");
    const jobsMutations = readProjectFile("src-tauri/src/commands/jobs/mutations.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const dbTests = readProjectFile("src-tauri/src/db/tests.rs");
    const authCommand = readProjectFile("src-tauri/src/commands/auth.rs");

    assert.match(settingsPage, /统一职位来源/);
    assert.match(settingsPage, /统一职位来源维度/);
    assert.match(settingsPage, /list_job_sources/);
    assert.match(settingsPage, /set_job_source_enabled/);
    assert.match(settingsPage, /get_login_status/);
    assert.match(settingsPage, /start_login/);
    assert.match(authCommand, /fn has_zhilian_session/);
    assert.match(authCommand, /storage::zhilian_browser_profile_path\(app_data_dir\)\.is_dir\(\)/);
    assert.match(authCommand, /storage::read_json\(&storage::zhilian_cookies_path\(app_data_dir\)\)/);
    assert.match(authCommand, /map\(\|items\| !items\.is_empty\(\)\)/);
    assert.match(settingsPage, /zhilian: null/);
    assert.match(settingsPage, /不会停下来等人工验证/);
    assert.match(settingsPage, /登录预留/);
    assert.match(settingsPage, /visibleJobSources/);
    assert.match(settingsPage, /aria-pressed/);
    assert.match(settingsPage, /adapter_kind/);
    assert.doesNotMatch(crawlPage, /start_login/);
    assert.doesNotMatch(jobsPage, /填入示例/);
    assert.doesNotMatch(jobsPage, /复制导入摘要/);
    assert.doesNotMatch(jobsPage, /lastExternalImportedJob/);
    assert.doesNotMatch(jobsPage, /copyExternalImportSummary/);
    assert.match(jobsPage, /SOURCE_PLATFORM_FILTER_OPTIONS/);
    assert.match(jobsPage, /selectedSourcePlatformFilters/);
    assert.match(jobsPage, /岗位平台/);
    assert.doesNotMatch(jobsPage, /sourcePlatformModeLabel/);
    assert.doesNotMatch(jobsPage, /sourcePlatformModeHint/);
    assert.doesNotMatch(jobsPage, /来源策略/);
    assert.doesNotMatch(jobsPage, /来源平台、画像条件和公司维度都在「采集配置」里统一修改/);
    assert.match(crawlConfigPage, /来源/);
    assert.match(crawlConfigPage, /collectableSourceOptions/);
    assert.match(crawlLogic, /if \(initialized\.value\) \{\s*void loadCollectionSources\(\);\s*return;\s*\}/);
    assert.match(crawlLogic, /async function refreshCollectionSourceState\(\)/);
    assert.match(crawlLogic, /loadCollectionSources\(\)/);
    assert.match(crawlLogic, /loadCollectionSummary\(\)/);
    assert.match(crawlPage, /Boss、猎聘、智联、V2EX、LinuxDo 或脉脉/);
    assert.match(crawlConfigPage, /连接一次 \/ 后台复用 profile/);
    assert.doesNotMatch(crawlConfigPage, /sourcePlatformModeLabel/);
    assert.doesNotMatch(crawlConfigPage, /sourcePlatformModeHint/);
    assert.match(filterProfile, /sourcePlatformOptions: JOB_SOURCE_PLATFORM_OPTIONS/);
    assert.match(filterProfile, /允许 Boss、猎聘、V2EX、LinuxDo、智联、脉脉等已支持自动采集来源进入筛选和 Top 20/);
    assert.match(crawlTypes, /JOB_SOURCE_PLATFORM_OPTIONS/);
    assert.match(crawlTypes, /MANUAL_IMPORT_SOURCE_PLATFORMS/);
    assert.match(crawlTypes, /adapterKind: "feed"/);
    assert.doesNotMatch(jobsLogic, /import_external_job/);
    assert.doesNotMatch(jobsLogic, /externalImportPayloadText/);
    assert.doesNotMatch(jobsLogic, /fillExternalImportExample/);
    assert.doesNotMatch(jobsLogic, /lastExternalImportedJob/);
    assert.doesNotMatch(jobsLogic, /buildExternalImportSummary/);
    assert.doesNotMatch(jobsTypes, /EXTERNAL_JOB_IMPORT_PLATFORM_OPTIONS/);
    assert.doesNotMatch(jobsTypes, /buildExternalJobImportExample/);
    assert.doesNotMatch(jobsTypes, /EXTERNAL_JOB_IMPORT_EXAMPLES/);
    assert.match(crawlTypes, /liepin/);
    assert.match(crawlTypes, /zhilian/);
    assert.match(crawlTypes, /maimai/);
    assert.match(crawlTypes, /v2ex/);
    assert.match(crawlTypes, /linuxdo/);
    assert.doesNotMatch(jobsCommand, /pub fn import_external_job/);
    assert.match(jobsCommand, /pub fn set_job_source_enabled/);
    assert.doesNotMatch(jobsMutations, /import_external_job_on_conn/);
    assert.match(jobsMutations, /UPDATE job_sources/);
    assert.doesNotMatch(tauriLib, /commands::jobs::import_external_job/);
    assert.match(tauriLib, /commands::jobs::set_job_source_enabled/);
    assert.match(dbTests, /init_db_seeds_job_source_registry_with_platform_adapters/);
    assert.match(dbTests, /init_db_preserves_existing_job_source_enabled_choices/);
    assert.match(dbTests, /Boss 直聘/);
    assert.match(dbTests, /liepin/);
    assert.match(dbTests, /adapter_kind == "liepin"/);
    assert.match(dbTests, /source_platform == "maimai" && adapter_kind == "feed"/);
    assert.match(dbTests, /enabled == 1/);
  });

  it("shows feedback when refreshing platform login status", () => {
    const settingsPage = readProjectFile("src/pages/Settings.vue");

    assert.match(settingsPage, /loginRefreshingPlatform/);
    assert.match(settingsPage, /loginMessage/);
    assert.match(settingsPage, /refreshPlatformLogin\(source\.platform, true\)/);
    assert.match(settingsPage, /检查中…/);
    assert.match(settingsPage, /刷新状态/);
    assert.match(settingsPage, /登录状态已刷新/);
    assert.match(settingsPage, /ui-status-success/);
  });

  it("keeps release packaging platform-aware for the Mac-first Tauri path", () => {
    const packageJson = readProjectFile("package.json");
    const releaseScript = readProjectFile("scripts/release.mjs");
    const tauriBuildScript = readProjectFile("scripts/tauri-build.mjs");
    const stageRuntimeScript = readProjectFile("scripts/stage-worker-runtime.mjs");
    const verifyRuntimeScript = readProjectFile("scripts/verify-worker-runtime.mjs");
    const verifyReleaseScript = readProjectFile("scripts/verify-release-bundle.mjs");
    const desktopSmokeSeedScript = readProjectFile("scripts/seed-desktop-smoke-data.mjs");
    const tauriPaths = readProjectFile("src-tauri/src/paths.rs");
    const releaseConfig = readProjectFile("src-tauri/tauri.conf.release.json");
    const readme = readProjectFile("README.md");

    assert.match(packageJson, /"tauri:build:release": "node scripts\/release\.mjs"/);
    assert.match(packageJson, /"tauri:build:app": "node scripts\/tauri-build\.mjs --app-only"/);
    assert.match(packageJson, /"verify:worker:runtime": "node scripts\/verify-worker-runtime\.mjs"/);
    assert.match(packageJson, /"verify:release:bundle": "node scripts\/verify-release-bundle\.mjs"/);
    assert.match(packageJson, /"seed:desktop:smoke": "node scripts\/seed-desktop-smoke-data\.mjs"/);
    assert.match(releaseConfig, /"macOS": \{/);
    assert.match(releaseConfig, /"signingIdentity": "-"/);
    assert.match(releaseConfig, /"hardenedRuntime": false/);
    assert.match(tauriBuildScript, /const appOnly = process\.argv\.includes\("--app-only"\)/);
    assert.match(tauriBuildScript, /"build",[\s\S]*\.\.\.\(appOnly \? \["--bundles", "app"\] : \[\]\),[\s\S]*"--config",[\s\S]*"src-tauri\/tauri\.conf\.release\.json"/);
    assert.match(tauriBuildScript, /scripts\/verify-release-bundle\.mjs/);
    assert.match(tauriBuildScript, /\.\.\.\(appOnly \? \["--app-only"\] : \[\]\)/);
    assert.match(stageRuntimeScript, /makeExecutableResourceWritable/);
    assert.match(stageRuntimeScript, /fs\.chmod\(filePath, 0o755\)/);
    assert.match(stageRuntimeScript, /await makeExecutableResourceWritable\(stagedNodePath\)/);
    assert.match(tauriBuildScript, /removeStaleBundledRuntimeResources/);
    assert.match(tauriBuildScript, /src-tauri", "target", "release", "bin"/);
    assert.match(tauriBuildScript, /path\.join\(releaseRuntimeDir, "node"\)/);
    assert.match(tauriBuildScript, /path\.join\(releaseRuntimeDir, "node\.exe"\)/);
    assert.match(tauriBuildScript, /path\.join\(releaseRuntimeDir, "boss-crawler-worker"\)/);
    assert.match(tauriBuildScript, /fs\.rm\(resourcePath, \{ force: true, recursive: true \}\)/);
    assert.match(tauriBuildScript, /await removeStaleBundledRuntimeResources\(\)/);
    assert.match(releaseScript, /await runCommand\("npm", \["run", "tauri:build"\]\)/);
    assert.match(releaseScript, /process\.platform === "win32"/);
    assert.match(releaseScript, /tauri:build:portable:only/);
    assert.match(releaseScript, /Skipping Windows portable ZIP packaging on this platform/);
    assert.match(verifyRuntimeScript, /boss-crawler-worker started/);
    assert.match(verifyRuntimeScript, /JSON\.stringify\(\{ type: "STOP" \}\)/);
    assert.match(verifyRuntimeScript, /STOP received/);
    assert.match(verifyRuntimeScript, /event\?\.type === "FINISHED"/);
    assert.match(verifyRuntimeScript, /code === 0/);
    assert.match(verifyReleaseScript, /process\.platform !== "darwin"/);
    assert.match(verifyReleaseScript, /codesign", \["--verify", "--deep", "--strict", "--verbose=2", appPath\]/);
    assert.match(verifyReleaseScript, /scripts\/verify-worker-runtime\.mjs", resourcesBinDir/);
    assert.match(verifyReleaseScript, /const appOnly = process\.argv\.includes\("--app-only"\)/);
    assert.match(verifyReleaseScript, /Skipping DMG verification for app-only macOS bundle/);
    assert.match(verifyReleaseScript, /hdiutil", \["verify", dmgPath\]/);
    assert.match(desktopSmokeSeedScript, /JOB_SYNC_DATA_DIR/);
    assert.match(desktopSmokeSeedScript, /--data-dir \$\{dataDir\}/);
    assert.match(desktopSmokeSeedScript, /smoke-go-sre-top/);
    assert.match(desktopSmokeSeedScript, /smoke-ai-infra-ready/);
    assert.doesNotMatch(desktopSmokeSeedScript, /resume-workspaces/);
    assert.doesNotMatch(desktopSmokeSeedScript, /smoke-resume-ready\.pdf/);
    assert.match(tauriPaths, /parse_data_dir_arg/);
    assert.match(tauriPaths, /"--data-dir"/);
    assert.match(tauriPaths, /"--job-sync-data-dir"/);
    assert.match(readme, /macOS \/ Linux 会跳过 Windows 便携包步骤/);
    assert.match(readme, /ad-hoc 签名/);
    assert.match(readme, /tauri:build:app/);
    assert.match(readme, /seed:desktop:smoke/);
    assert.match(readme, /--data-dir \/tmp\/job-sync-desktop-smoke/);
  });

  it("keeps saved API keys redacted from settings IPC responses", () => {
    const settingsCommand = readProjectFile("src-tauri/src/commands/settings.rs");
    const settingsPage = readProjectFile("src/pages/Settings.vue");

    assert.match(settingsCommand, /struct PublicAppSettings/);
    assert.match(settingsCommand, /has_openai_api_key/);
    assert.match(settingsCommand, /openai_api_key: None/);
    assert.match(settingsCommand, /public_settings_redacts_saved_api_key/);
    assert.match(settingsCommand, /has_telegram_bot_token/);
    assert.match(settingsCommand, /telegram_bot_token: None/);
    assert.match(settingsCommand, /has_telegram_chat_id/);
    assert.match(settingsCommand, /telegram_chat_id: None/);
    assert.match(settingsCommand, /proxy_url: Option<String>/);
    assert.match(settingsCommand, /public_settings_exposes_saved_proxy_url/);
    assert.match(settingsPage, /has_openai_api_key/);
    assert.match(settingsPage, /has_telegram_bot_token/);
    assert.match(settingsPage, /telegramBotToken/);
    assert.match(settingsPage, /Telegram Bot Token/);
    assert.match(settingsPage, /已保存，当前不回显/);
  });

  it("keeps external dependency diagnostics manual and redacted", () => {
    const settingsCommand = readProjectFile("src-tauri/src/commands/settings.rs");
    const settingsPage = readProjectFile("src/pages/Settings.vue");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");

    const commands = invokedCommands(settingsPage);
    const modelDiagnostic = settingsCommand.match(/pub struct ModelServiceDiagnostic \{[\s\S]*?\n\}/)?.[0] ?? "";
    const telegramDiagnostic = settingsCommand.match(/pub struct TelegramDiagnostic \{[\s\S]*?\n\}/)?.[0] ?? "";
    const diagnosticSummaryBlock = settingsPage.match(/function buildExternalDiagnosticsSummary[\s\S]*?async function save/)?.[0] ?? "";

    assert.match(settingsCommand, /pub struct BossSessionDiagnostic/);
    assert.match(settingsCommand, /pub struct ModelServiceDiagnostic/);
    assert.match(settingsCommand, /pub struct TelegramDiagnostic/);
    assert.match(settingsCommand, /pub struct ExternalDependencyDiagnostics/);
    assert.match(settingsCommand, /pub fn diagnose_external_dependencies/);
    assert.match(settingsCommand, /crate::commands::ai::list_models\(app, api_key, base_url\)/);
    assert.match(tauriLib, /commands::settings::diagnose_external_dependencies/);

    assert.ok(commands.includes("diagnose_external_dependencies"));
    assert.ok(!commands.includes("send_daily_job_intelligence_wecom_notification"));
    assert.doesNotMatch(settingsCommand, /send_daily_job_intelligence_wecom_notification/);
    assert.doesNotMatch(modelDiagnostic, /api_key|webhook|cookie|local_storage/);
    assert.doesNotMatch(telegramDiagnostic, /bot_token: Option<String>|chat_id: Option<String>/);
    assert.doesNotMatch(settingsPage, /diagnostics\.wecom\b/);
    assert.match(settingsPage, /diagnostics\.telegram/);
    assert.doesNotMatch(diagnosticSummaryBlock, /apiKey\.value|telegramBotToken\.value|telegramChatId\.value|baseUrl\.value/);

    assert.match(settingsPage, /外部依赖诊断/);
    assert.match(settingsPage, /运行诊断/);
    assert.match(settingsPage, /复制诊断摘要/);
    assert.match(settingsPage, /copyExternalDiagnosticsSummary/);
    assert.match(settingsPage, /仅用于本机依赖验收记录/);
    assert.match(settingsPage, /不回显 Key、Bot Token、Chat ID、Cookie 或 LocalStorage/);
    assert.match(settingsPage, /不会触发采集、投递、开聊或 Telegram 发送/);
    assert.match(settingsPage, /apiKey: apiKey\.value\.trim\(\) \|\| null/);
    assert.match(settingsPage, /baseUrl: baseUrl\.value\.trim\(\) \|\| null/);
  });

  it("keeps saved network proxy settings wired to worker environment and Telegram", () => {
    const settingsPage = readProjectFile("src/pages/Settings.vue");
    const settingsCommand = readProjectFile("src-tauri/src/commands/settings.rs");
    const settingsCore = readProjectFile("src-tauri/src/settings.rs");

    assert.match(settingsPage, /网络代理/);
    assert.match(settingsPage, /网络代理 URL/);
    assert.match(settingsPage, /Telegram 通知/);
    assert.match(settingsPage, /proxyUrl/);
    assert.match(settingsPage, /proxyUrl: proxyUrl\.value\.trim\(\) \|\| null/);
    assert.match(settingsCommand, /proxy_url: Option<String>/);
    assert.match(settingsCommand, /current\.proxy_url = opt_trimmed\(proxy_url\)/);
    assert.match(settingsCommand, /fn telegram_agent\(settings: &settings::AppSettings\)/);
    assert.match(settingsCommand, /ureq::Proxy::new\(&proxy_url\)/);
    assert.match(settingsCommand, /builder = builder\.proxy\(proxy\)/);
    assert.match(settingsCommand, /telegram_sender_uses_saved_proxy_url/);
    assert.match(settingsCore, /pub proxy_url: Option<String>/);
    assert.match(settingsCore, /cmd\.env\("HTTP_PROXY", &v\)/);
    assert.match(settingsCore, /cmd\.env\("HTTPS_PROXY", &v\)/);
    assert.match(settingsCore, /cmd\.env\("ALL_PROXY", &v\)/);
    assert.match(settingsCore, /cmd\.env\("NO_PROXY", "localhost,127\.0\.0\.1,::1"\)/);
    assert.match(settingsCore, /apply_worker_env_injects_saved_proxy_url/);
  });

  it("keeps first-class model provider, temperature and prompt-extra settings wired end to end", () => {
    const settingsPage = readProjectFile("src/pages/Settings.vue");
    const settingsCommand = readProjectFile("src-tauri/src/commands/settings.rs");
    const aiConfig = readProjectFile("src-tauri/src/commands/ai/config.rs");
    const aiWorker = readProjectFile("src-tauri/src/commands/ai/worker.rs");
    const promptExtra = readProjectFile("packages/boss-crawler-worker/src/ai/promptExtra.ts");

    assert.match(settingsPage, /OpenAI Compatible/);
    assert.match(settingsPage, /DeepSeek/);
    assert.match(settingsPage, /Ollama（本地）/);
    assert.match(settingsPage, /openaiTemperature: clampTemperature\(temperature\.value\)/);
    assert.match(settingsPage, /openaiPromptExtra: promptExtra\.value\.trim\(\) \|\| null/);
    assert.match(settingsPage, /openaiSchemaExtra: schemaExtra\.value\.trim\(\) \|\| null/);
    assert.match(settingsPage, /结构化输出 Schema 补充/);
    assert.match(settingsPage, /不能删除内置必填字段/);
    assert.match(settingsCommand, /openai_temperature: Option<f64>/);
    assert.match(settingsCommand, /openai_prompt_extra: Option<String>/);
    assert.match(settingsCommand, /openai_schema_extra: Option<String>/);
    assert.match(aiConfig, /saved_temperature_prompt_extra_and_schema_extra_are_part_of_effective_request/);
    assert.match(aiWorker, /OPENAI_TEMPERATURE/);
    assert.match(aiWorker, /OPENAI_PROMPT_EXTRA/);
    assert.match(aiWorker, /OPENAI_SCHEMA_EXTRA/);
    assert.match(aiWorker, /openai_temperature_prompt_extra_and_schema_extra_are_written_to_worker_env/);
    assert.match(promptExtra, /【用户补充提示】/);
    assert.match(promptExtra, /【用户结构化输出 Schema 补充】/);
    assert.match(promptExtra, /不能覆盖严格 JSON 输出/);
    assert.match(promptExtra, /不能删除内置必填字段/);
  });
});
