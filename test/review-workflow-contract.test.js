import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
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
    const jobsCommand = readProjectFile("src-tauri/src/commands/jobs.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");

    assert.match(jobsPage, /职位库工作台/);
    assert.match(jobsPage, /采后结果分区/);
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
    assert.match(jobsPage, /SOURCE_PLATFORM_FILTER_OPTIONS/);
    assert.match(jobsPage, /COLLECTION_METHOD_FILTER_OPTIONS/);
    assert.match(jobsPage, /selectedJobStatusFilters/);
    assert.match(jobsPage, /selectedSourcePlatformFilters/);
    assert.match(jobsPage, /selectedCollectionMethodFilters/);
    assert.match(jobsPage, /goJobCandidatePage/);
    assert.match(jobsPage, /jobCandidatePageSize/);
    assert.match(jobsPage, /岗位平台/);
    assert.match(jobsPage, /采集方式/);
    assert.match(jobsPage, /@delete="\(job\) => deleteJob\(job, '__all__'\)"/);

    for (const removedEntry of [
      "Top 20 人工审核队列",
      "最近过滤解释",
      "工作队列",
      "每日岗位情报",
      "投递准备台",
      "已收藏岗位",
      "沟通回溯台",
      "复制候选摘要",
      "复制过滤摘要",
      "企业微信通知",
      "邮件草稿",
      "本机通知",
      "favorited-jobs-queue",
      "application-ready-queue",
      "communication-followup-queue",
      "top20-review-queue",
    ]) {
      assert.doesNotMatch(jobsPage, new RegExp(removedEntry));
    }

    assert.match(jobsLogic, /invoke<JobCandidatePage>\("list_job_candidates"/);
    assert.match(jobsLogic, /function loadJobCandidates/);
    assert.match(jobsLogic, /function isProcessedJob/);
    assert.match(jobsLogic, /processed: jobCandidateProcessedFilter/);
    assert.match(jobsLogic, /statusFilters: selectedJobStatusFilters/);
    assert.match(jobsLogic, /sourcePlatforms: selectedSourcePlatformFilters/);
    assert.match(jobsLogic, /collectionMethods: selectedCollectionMethodFilters/);
    assert.match(jobsLogic, /toggleJobStatusFilter/);
    assert.match(jobsLogic, /toggleSourcePlatformFilter/);
    assert.match(jobsLogic, /toggleCollectionMethodFilter/);
    assert.match(jobsPage, /clearCurrentViewFilters/);

    assert.match(jobsCommand, /pub fn list_job_candidates/);
    assert.match(tauriLib, /commands::jobs::list_job_candidates/);
    assert.match(jobsQueries, /list_job_candidates_on_conn/);
    assert.match(jobsQueries, /JOB_PROCESSED_SQL/);
    assert.match(jobsQueries, /JOB_COLLECTION_METHOD_SQL/);
    assert.match(jobsQueries, /processed: Option<String>/);
    assert.match(jobsQueries, /status_filters: Option<Vec<String>>/);
    assert.match(jobsQueries, /source_platforms: Option<Vec<String>>/);
    assert.match(jobsQueries, /collection_methods: Option<Vec<String>>/);
    assert.match(jobsQueries, /LIMIT \? OFFSET \?/);
    assert.match(jobsQueries, /ORDER BY j\.last_seen_at DESC, j\.encrypt_job_id ASC/);
    assert.match(jobsQueries, /list_job_candidates_pages_all_jobs_by_time_range/);
    assert.match(jobsQueries, /list_job_candidates_filters_status_source_and_collection_method/);
    assert.match(jobsTypes, /export interface JobCandidatePage/);
    assert.match(jobsTypes, /collection_method: CollectionMethod/);
    assert.match(jobsTypes, /export type CollectionMethod = "manual" \| "automatic"/);
    assert.match(jobsTypes, /COLLECTION_METHOD_LABELS/);

    for (const label of ["Final", "Resume", "Preference", "Company"]) {
      assert.ok(jobItem.includes(`${label} {{ formatScore`));
    }
    assert.match(jobItem, /硬限制/);
    assert.match(jobItem, /偏好命中/);
    assert.match(jobItem, /filterProfilePassed/);
    assert.match(jobItem, /filterProfileTraceText/);
    assert.match(jobItem, /画像通过/);
    assert.match(jobItem, /筛选画像: \{\{ filterProfileTraceText \}\}/);
    assert.match(jobItem, /公司风险依据/);
    assert.match(jobItem, /scoreCompanyRiskFlags/);
    assert.match(jobItem, /companyRiskFlagLabel/);
    assert.match(jobItem, /标签：\{\{ scoreCompanyRiskFlags\.map\(companyRiskFlagLabel\)\.join\("、"\) \}\}/);
    assert.match(jobItem, /scoreCompanyConfidence/);
    assert.match(jobItem, /置信度/);
    assert.match(jobsTypes, /COMPANY_RISK_FLAG_LABELS/);
    assert.match(jobsTypes, /low_info_risk: "信息过少"/);
    assert.match(jobsTypes, /companyRiskFlagLabel/);
    assert.match(jobsTypes, /风险标签：/);
    assert.match(jobsTypes, /company_score\?: number/);
    assert.match(jobsTypes, /company_score: asFiniteNumber\(parsed\.company\.company_score\)/);
    assert.match(jobsTypes, /confidence\?: number/);
    assert.match(jobsTypes, /confidence: asFiniteNumber\(parsed\.company\.confidence\)/);

    for (const event of ["update-review", "restore-review-candidate", "update-communication", "update-review-notes", "blacklist-company", "blacklist-job", "blacklist-keyword"]) {
      assert.match(jobsPage, new RegExp(`@${event}=`));
      assert.ok(jobItem.includes(`$emit('${event}'`));
    }

    assert.match(jobItem, /上次打招呼/);
    assert.match(jobItem, /未读回流/);
    assert.match(jobItem, /job\.communication_status === 'greeted_unread' \? '未读回流'/);
    assert.match(jobItem, /· 上次打招呼 \{\{ formatDate\(job\.last_greeted_at\) \}\}/);
    assert.match(jobItem, /平台：\{\{ job\.source_platform \|\| 'boss' \}\}/);
    assert.match(jobItem, /方式：\{\{ COLLECTION_METHOD_LABELS\[job\.collection_method\]/);
    assert.match(jobItem, /职位 ID\/去重：\{\{ job\.dedup_key \}\}/);
    assert.match(jobItem, /来源链接：\{\{ job\.source_url \}\}/);
    assert.match(jobsTypes, /review_updated_at: string \| null/);
    assert.match(jobsLogic, /lastGreetedAt/);
    assert.match(jobItem, /沟通更新/);
    assert.match(jobsPage, /update-communication/);
    assert.match(jobsQueries, /rs\.updated_at/);
    assert.match(jobsQueries, /'read_no_reply', 'rejected', 'manual_not_fit'/);
    assert.match(jobsQueries, /review_candidates_keep_greeted_unread_jobs_with_last_greeted_at/);
    assert.match(jobsQueries, /review_candidates_keep_greeted_unread_and_filter_negative_communication/);
    assert.match(jobsQueries, /Some\("greeted_unread"\)/);
    assert.match(jobsQueries, /Some\("2026-06-13T08:00:00Z"\)/);
    assert.match(jobItem, /同公司沟通风险/);
    assert.match(jobItem, /拉黑风险公司/);
    assert.match(jobItem, /生成打招呼/);
    assert.match(jobItem, /复制并标记未读/);
    assert.match(jobItem, /岗位依据/);
    assert.match(jobItem, /候选人依据/);
    assert.match(jobItem, /编辑提示/);
  });

  it("passes Top 20 filter, score, source and communication evidence into AI prompts", () => {
    const rustProtocol = readProjectFile("src-tauri/src/ipc/protocol.rs");
    const aiShared = readProjectFile("src-tauri/src/commands/ai/shared.rs");
    const resumeAnalysis = readProjectFile("src-tauri/src/commands/ai/resume_analysis.rs");
    const profileAnalysis = readProjectFile("src-tauri/src/commands/ai/profile_analysis.rs");
    const greeting = readProjectFile("src-tauri/src/commands/ai/greeting.rs");
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
    assert.match(aiShared, /pub\(super\) fn attach_job_ai_context/);
    assert.match(aiShared, /pub\(super\) fn serialize_job_ai_context/);

    assert.match(resumeAnalysis, /let job_context = load_job_ai_context/);
    assert.match(resumeAnalysis, /job_ai_context:\{job_context_hash\}/);
    assert.match(resumeAnalysis, /filter_reason: job_context\.filter_reason/);
    assert.match(resumeAnalysis, /source_context: job_context\.source_context/);
    assert.match(profileAnalysis, /let job_contexts = load_job_contexts/);
    assert.match(profileAnalysis, /sha256_hex_job_details_with_context/);
    assert.match(profileAnalysis, /attach_job_ai_context\(&mut outline, context\)/);
    assert.match(greeting, /let job_context = load_job_ai_context/);
    assert.match(greeting, /score_reason\["resume"\]\["matched_stack"\]\[0\]/);
    assert.match(greeting, /review_context: job_context\.review_context/);

    assert.match(workerSingle, /filterReason: payload\.filter_reason/);
    assert.match(workerSingle, /sourceContext: payload\.source_context/);
    assert.match(workerGreeting, /reviewContext: payload\.review_context/);
    assert.match(workerPrompt, /筛选\/排序\/来源上下文 JSON/);
    assert.match(workerPrompt, /岗位摘要中的 filter_reason、score_reason、source_context、review_context/);
    assert.match(workerPrompt, /不能替代简历原文中的候选人事实/);
    assert.match(workerPrompt, /来源与审核上下文 JSON/);
    assert.match(workerPrompt, /优先使用匹配报告或评分理由中的 resume\.matched_stack/);
    assert.match(workerPrompt, /candidateEvidence 必须来自简历原文、当前情况说明、匹配报告或评分理由/);
    assert.match(workerAiContract, /matched_resume_evidence: \["候选人建设过 Kubernetes 多集群发布平台"/);
    assert.match(workerAiContract, /builds group prompts with per-job filter, score, source and review context/);
    assert.match(workerAiContract, /greeted_unread/);
    assert.match(workerAiContract, /allowed_source_platforms/);
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
    assert.match(jobItem, /filterDimensions\.salary_desc/);
    assert.match(jobItem, /filterDimensions\.experience_name/);
    assert.match(jobItem, /filterDimensions\.review_status/);
  });

  it("keeps the default profile biased toward target tech directions without hard-filtering them", () => {
    const crawlTypes = readProjectFile("src/lib/crawl.ts");
    const filterProfile = readProjectFile("src/lib/filterProfile.ts");
    const dbDefaults = readProjectFile("src-tauri/src/db/models/filter_results.rs");
    const dbTests = readProjectFile("src-tauri/src/db/tests.rs");

    assert.match(crawlTypes, /DEFAULT_PREFERENCE_DIRECTIONS/);
    assert.match(crawlTypes, /"Go", "Infra", "DevOps", "SRE", "平台工程", "AI Infra", "AI Agent", "云原生"/);
    assert.match(crawlTypes, /DEFAULT_PREFERENCE_TECH_TAGS/);
    assert.match(crawlTypes, /"Go", "Kubernetes", "Docker", "AWS", "Prometheus", "Linux", "CI\/CD", "Terraform"/);
    assert.match(filterProfile, /DEFAULT_PREFERENCE_DIRECTIONS\.join\("\\n"\)/);
    assert.match(filterProfile, /DEFAULT_PREFERENCE_TECH_TAGS\.join\("\\n"\)/);
    assert.match(dbDefaults, /"preferenceDirections": \["Go", "Infra", "DevOps", "SRE", "平台工程", "AI Infra", "AI Agent", "云原生"\]/);
    assert.match(dbDefaults, /"preferenceTechTags": \["Go", "Kubernetes", "Docker", "AWS", "Prometheus", "Linux", "CI\/CD", "Terraform"\]/);
    assert.match(dbDefaults, /"requiredDirections": \[\]/);
    assert.match(dbDefaults, /"requiredTechTags": \[\]/);
    assert.match(dbTests, /default preference direction/);
    assert.match(dbTests, /default preference tech tag/);
  });

  it("keeps multi filter profile management wired across Tauri, shared state and pages", () => {
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const dbModels = readProjectFile("src-tauri/src/db/models/filter_results.rs");
    const filterProfileCommand = readProjectFile("src-tauri/src/commands/filter_profile.rs");
    const filterProfile = readProjectFile("src/lib/filterProfile.ts");
    const jobsPageLogic = readProjectFile("src/lib/useJobsPage.ts");
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
    assert.match(filterProfile, /activeFilterProfileName = ref\("默认筛选画像"\)/);
    assert.match(filterProfile, /function applyFilterProfileRecord/);
    assert.match(filterProfile, /function selectFilterProfile/);
    assert.match(filterProfile, /function saveActiveFilterProfile/);
    assert.match(filterProfile, /function createFilterProfile/);
    assert.match(filterProfile, /function setActiveFilterProfileAsDefault/);
    assert.match(filterProfileCommand, /fn set_default_filter_profile_id_on_conn/);
    assert.match(filterProfileCommand, /recompute_default_filter_profile_on_conn\(conn\)\?/);
    assert.match(jobsPageLogic, /async function setActiveFilterProfileAsDefault/);
    assert.match(jobsPageLogic, /invoke<\{ updated: number \}>\("recompute_default_filter_profile"\)/);
    assert.match(jobsPageLogic, /已设为默认画像，并重算/);
    assert.match(jobsPageLogic, /await refreshAfterJobStateChange\(false\)/);

    assert.match(crawlConfigPage, /当前规则集/);
    assert.match(crawlConfigPage, /activeFilterProfileId/);
    assert.match(crawlConfigPage, /selectFilterProfile\(activeFilterProfileId\)/);
    assert.match(crawlConfigPage, /新建规则集/);
    assert.match(crawlConfigPage, /保存规则集/);
    assert.match(crawlConfigPage, /设为默认/);
    assert.match(crawlConfigPage, /默认策略/);
    assert.match(crawlConfigPage, /保存规则集并重算已有职位/);
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
      assert.match(dbDefaults, new RegExp(`"${field}": \\[\\]`));
    }

    for (const rule of [
      "company_required_scale",
      "company_excluded_scale",
      "company_required_financing_stage",
      "company_excluded_financing_stage",
      "company_required_industry",
      "company_excluded_industry",
      "company_scale",
      "company_financing",
      "company_industry",
    ]) {
      assert.match(filterProfileCommand, new RegExp(rule));
    }

    for (const label of ["必须公司规模", "排除公司规模", "偏好公司规模", "必须融资阶段", "排除融资阶段", "偏好融资阶段", "必须行业", "排除行业", "偏好行业"]) {
      assert.match(crawlConfigPage, new RegExp(label));
    }
  });

  it("keeps product copy centered on precise job research instead of automation", () => {
    const appShell = readProjectFile("src/App.vue");
    const crawlPage = readProjectFile("src/pages/Crawl.vue");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const aiPage = readProjectFile("src/pages/Ai.vue");
    const reportsPage = readProjectFile("src/pages/AiReports.vue");

    assert.match(appShell, /精准求职岗位研究台/);
    assert.match(crawlPage, /岗位采集/);
    assert.match(crawlPage, /不执行投递或开聊/);
    assert.match(jobsPage, /职位库工作台/);
    assert.match(jobsPage, /自动采集先保留岗位事实/);
    assert.match(aiPage, /AI 岗位研究/);
    assert.match(aiPage, /人工确认后的精准投递准备/);
    assert.match(reportsPage, /岗位研究报告/);
    assert.match(reportsPage, /辅助人工筛选候选岗位/);
  });

  it("links single-job AI reports back to manual job confirmation without applying automatically", () => {
    const reportsPage = readProjectFile("src/pages/AiReports.vue");
    const reportsLogic = readProjectFile("src/lib/useAiReportsPage.ts");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");

    assert.match(reportsPage, /回到岗位确认/);
    assert.match(reportsLogic, /const reviewJobId = computed/);
    assert.match(reportsLogic, /meta\.kind === "group"/);
    assert.match(reportsLogic, /function goReviewJob/);
    assert.match(reportsLogic, /router\.push\(\{ path: "\/jobs", query: \{ jobId \} \}\)/);

    assert.match(jobsLogic, /useRoute/);
    assert.match(jobsLogic, /route\.query\.jobId/);
    assert.match(jobsLogic, /async function loadLinkedJobFromRoute/);
    assert.match(jobsLogic, /invoke<JobRow \| null>\("get_job"/);
    assert.match(jobsLogic, /expandedJobId\.value = job\.encrypt_job_id/);
    assert.match(jobsLogic, /await loadJobDetail\(job\.encrypt_job_id\)/);
    assert.match(jobsPage, /定位岗位/);
    assert.match(jobsPage, /来自外部入口的岗位会在这里单独定位/);
    assert.match(jobsPage, /linkedJob/);
    assert.doesNotMatch(jobsLogic, /submit.*resume|auto.*apply|batch.*apply/i);
  });

  it("keeps resume-match reports aligned with requirement-doc structured evidence fields", () => {
    const workerPrompt = readProjectFile("packages/boss-crawler-worker/src/ai/prompt.ts");
    const workerSchema = readProjectFile("packages/boss-crawler-worker/src/modes/ai/schemas.ts");
    const workerNormalize = readProjectFile("packages/boss-crawler-worker/src/modes/ai/normalizeResume.ts");
    const aiReportTypes = readProjectFile("src/lib/aiReport.ts");
    const resumeReportView = readProjectFile("src/components/ai-reports/AiResumeReportView.vue");
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
      assert.match(aiReportTypes, new RegExp(field));
      assert.match(resumeReportView, new RegExp(field));
      assert.match(workerAiContract, new RegExp(field));
    }

    assert.match(workerPrompt, /matched_resume_evidence 必须引用简历原文中的具体经历或项目/);
    assert.match(workerNormalize, /matchedResumeEvidence/);
    assert.match(workerNormalize, /matchScore: resumeMatchScore/);
    assert.match(resumeReportView, /Resume Match 结构化证据/);
    assert.match(resumeReportView, /匹配技术栈/);
    assert.match(resumeReportView, /匹配岗位方向/);
    assert.match(resumeReportView, /简历证据/);
    assert.match(resumeReportView, /未明确覆盖/);
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
    assert.match(jobItem, /scoreResumeMatchedStack/);
    assert.match(jobItem, /scoreResumeMatchedDirection/);
    assert.match(jobItem, /scoreResumeEvidence/);
    assert.match(jobItem, /scoreResumeMissingPoints/);
    assert.match(jobItem, /Resume 结构化匹配/);
    assert.match(jobItem, /简历证据/);
    assert.match(jobItem, /未覆盖要求/);
  });

  it("links group AI reports back to the unified job candidate list", () => {
    const reportsPage = readProjectFile("src/pages/AiReports.vue");
    const reportsLogic = readProjectFile("src/lib/useAiReportsPage.ts");

    assert.match(reportsLogic, /const canGoReviewQueue = computed\(\(\) => selectedMetaSnapshot\.value\?\.kind === "group"\)/);
    assert.match(reportsLogic, /function goReviewQueue/);
    assert.match(reportsLogic, /router\.push\(\{ path: "\/jobs" \}\)/);
    assert.match(reportsPage, /canGoReviewQueue/);
    assert.match(reportsPage, /查看岗位候选库/);
  });

  it("returns candidate resume-match analysis to the unified jobs page", () => {
    const aiPage = readProjectFile("src/pages/Ai.vue");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");

    assert.match(aiPage, /async function routeAfterResumeAnalysis/);
    assert.match(aiPage, /isCandidateSource\.value/);
    assert.match(aiPage, /source\.value === "top20" \|\| source\.value === "candidates"/);
    assert.match(aiPage, /router\.push\(\{ path: "\/jobs" \}\)/);
    assert.match(aiPage, /await routeAfterResumeAnalysis\(\)/);
    assert.match(jobsPage, /职位库工作台/);
    assert.match(jobsPage, /采后结果分区/);
  });

  it("does not treat hashed group report ids as expected job ids in coverage checks", () => {
    const reportsPage = readProjectFile("src/pages/AiReports.vue");
    const aiReportTypes = readProjectFile("src/lib/aiReport.ts");
    const aiShared = readProjectFile("src-tauri/src/commands/ai/shared.rs");

    assert.match(aiShared, /format!\("group:\{\}", hex::encode\(hasher\.finalize\(\)\)\)/);
    assert.match(aiReportTypes, /placeholderCount \?\? 0/);
    assert.match(aiReportTypes, /expectedJobIds\.every/);
    assert.doesNotMatch(reportsPage, /reports\.filter\(\(meta\) => meta\.kind === 'group'\)\.map\(\(meta\) => meta\.encrypt_job_id\)/);
    assert.doesNotMatch(reportsPage, /:expected-job-ids/);
  });

  it("keeps blacklist actions and filtering available from the unified jobs page", () => {
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");

    assert.match(jobsLogic, /list_job_blacklist/);
    assert.match(jobsLogic, /\{ value: "blacklisted", label: "黑名单" \}/);
    assert.match(jobsPage, /JOB_STATUS_FILTER_OPTIONS/);
    assert.match(jobsPage, /岗位状态/);
    assert.match(jobsPage, /blacklistCompany\(job\)/);
    assert.match(jobsPage, /blacklistJob\(job\)/);
    assert.match(jobsPage, /blacklistKeyword\(job\)/);
    assert.match(jobItem, /blacklist-company/);
    assert.match(jobItem, /blacklist-job/);
    assert.match(jobItem, /blacklist-keyword/);
    assert.doesNotMatch(jobsPage, /<h2[^>]*>黑名单管理/);
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

    assert.match(sidecar, /commands::filter_profile/);
    assert.match(sidecar, /recompute_default_filter_profile_for_job_on_conn\(conn, &id\)/);
    assert.doesNotMatch(sidecar, /"matched_preferences": \[\]/);
    assert.doesNotMatch(sidecar, /"missing_preferences": \[\]/);
  });

  it("keeps sidecar-filtered jobs stored and explained by the Rust filter projection", () => {
    const sidecar = readProjectFile("src-tauri/src/sidecar/mod.rs");

    assert.match(sidecar, /EventOut::JobFiltered/);
    assert.match(sidecar, /fn extract_job_id_from_list_item\(item: &Value\) -> Option<String>/);
    assert.match(sidecar, /let fallback_id =[\s\S]{0,80}payload\.raw\.as_ref\(\)\.and_then\(extract_job_id_from_list_item\)/);
    assert.match(sidecar, /let encrypt_job_id =[\s\S]{0,80}payload\.encrypt_job_id\.as_deref\(\)\.or\(fallback_id\.as_deref\(\)\)/);
    assert.match(sidecar, /payload\.raw\.as_ref\(\)/);
    assert.match(sidecar, /upsert_job_from_list_item\([\s\S]{0,80}conn,[\s\S]{0,80}encrypt_job_id,[\s\S]{0,80}raw/);
    assert.match(sidecar, /let filters_json =[\s\S]{0,120}payload[\s\S]{0,80}\.filters[\s\S]{0,80}\.as_ref\(\)[\s\S]{0,80}\.and_then\(\|v\| serde_json::to_string\(v\)\.ok\(\)\)/);
    assert.match(sidecar, /insert_job_source_link\([\s\S]*payload\.keyword\.as_deref\(\),[\s\S]*filters_json\.as_deref\(\),[\s\S]*\)/);
    assert.match(sidecar, /recompute_default_filter_profile_for_job_on_conn\([\s\S]{0,120}conn,[\s\S]{0,80}encrypt_job_id/);
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

  it("keeps Boss auto crawl using shared job-list id extraction before filtering and detail fetch", () => {
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

  it("keeps job review commands local-first without automatic apply or send actions", () => {
    const source = readProjectFile("src/lib/useJobsPage.ts");
    const commands = invokedCommands(source);
    const allowedDraftCommands = new Set([
      "generate_greeting_message",
      "send_daily_job_intelligence_wecom_notification",
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
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobsQueries = readProjectFile("src-tauri/src/commands/jobs/queries.rs");
    const jobsMutations = readProjectFile("src-tauri/src/commands/jobs/mutations.rs");
    const filterProfileCommand = readProjectFile("src-tauri/src/commands/filter_profile.rs");

    assert.match(jobItem, /岗位不合适/);
    assert.match(jobsLogic, /status === "manual_not_fit"/);
    assert.match(jobsLogic, /确认将「\$\{job\.position_name \?\? job\.encrypt_job_id\}」标记为岗位不合适/);
    assert.match(jobsLogic, /后续可通过岗位状态筛选查看这类岗位/);
    assert.match(jobsLogic, /notes: job\.review_notes\?\.trim\(\) \|\| "用户从职位库标记岗位不合适"/);
    assert.match(jobsLogic, /标记岗位不合适/);
    assert.match(jobsQueries, /NOT IN \('read_no_reply', 'rejected', 'manual_not_fit'\)/);
    assert.match(jobsQueries, /NOT IN \('favorited', 'ready_to_apply', 'ignored', 'applied'\)/);
    assert.match(jobsMutations, /review_status\.is_some\(\) \|\| communication_status\.is_some\(\)/);
    assert.match(filterProfileCommand, /"review_status": review_status/);
    assert.match(filterProfileCommand, /Some\("review_status"\)/);
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
    assert.match(jobsQueries, /JOB_PROCESSED_SQL/);
    assert.match(jobsQueries, /jb\.id IS NOT NULL/);
    assert.match(jobsQueries, /cb\.id IS NOT NULL/);
    assert.match(jobsQueries, /kb\.kind = 'keyword'/);
    assert.match(jobsQueries, /"blacklisted" => status_parts\.push/);
    assert.match(jobsQueries, /COALESCE\(crs\.review_status, 'pending'\) = 'manual_not_fit'/);
    assert.match(jobsQueries, /NULLIF\(TRIM\(COALESCE\(rs\.notes, ''\)\), ''\) IS NOT NULL/);
    assert.match(jobItem, /canRestoreReviewCandidate/);
    assert.match(jobItem, /恢复候选/);
    assert.match(jobItem, /恢复为待审核和未打招呼/);
    assert.match(jobsPage, /restoreReviewCandidate/);
    assert.match(jobsLogic, /async function restoreReviewCandidate/);
    assert.match(jobsLogic, /showConfirm\(\s*"恢复候选"/);
    assert.match(jobsLogic, /确认恢复/);
    assert.match(jobsLogic, /该操作只恢复人工审核状态/);
    assert.match(jobsLogic, /仍会继续受筛选画像、黑名单和公司状态过滤/);
    assert.match(jobsLogic, /reviewStatus: "pending"/);
    assert.match(jobsLogic, /communicationStatus: "not_contacted"/);
  });

  it("lets users edit and clear local review notes for communication follow-up", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobGroup = readProjectFile("src/components/jobs/JobsGroupCard.vue");
    const jobsCommand = readProjectFile("src-tauri/src/commands/jobs.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const jobsDb = readProjectFile("src-tauri/src/db/models/job_review.rs");

    assert.match(jobItem, /编辑备注/);
    assert.match(jobItem, /update-review-notes/);
    assert.match(jobGroup, /update-review-notes/);
    assert.match(jobsPage, /updateReviewNotes/);
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
    assert.match(jobItem, /同公司负面沟通/);
    assert.match(jobItem, /communicationStatusLabel\(job\.latest_company_negative_communication_status\)/);
    assert.match(jobItem, /拉黑风险公司/);
    assert.match(jobItem, /filterDimensions\.company_review_status/);
    assert.match(jobItem, /filterDimensions\.review_status/);
    assert.match(jobsMutations, /recompute_default_filter_profile_for_company_on_conn\(&conn, &company_name\)/);
    assert.match(filterProfileCommand, /company_review_status/);
    assert.match(filterProfileCommand, /fn recompute_default_filter_profile_for_company_updates_company_manual_not_fit_jobs/);
  });

  it("exposes greeting as an editable draft instead of a send action", () => {
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const greetingCommand = readProjectFile("src-tauri/src/commands/ai/greeting.rs");

    assert.match(jobItem, /canGenerateGreeting/);
    assert.match(jobItem, /先标记准备投递后生成/);
    assert.match(jobItem, /复制后仅记录已打招呼未读，不会自动发送/);
    assert.match(jobItem, /投递准备清单/);
    assert.match(jobItem, /定制简历/);
    assert.match(jobItem, /定制打招呼/);
    assert.match(jobItem, /canEditGreetingDraft/);
    assert.match(jobItem, /isApplicationReady\.value \|\| hasGreetingDraft\.value/);
    assert.match(jobItem, /可编辑打招呼草稿/);
    assert.match(jobItem, /粘贴或编辑打招呼草稿；复制后仅记录已打招呼未读/);
    assert.match(jobItem, /待 AI 生成或手动粘贴/);
    assert.match(jobItem, /\$emit\('go-resume-workspace', job\.encrypt_job_id\)/);
    assert.match(jobItem, /update-greeting-draft/);
    assert.match(jobItem, /copy-greeting/);
    assert.match(greetingCommand, /ensure_greeting_allowed_review_status/);
    assert.match(greetingCommand, /ready_to_apply/);
    assert.match(greetingCommand, /greeting_requires_manual_ready_to_apply_review_status/);
    assert.match(greetingCommand, /get_final_resume_text_for_job/);
    assert.match(greetingCommand, /else if linked_final_resume_text\.is_some\(\)/);
    assert.match(greetingCommand, /ensure_greeting_has_candidate_context/);
    assert.match(greetingCommand, /请先提供简历或当前情况说明，或先为该岗位生成简历匹配报告/);
    assert.match(greetingCommand, /greeting_requires_candidate_context_or_match_report/);
    assert.match(jobsLogic, /缺少候选人证据/);
    assert.doesNotMatch(jobItem, /send-greeting|sendGreeting|auto-send|自动发送消息/);
    assert.doesNotMatch(jobsPage, /send-greeting|sendGreeting|auto-send|自动发送消息/);
  });

  it("keeps greeting generation failures explicit and retryable per job", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobGroup = readProjectFile("src/components/jobs/JobsGroupCard.vue");

    assert.match(jobsLogic, /function describeGreetingFailure/);
    assert.match(jobsLogic, /结构化输出解析失败/);
    assert.match(jobsLogic, /greetingErrors\.set\(job\.encrypt_job_id, describeGreetingFailure\(message\)\)/);
    assert.match(jobsLogic, /greetingErrors\.delete\(job\.encrypt_job_id\)/);
    assert.match(jobsPage, /greetingErrors/);
    assert.match(jobGroup, /greetingErrors: Map<string, GreetingErrorState>/);
    assert.match(jobItem, /greetingError/);
    assert.match(jobItem, /重试打招呼/);
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
    assert.match(jobItem, /复制后仅记录已打招呼未读，不会自动发送。/);
    assert.match(
      jobItem,
      /job\.communication_status === 'greeted_unread' \? '未读回流'[\s\S]{0,240}job\.communication_status === 'greeted_unread' && job\.last_greeted_at[\s\S]{0,120}上次打招呼 \{\{ formatDate\(job\.last_greeted_at\) \}\}/,
    );
    assert.doesNotMatch(jobsLogic, /sendGreeting|send_message|sendMessage|autoSend/i);
  });

  it("copies a local application packet for manually confirmed jobs without applying", () => {
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const jobGroup = readProjectFile("src/components/jobs/JobsGroupCard.vue");
    const copyApplicationPacketSource =
      jobsLogic.match(/async function copyApplicationPacket[\s\S]*?\n  async function copyDailyIntelligence/)?.[0] ?? "";

    assert.match(jobsLogic, /function buildApplicationPacket/);
    assert.match(jobsLogic, /function buildApplicationChecklist/);
    assert.match(jobsLogic, /function buildApplicationReadinessGaps/);
    assert.match(jobsLogic, /function formatApplicationReadinessPreflight/);
    assert.match(jobsLogic, /function buildGreetingEvidenceTrace/);
    assert.match(jobsLogic, /技术交集：\$\{greeting\.overlapKeywords\.join\("、"\)\}/);
    assert.match(jobsLogic, /岗位依据：\$\{greeting\.jobEvidence\.join\("；"\)\}/);
    assert.match(jobsLogic, /候选人依据：\$\{greeting\.candidateEvidence\.join\("；"\)\}/);
    assert.match(jobsLogic, /编辑提示：\$\{greeting\.editNotes\.join\("；"\)\}/);
    assert.match(jobsLogic, /function formatApplicationFilterTrace/);
    assert.match(jobsLogic, /parseFilterReasonJson\(job\.filter_reason_json\)/);
    assert.match(jobsLogic, /通过筛选画像/);
    assert.match(jobsLogic, /【Job Sync 投递材料包】/);
    assert.match(jobsLogic, /简历工作区：\/resume-workspace\?jobId=/);
    assert.match(jobsLogic, /getResumeWorkspaceStatusForJob/);
    assert.match(jobsLogic, /resumeWorkspaceStatuses = reactive<Map<string, ResumeWorkspaceJobStatus \| null>>\(new Map\(\)\)/);
    assert.match(jobsLogic, /async function loadResumeWorkspaceStatus/);
    assert.match(jobsLogic, /loadResumeWorkspaceStatusesForJobs\(applicationReadyJobs\.value\)/);
    assert.match(jobsLogic, /function buildResumeWorkspaceTrace/);
    assert.match(jobsLogic, /简历工作区状态：\$\{buildResumeWorkspaceTrace\(resumeWorkspaceStatus\)\}/);
    assert.match(jobsLogic, /最终简历：\$\{hasFinalResume \? "已生成" : "待在简历工作区生成"\}/);
    assert.match(jobsLogic, /PDF：\$\{hasExportedPdf \? resumeWorkspaceStatus\?\.last_exported_pdf_path : "待导出"\}/);
    assert.match(jobsLogic, /待 AI 生成或手动粘贴/);
    assert.match(jobsLogic, /投递准备清单：\\n/);
    assert.match(jobsLogic, /投递准备预检：\\n/);
    assert.match(jobsLogic, /仍有 \$\{gaps\.length\} 项待补齐/);
    assert.match(jobsLogic, /最终简历：尚未生成岗位定制最终稿/);
    assert.match(jobsLogic, /PDF：尚未导出岗位定制 PDF/);
    assert.match(jobsLogic, /打招呼草稿：尚未生成或粘贴可编辑草稿/);
    assert.match(jobsLogic, /尚未生成或粘贴，请先点击“定制打招呼”或手动填写。/);
    assert.match(jobsLogic, /人工确认：/);
    assert.match(jobsLogic, /筛选画像：\$\{formatApplicationFilterTrace\(job\)\}/);
    assert.match(jobsLogic, /筛选依据：\$\{formatApplicationFilterTrace\(job\)\}/);
    assert.match(jobsLogic, /简历匹配报告：/);
    assert.match(jobsLogic, /function buildResumeMatchEvidenceTrace/);
    assert.match(jobsLogic, /formatResumeMatchEvidence\(parseScoreReasonJson\(scoreReasonJson\)\)/);
    assert.match(jobsLogic, /Resume Match 证据：\\n\$\{resumeMatchEvidence\}/);
    assert.match(jobsLogic, /打招呼草稿/);
    assert.match(jobsLogic, /打招呼证据：\\n\$\{buildGreetingEvidenceTrace\(greeting\)\}/);
    assert.match(jobsLogic, /function buildReadyToApplyConfirmationMessage/);
    assert.match(jobsLogic, /buildApplicationChecklist\(job, greetingDraft, resumeWorkspaceStatus\)/);
    assert.match(jobsLogic, /formatApplicationReadinessPreflight\(job, greetingDraft, resumeWorkspaceStatus\)/);
    assert.match(jobsLogic, /待分析，建议先生成简历匹配报告/);
    assert.match(jobsLogic, /投递准备预检：\\n\$\{readinessPreflight\}/);
    assert.match(jobsLogic, /投递准备清单：\\n\$\{checklist\}/);
    assert.match(jobsLogic, /该操作只记录本地准备投递状态，不会自动发送或投递。/);
    assert.match(jobsLogic, /function formatCommunicationTrace/);
    assert.match(jobsLogic, /job\.communication_status === "greeted_unread" \? "未读回流"/);
    assert.match(jobsLogic, /沟通追踪：\$\{formatCommunicationTrace\(job\)\}/);
    assert.match(jobsLogic, /上次打招呼 \$\{formatDate\(job\.last_greeted_at\)\}/);
    assert.match(jobsLogic, /备注 \$\{notes\}/);
    assert.match(jobsLogic, /function formatSourceTrace/);
    assert.match(jobsLogic, /来源追踪：\$\{formatSourceTrace\(job\)\}/);
    assert.match(jobsLogic, /去重 \$\{dedupKey\}/);
    assert.match(jobsLogic, /采集 \$\{formatDate\(job\.last_seen_at\)\}/);
    assert.match(jobsLogic, /不会自动发送或投递/);
    assert.match(jobsLogic, /async function copyApplicationPacket/);
    assert.match(jobsLogic, /job\.review_status !== "ready_to_apply" && job\.review_status !== "applied"/);
    assert.match(jobsLogic, /请先人工确认岗位并标记为准备投递，再复制投递材料包。/);
    assert.match(jobsLogic, /async function openJobSourceUrl\(job: JobRow\)/);
    assert.match(jobsLogic, /await openUrl\(url\)/);
    assert.match(jobsLogic, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
    assert.match(jobsLogic, /打开来源链接失败/);
    assert.match(jobsLogic, /getResumeWorkspaceStatusForJob\(job\.encrypt_job_id\)/);
    assert.match(jobsLogic, /buildApplicationPacket\(\s*job,\s*greetingDrafts\.get\(job\.encrypt_job_id\),\s*resumeWorkspaceStatus,\s*greetingCache\.get\(job\.encrypt_job_id\),\s*\)/);
    assert.match(jobsLogic, /buildApplicationPacket\([\s\S]{0,240}sourcePlatformModeTrace\(\)[\s\S]{0,80}\]\.join\("\\n"\)/);
    assert.match(jobItem, /applicationChecklist/);
    assert.match(jobItem, /applicationReadinessGaps/);
    assert.match(jobItem, /applicationReadinessSummary/);
    assert.match(jobItem, /投递准备预检/);
    assert.match(jobItem, /仍有 \$/);
    assert.match(jobItem, /resumeWorkspaceStatus\?: ResumeWorkspaceJobStatus \| null/);
    assert.match(jobItem, /resumeWorkspaceStatusLoaded/);
    assert.match(jobItem, /hasFinalResume/);
    assert.match(jobItem, /hasExportedPdf/);
    assert.match(jobItem, /展开岗位后检查工作区状态/);
    assert.match(jobItem, /last_exported_pdf_path/);
    assert.match(jobItem, /applicationNextActions/);
    assert.match(jobItem, /triggerApplicationNextAction/);
    assert.match(jobItem, /投递准备下一步/);
    assert.match(jobItem, /最终简历 \/ PDF/);
    assert.match(jobItem, /label: "筛选画像"/);
    assert.match(jobItem, /detail: filterProfileTraceText\.value/);
    assert.match(jobItem, /展开岗位后检查最终稿和 PDF/);
    assert.match(jobItem, /最终稿已生成/);
    assert.match(jobItem, /最终稿待生成/);
    assert.match(jobItem, /PDF 待导出/);
    assert.match(jobItem, /标记准备投递/);
    assert.match(jobItem, /去 AI 分析/);
    assert.match(jobItem, /key: "open-source-url"/);
    assert.match(jobItem, /label: "打开来源"/);
    assert.match(jobItem, /打开原平台职位页供人工确认或手动投递；不会自动发送或投递/);
    assert.match(jobItem, /emit\("open-source-url", props\.job\)/);
    assert.match(jobItem, /emit\("update-review", props\.job, "ready_to_apply"\)/);
    assert.match(jobItem, /标记已投递/);
    assert.match(jobItem, /emit\("update-review", props\.job, "applied"\)/);
    assert.match(jobItem, /emit\("go-ai", props\.job\.encrypt_job_id\)/);
    assert.match(jobItem, /创建联动简历/);
    assert.match(jobItem, /打开简历工作区/);
    assert.match(jobItem, /绑定当前岗位的简历工作区/);
    assert.match(jobItem, /不会把岗位自动改为已投递/);
    assert.match(jobsLogic, /async function applyReviewStatus/);
    assert.match(jobsLogic, /status === "ready_to_apply"/);
    assert.match(jobsLogic, /resumeWorkspaceStatuses\.has\(job\.encrypt_job_id\)/);
    assert.match(jobsLogic, /await loadResumeWorkspaceStatus\(job\.encrypt_job_id\)/);
    assert.match(jobsLogic, /buildReadyToApplyConfirmationMessage\(job, greetingDrafts\.get\(job\.encrypt_job_id\), resumeWorkspaceStatus\)/);
    assert.match(jobsLogic, /buildReadyToApplyConfirmationMessage\(job, greetingDrafts\.get\(job\.encrypt_job_id\), resumeWorkspaceStatus\)[\s\S]{0,120}sourcePlatformModeTrace\(\)/);
    assert.match(jobsLogic, /确认准备投递/);
    assert.match(jobsLogic, /status === "applied"/);
    assert.match(jobsLogic, /确认已在外部平台手动完成/);
    assert.match(jobsLogic, /该操作只记录本地已投递状态，不会自动投递。/);
    assert.match(jobsLogic, /确认已手动投递/);
    assert.match(jobItem, /就绪/);
    assert.match(jobItem, /待补齐/);
    assert.match(jobItem, /复制材料包/);
    assert.match(jobItem, /copy-application-packet/);
    assert.match(jobGroup, /copy-application-packet/);
    assert.match(jobGroup, /open-source-url/);
    assert.match(jobGroup, /resumeWorkspaceStatuses: Map<string, ResumeWorkspaceJobStatus \| null>/);
    assert.match(jobGroup, /resumeWorkspaceStatuses\.get\(job\.encrypt_job_id\)/);
    assert.match(jobsPage, /@open-source-url="\(job\) => openJobSourceUrl\(job\)"/);
    assert.match(jobsPage, /copyApplicationPacket/);
    assert.match(jobsPage, /resumeWorkspaceStatuses\.get\(job\.encrypt_job_id\)/);
    assert.match(copyApplicationPacketSource, /async function copyApplicationPacket/);
    assert.doesNotMatch(copyApplicationPacketSource, /set_job_review_state[\s\S]*applied/);
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
    assert.match(jobsPage, /selectedJobStatusFilters\.includes\(option\.value\)/);
    assert.match(jobsPage, /toggleJobStatusFilter\(option\.value\)/);
    assert.match(jobsPage, /updateReviewStatus\(job, status\)/);
    assert.match(jobsPage, /updateCommunicationStatus\(job, status\)/);
    assert.match(jobsPage, /copyApplicationPacket/);
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

    assert.match(jobsPageView, /采后结果分区/);
    assert.match(jobsPageView, /jobIntelligenceRangeLabel/);
    assert.match(jobsPageView, /currentPageUnprocessedCount/);
    assert.match(jobsPageView, /currentPageProcessedCount/);
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

  it("keeps resume workspace AI failures explicit and retryable", () => {
    const resumeWorkspaceLogic = readProjectFile("src/lib/useResumeWorkspacePage.ts");
    const resumeWorkspaceView = readProjectFile("src/pages/ResumeWorkspace.vue");

    assert.match(resumeWorkspaceLogic, /结构化输出解析失败/);
    assert.match(resumeWorkspaceLogic, /retryCurrentAction/);
    assert.match(resumeWorkspaceLogic, /retryActionLabel/);
    assert.match(resumeWorkspaceLogic, /重试诊断/);
    assert.match(resumeWorkspaceLogic, /重试生成最终稿/);
    assert.match(resumeWorkspaceLogic, /重试导出 PDF/);
    assert.match(resumeWorkspaceView, /errorTitle/);
    assert.match(resumeWorkspaceView, /errorHint/);
    assert.match(resumeWorkspaceView, /retryCurrentAction/);
  });

  it("keeps AI report generation failures explicit and retryable", () => {
    const aiPage = readProjectFile("src/pages/Ai.vue");

    assert.match(aiPage, /function describeAiFailure/);
    assert.match(aiPage, /结构化输出解析失败/);
    assert.match(aiPage, /模型返回内容不是可用 JSON/);
    assert.match(aiPage, /降低 Temperature/);
    assert.match(aiPage, /retryAnalyze/);
    assert.match(aiPage, /retryAnalyzeGroup/);
    assert.match(aiPage, /force\.value = true/);
    assert.match(aiPage, /强制重试/);
  });

  it("keeps filtered jobs linked into the resume workspace context", () => {
    const resumeWorkspaceLogic = readProjectFile("src/lib/useResumeWorkspacePage.ts");
    const resumeWorkspaceView = readProjectFile("src/pages/ResumeWorkspace.vue");
    const resumeWorkspaceHeader = readProjectFile("src/components/resume-workspace/ResumeWorkspaceHeader.vue");
    const sourcePanel = readProjectFile("src/components/resume-workspace/ResumeWorkspaceSourcePanel.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const jobItem = readProjectFile("src/components/jobs/JobsJobItem.vue");
    const originalNavEntries = resumeWorkspaceLogic.match(/\{ key: "original", label: "原始简历"/g) ?? [];

    assert.match(jobsLogic, /path: "\/resume-workspace", query: \{ jobId \}/);
    assert.match(jobsLogic, /createResumeWorkspace/);
    assert.match(jobsLogic, /switchResumeWorkspace/);
    assert.match(jobsLogic, /existingStatus\?\.workspace_id/);
    assert.match(jobsLogic, /linked_job_id: jobId/);
    assert.match(jobsLogic, /buildResumeWorkspaceTitle/);
    assert.match(jobItem, /创建联动简历/);
    assert.match(jobItem, /打开简历工作区/);
    assert.match(jobItem, /绑定当前岗位的简历工作区/);
    assert.match(resumeWorkspaceLogic, /route\.query\.jobId/);
    assert.match(resumeWorkspaceLogic, /useRouter/);
    assert.match(resumeWorkspaceLogic, /draft\.value\.linked_job_id = job\.encrypt_job_id/);
    assert.match(resumeWorkspaceLogic, /linkedJob\.value\?\.encrypt_job_id \?\? draft\.value\.linked_job_id \?\? null/);
    assert.match(resumeWorkspaceLogic, /router\.push\(\{ path: "\/jobs", query: \{ jobId \} \}\)/);
    assert.match(resumeWorkspaceLogic, /last_exported_pdf_path = path/);
    assert.match(resumeWorkspaceLogic, /last_exported_pdf_at = new Date\(\)\.toISOString\(\)/);
    assert.match(resumeWorkspaceLogic, /LINKED_JOB_CONTEXT_PREFIX/);
    assert.match(resumeWorkspaceLogic, /岗位ID：\$\{job\.encrypt_job_id\}/);
    assert.match(resumeWorkspaceLogic, /get_job/);
    assert.match(resumeWorkspaceLogic, /get_job_detail/);
    assert.match(resumeWorkspaceLogic, /mergeLinkedJobContext/);
    assert.match(resumeWorkspaceLogic, /reapplyLinkedJobContextForActiveWorkspace/);
    assert.match(resumeWorkspaceLogic, /await reapplyLinkedJobContextForActiveWorkspace\(\)/);
    assert.match(resumeWorkspaceView, /linkedJobContextApplied/);
    assert.match(resumeWorkspaceView, /goLinkedJobReview/);
    assert.match(resumeWorkspaceHeader, /回到岗位确认/);
    assert.match(resumeWorkspaceHeader, /goLinkedJobReview/);
    assert.match(sourcePanel, /已联动岗位/);
    assert.equal(originalNavEntries.length, 1);
  });

  it("keeps the unified job source registry visible with manual import adapters", () => {
    const settingsPage = readProjectFile("src/pages/Settings.vue");
    const jobsPage = readProjectFile("src/pages/Jobs.vue");
    const crawlPage = readProjectFile("src/pages/Crawl.vue");
    const crawlConfigPage = readProjectFile("src/pages/CrawlConfig.vue");
    const jobsLogic = readProjectFile("src/lib/useJobsPage.ts");
    const filterProfile = readProjectFile("src/lib/filterProfile.ts");
    const crawlTypes = readProjectFile("src/lib/crawl.ts");
    const jobsTypes = readProjectFile("src/lib/jobs.ts");
    const jobsCommand = readProjectFile("src-tauri/src/commands/jobs.rs");
    const jobsMutations = readProjectFile("src-tauri/src/commands/jobs/mutations.rs");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");
    const dbTests = readProjectFile("src-tauri/src/db/tests.rs");

    assert.match(settingsPage, /统一职位来源/);
    assert.match(settingsPage, /统一职位来源维度/);
    assert.match(settingsPage, /list_job_sources/);
    assert.match(settingsPage, /set_job_source_enabled/);
    assert.match(settingsPage, /get_login_status/);
    assert.match(settingsPage, /start_login/);
    assert.match(settingsPage, /登录预留/);
    assert.match(settingsPage, /visibleJobSources/);
    assert.match(settingsPage, /aria-pressed/);
    assert.match(settingsPage, /adapter_kind/);
    assert.doesNotMatch(crawlPage, /start_login/);
    assert.doesNotMatch(jobsPage, /外部岗位导入/);
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
    assert.doesNotMatch(jobsPage, /setBossOnlySourcePlatforms/);
    assert.doesNotMatch(jobsPage, /setManualImportSourcePlatforms/);
    assert.doesNotMatch(jobsPage, /setAllSourcePlatforms/);
    assert.match(crawlConfigPage, /setBossOnlySourcePlatforms/);
    assert.match(crawlConfigPage, /setManualImportSourcePlatforms/);
    assert.match(crawlConfigPage, /setAllSourcePlatforms/);
    assert.match(crawlConfigPage, /sourcePlatformModeLabel/);
    assert.match(crawlConfigPage, /sourcePlatformModeHint/);
    assert.match(filterProfile, /sourcePlatformOptions: JOB_SOURCE_PLATFORM_OPTIONS/);
    assert.match(filterProfile, /sourcePlatformModeLabel/);
    assert.match(filterProfile, /sourcePlatformModeHint/);
    assert.match(filterProfile, /只允许 Boss 岗位进入筛选和 Top 20/);
    assert.match(filterProfile, /外部保留来源/);
    assert.match(filterProfile, /保存画像并重算后对已有岗位生效/);
    assert.match(filterProfile, /function setBossOnlySourcePlatforms/);
    assert.match(filterProfile, /function setManualImportSourcePlatforms/);
    assert.match(filterProfile, /function setAllSourcePlatforms/);
    assert.match(crawlTypes, /JOB_SOURCE_PLATFORM_OPTIONS/);
    assert.match(crawlTypes, /MANUAL_IMPORT_SOURCE_PLATFORMS/);
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
    assert.match(dbTests, /init_db_seeds_job_source_registry_with_manual_import_adapters/);
    assert.match(dbTests, /init_db_preserves_existing_job_source_enabled_choices/);
    assert.match(dbTests, /Boss 直聘/);
    assert.match(dbTests, /liepin/);
    assert.match(dbTests, /manual_import/);
    assert.match(dbTests, /enabled == 1/);
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
    assert.match(desktopSmokeSeedScript, /resume-workspaces/);
    assert.match(desktopSmokeSeedScript, /smoke-resume-ready\.pdf/);
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
    assert.match(settingsCommand, /has_wecom_webhook_url/);
    assert.match(settingsCommand, /wecom_webhook_url: None/);
    assert.match(settingsCommand, /public_settings_redacts_saved_wecom_webhook_url/);
    assert.match(settingsCommand, /proxy_url: Option<String>/);
    assert.match(settingsCommand, /public_settings_exposes_saved_proxy_url/);
    assert.match(settingsPage, /has_openai_api_key/);
    assert.match(settingsPage, /has_wecom_webhook_url/);
    assert.match(settingsPage, /wecomWebhookUrl/);
    assert.match(settingsPage, /企业微信机器人 Webhook/);
    assert.match(settingsPage, /已保存，当前不回显/);
  });

  it("keeps external dependency diagnostics manual and redacted", () => {
    const settingsCommand = readProjectFile("src-tauri/src/commands/settings.rs");
    const settingsPage = readProjectFile("src/pages/Settings.vue");
    const tauriLib = readProjectFile("src-tauri/src/lib.rs");

    const commands = invokedCommands(settingsPage);
    const modelDiagnostic = settingsCommand.match(/pub struct ModelServiceDiagnostic \{[\s\S]*?\n\}/)?.[0] ?? "";
    const wecomDiagnostic = settingsCommand.match(/pub struct WecomDiagnostic \{[\s\S]*?\n\}/)?.[0] ?? "";
    const diagnosticSummaryBlock = settingsPage.match(/function buildExternalDiagnosticsSummary[\s\S]*?async function save/)?.[0] ?? "";

    assert.match(settingsCommand, /pub struct BossSessionDiagnostic/);
    assert.match(settingsCommand, /pub struct ModelServiceDiagnostic/);
    assert.match(settingsCommand, /pub struct WecomDiagnostic/);
    assert.match(settingsCommand, /pub struct ExternalDependencyDiagnostics/);
    assert.match(settingsCommand, /pub fn diagnose_external_dependencies/);
    assert.match(settingsCommand, /crate::commands::ai::list_models\(app, api_key, base_url\)/);
    assert.match(tauriLib, /commands::settings::diagnose_external_dependencies/);

    assert.ok(commands.includes("diagnose_external_dependencies"));
    assert.ok(!commands.includes("send_daily_job_intelligence_wecom_notification"));
    assert.doesNotMatch(settingsCommand, /send_daily_job_intelligence_wecom_notification/);
    assert.doesNotMatch(modelDiagnostic, /api_key|webhook|cookie|local_storage/);
    assert.doesNotMatch(wecomDiagnostic, /webhook_url: Option<String>/);
    assert.doesNotMatch(settingsPage, /diagnostics\.wecom\.webhook_url\b/);
    assert.doesNotMatch(diagnosticSummaryBlock, /apiKey\.value|wecomWebhookUrl\.value|baseUrl\.value/);

    assert.match(settingsPage, /外部依赖诊断/);
    assert.match(settingsPage, /运行诊断/);
    assert.match(settingsPage, /复制诊断摘要/);
    assert.match(settingsPage, /copyExternalDiagnosticsSummary/);
    assert.match(settingsPage, /仅用于本机依赖验收记录/);
    assert.match(settingsPage, /不回显 Key、Webhook、Cookie 或 LocalStorage/);
    assert.match(settingsPage, /手动通知入口，不自动投递/);
    assert.match(settingsPage, /不会触发采集、投递、开聊或企业微信发送/);
    assert.match(settingsPage, /apiKey: apiKey\.value\.trim\(\) \|\| null/);
    assert.match(settingsPage, /baseUrl: baseUrl\.value\.trim\(\) \|\| null/);
  });

  it("keeps saved worker proxy settings wired to worker environment", () => {
    const settingsPage = readProjectFile("src/pages/Settings.vue");
    const settingsCommand = readProjectFile("src-tauri/src/commands/settings.rs");
    const settingsCore = readProjectFile("src-tauri/src/settings.rs");

    assert.match(settingsPage, /网络代理/);
    assert.match(settingsPage, /Worker 代理 URL/);
    assert.match(settingsPage, /proxyUrl/);
    assert.match(settingsPage, /proxyUrl: proxyUrl\.value\.trim\(\) \|\| null/);
    assert.match(settingsCommand, /proxy_url: Option<String>/);
    assert.match(settingsCommand, /current\.proxy_url = opt_trimmed\(proxy_url\)/);
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
