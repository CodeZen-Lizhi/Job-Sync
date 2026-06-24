use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginStartPayload {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_platform: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStatePayload {
    pub cookies: Value,
    pub local_storage: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlAutoStartPayload {
    pub session: SessionStatePayload,
    pub task: SearchTaskPayload,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshJobEvidencePayload {
    pub session: SessionStatePayload,
    pub encrypt_job_id: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_payload: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BossMetaSyncPayload {
    pub session: SessionStatePayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BossChatSyncPayload {
    pub session: SessionStatePayload,
    #[serde(default)]
    pub limits: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchTaskPayload {
    pub keywords: Vec<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_platform: Option<String>,
    #[serde(default)]
    pub filters: Value,
    #[serde(default)]
    pub limits: Value,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAnalyzePayload {
    pub resume_text: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_text: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_files: Option<String>,
    pub job_detail: Value,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_reason: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_reason: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_context: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_context: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiAnalyzeGroupPayload {
    pub context_text: String,
    pub jobs: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiGreetingPayload {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_text: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_text: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_files: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub greeting_prompt_extra: Option<String>,
    pub job_detail: Value,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_report: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_reason: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_reason: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_context: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_context: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCompanyScoreCompanyPayload {
    pub company_name: String,
    pub jobs_count: u32,
    #[serde(default)]
    pub source_text: String,
    #[serde(default)]
    pub jobs: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiCompanyScoreBatchPayload {
    pub companies: Vec<AiCompanyScoreCompanyPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiPostCollectionJudgePayload {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<Value>,
    pub job: Value,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_reason: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeDiagnosePayload {
    pub resume_text: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_text: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_files: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeRewriteModulePayload {
    pub module: String,
    pub resume_text: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_text: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_files: Option<String>,
    pub module_input: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmed_summary: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmed_projects: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmed_experience: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmed_skills: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum CommandIn {
    #[serde(rename = "LOGIN_START")]
    LoginStart(LoginStartPayload),
    #[serde(rename = "CRAWL_AUTO_START")]
    CrawlAutoStart(CrawlAutoStartPayload),
    #[serde(rename = "REFRESH_JOB_EVIDENCE")]
    RefreshJobEvidence(RefreshJobEvidencePayload),
    #[serde(rename = "BOSS_META_SYNC")]
    BossMetaSync(BossMetaSyncPayload),
    #[serde(rename = "BOSS_CHAT_SYNC")]
    BossChatSync(BossChatSyncPayload),
    #[serde(rename = "AI_ANALYZE")]
    AiAnalyze(AiAnalyzePayload),
    #[serde(rename = "AI_ANALYZE_GROUP")]
    AiAnalyzeGroup(AiAnalyzeGroupPayload),
    #[serde(rename = "AI_GREETING")]
    AiGreeting(AiGreetingPayload),
    #[serde(rename = "AI_COMPANY_SCORE_BATCH")]
    AiCompanyScoreBatch(AiCompanyScoreBatchPayload),
    #[serde(rename = "AI_POST_COLLECTION_JUDGE")]
    AiPostCollectionJudge(AiPostCollectionJudgePayload),
    #[serde(rename = "RESUME_DIAGNOSE")]
    ResumeDiagnose(ResumeDiagnosePayload),
    #[serde(rename = "RESUME_REWRITE_MODULE")]
    ResumeRewriteModule(ResumeRewriteModulePayload),
    #[serde(rename = "STOP")]
    Stop,
    #[serde(rename = "PAUSE")]
    Pause,
    #[serde(rename = "RESUME")]
    Resume,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogPayload {
    pub level: String,
    pub message: String,
    #[serde(default)]
    pub ts: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    #[serde(default)]
    pub keyword: Option<String>,
    #[serde(default)]
    pub current_page: Option<u32>,
    #[serde(default)]
    pub captured_job_list: Option<u32>,
    #[serde(default)]
    pub captured_job_detail: Option<u32>,
    #[serde(default)]
    pub filtered_job: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginStatusPayload {
    pub status: String,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CookieCollectedPayload {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_platform: Option<String>,
    pub cookies: Value,
    pub local_storage: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobListCapturedPayload {
    #[serde(default)]
    pub keyword: Option<String>,
    #[serde(default)]
    pub filters: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_source: Option<String>,
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobDetailCapturedPayload {
    pub encrypt_job_id: String,
    pub zp_data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobNormalizedCapturedPayload {
    pub encrypt_job_id: String,
    pub source_platform: String,
    #[serde(default)]
    pub source_url: Option<String>,
    pub dedup_key: String,
    #[serde(default)]
    pub position_name: Option<String>,
    #[serde(default)]
    pub boss_name: Option<String>,
    #[serde(default)]
    pub brand_name: Option<String>,
    #[serde(default)]
    pub city_name: Option<String>,
    #[serde(default)]
    pub salary_desc: Option<String>,
    #[serde(default)]
    pub experience_name: Option<String>,
    #[serde(default)]
    pub degree_name: Option<String>,
    #[serde(default)]
    pub jd_text: Option<String>,
    pub raw_payload: Value,
    #[serde(default)]
    pub keyword: Option<String>,
    #[serde(default)]
    pub filters: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobFilteredPayload {
    #[serde(default)]
    pub encrypt_job_id: Option<String>,
    #[serde(default)]
    pub keyword: Option<String>,
    #[serde(default)]
    pub filters: Option<Value>,
    pub reason: Value,
    #[serde(default)]
    pub raw: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResultPayload {
    pub result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BossMetaSyncedPayload {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_at: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city_group: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_conditions: Option<Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub industry_filter_exemption: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BossChatStatusSyncedPayload {
    pub encrypt_job_id: String,
    pub communication_status: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boss_name: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_name: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_name: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_status: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_preview: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorPayload {
    pub message: String,
    #[serde(default)]
    pub stack: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum EventOut {
    #[serde(rename = "LOG")]
    Log(LogPayload),
    #[serde(rename = "PROGRESS")]
    Progress(ProgressPayload),
    #[serde(rename = "LOGIN_STATUS")]
    LoginStatus(LoginStatusPayload),
    #[serde(rename = "COOKIE_COLLECTED")]
    CookieCollected(CookieCollectedPayload),
    #[serde(rename = "JOB_LIST_CAPTURED")]
    JobListCaptured(JobListCapturedPayload),
    #[serde(rename = "JOB_DETAIL_CAPTURED")]
    JobDetailCaptured(JobDetailCapturedPayload),
    #[serde(rename = "JOB_NORMALIZED_CAPTURED")]
    JobNormalizedCaptured(JobNormalizedCapturedPayload),
    #[serde(rename = "JOB_FILTERED")]
    JobFiltered(JobFilteredPayload),
    #[serde(rename = "AI_RESULT")]
    AiResult(AiResultPayload),
    #[serde(rename = "BOSS_META_SYNCED")]
    BossMetaSynced(BossMetaSyncedPayload),
    #[serde(rename = "BOSS_CHAT_STATUS_SYNCED")]
    BossChatStatusSynced(BossChatStatusSyncedPayload),
    #[serde(rename = "FINISHED")]
    Finished,
    #[serde(rename = "ERROR")]
    Error(ErrorPayload),
}
