mod models;
mod mutations;
mod queries;
mod shared;

use serde_json::Value;

pub use models::{
    CompanyScoreRebuildResult, JobBlacklistEntry, JobCandidatePage, JobDailyIntelligence, JobRow,
    JobSourceEntry, KeywordGroup,
};

#[tauri::command]
pub fn list_jobs(
    app: tauri::AppHandle,
    keyword: Option<String>,
    city: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    queries::list_jobs(app, keyword, city, limit, offset)
}

#[tauri::command]
pub fn list_job_candidates(
    app: tauri::AppHandle,
    bucket: Option<String>,
    query: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    processed: Option<String>,
    status_filters: Option<Vec<String>>,
    ai_audit_filters: Option<Vec<String>>,
    source_platforms: Option<Vec<String>>,
    collection_methods: Option<Vec<String>>,
    limit: Option<u32>,
    offset: Option<u32>,
    cursor: Option<String>,
) -> Result<JobCandidatePage, String> {
    queries::list_job_candidates(
        app,
        bucket,
        query,
        start_date,
        end_date,
        processed,
        status_filters,
        ai_audit_filters,
        source_platforms,
        collection_methods,
        limit,
        offset,
        cursor,
    )
}

#[tauri::command]
pub fn get_job(app: tauri::AppHandle, encrypt_job_id: String) -> Result<Option<JobRow>, String> {
    queries::get_job(app, encrypt_job_id)
}

#[tauri::command]
pub fn list_source_keywords(
    app: tauri::AppHandle,
    search: Option<String>,
) -> Result<Vec<KeywordGroup>, String> {
    queries::list_source_keywords(app, search)
}

#[tauri::command]
pub fn list_jobs_by_source(
    app: tauri::AppHandle,
    source_keyword: Option<String>,
) -> Result<Vec<JobRow>, String> {
    queries::list_jobs_by_source(app, source_keyword)
}

#[tauri::command]
pub fn list_review_candidates(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    queries::list_review_candidates(app, limit)
}

#[tauri::command]
pub fn list_favorited_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    queries::list_favorited_jobs(app, limit)
}

#[tauri::command]
pub fn list_application_ready_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    queries::list_application_ready_jobs(app, limit)
}

#[tauri::command]
pub fn list_communication_followup_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    queries::list_communication_followup_jobs(app, limit)
}

#[tauri::command]
pub fn list_filtered_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    queries::list_filtered_jobs(app, limit)
}

#[tauri::command]
pub fn list_pending_confirmation_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    queries::list_pending_confirmation_jobs(app, limit)
}

#[tauri::command]
pub fn list_job_blacklist(
    app: tauri::AppHandle,
    kind: Option<String>,
) -> Result<Vec<JobBlacklistEntry>, String> {
    queries::list_job_blacklist(app, kind)
}

#[tauri::command]
pub fn list_job_sources(app: tauri::AppHandle) -> Result<Vec<JobSourceEntry>, String> {
    queries::list_job_sources(app)
}

#[tauri::command]
pub fn set_job_source_enabled(
    app: tauri::AppHandle,
    platform: String,
    enabled: bool,
) -> Result<Vec<JobSourceEntry>, String> {
    mutations::set_job_source_enabled(app, platform, enabled)
}

#[tauri::command]
pub fn get_daily_job_intelligence(
    app: tauri::AppHandle,
    report_date: Option<String>,
) -> Result<JobDailyIntelligence, String> {
    queries::get_daily_job_intelligence(app, report_date)
}

#[tauri::command]
pub fn get_job_detail(
    app: tauri::AppHandle,
    encrypt_job_id: String,
) -> Result<Option<Value>, String> {
    queries::get_job_detail(app, encrypt_job_id)
}

#[tauri::command]
pub fn delete_job(app: tauri::AppHandle, encrypt_job_id: String) -> Result<(), String> {
    mutations::delete_job(app, encrypt_job_id)
}

#[tauri::command]
pub fn delete_all_jobs(app: tauri::AppHandle) -> Result<(), String> {
    mutations::delete_all_jobs(app)
}

#[tauri::command]
pub fn rebuild_job_fields(app: tauri::AppHandle) -> Result<u64, String> {
    mutations::rebuild_job_fields(app)
}

#[tauri::command]
pub fn rebuild_company_scores(app: tauri::AppHandle) -> Result<CompanyScoreRebuildResult, String> {
    mutations::rebuild_company_scores(app)
}

#[tauri::command]
pub fn set_job_review_state(
    app: tauri::AppHandle,
    encrypt_job_id: String,
    review_status: Option<String>,
    communication_status: Option<String>,
    last_greeted_at: Option<String>,
    notes: Option<String>,
) -> Result<(), String> {
    mutations::set_job_review_state(
        app,
        encrypt_job_id,
        review_status,
        communication_status,
        last_greeted_at,
        notes,
    )
}

#[tauri::command]
pub fn set_job_review_notes(
    app: tauri::AppHandle,
    encrypt_job_id: String,
    notes: Option<String>,
) -> Result<(), String> {
    mutations::set_job_review_notes(app, encrypt_job_id, notes)
}

#[tauri::command]
pub fn set_company_review_state(
    app: tauri::AppHandle,
    company_name: String,
    review_status: String,
    notes: Option<String>,
) -> Result<(), String> {
    mutations::set_company_review_state(app, company_name, review_status, notes)
}

#[tauri::command]
pub fn add_company_blacklist(
    app: tauri::AppHandle,
    company_name: String,
    reason: Option<String>,
) -> Result<(), String> {
    mutations::add_company_blacklist(app, company_name, reason)
}

#[tauri::command]
pub fn add_job_blacklist(
    app: tauri::AppHandle,
    encrypt_job_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    mutations::add_job_blacklist(app, encrypt_job_id, reason)
}

#[tauri::command]
pub fn add_keyword_blacklist(
    app: tauri::AppHandle,
    keyword: String,
    reason: Option<String>,
) -> Result<(), String> {
    mutations::add_keyword_blacklist(app, keyword, reason)
}

#[tauri::command]
pub fn delete_job_blacklist(app: tauri::AppHandle, blacklist_id: i64) -> Result<(), String> {
    mutations::delete_job_blacklist(app, blacklist_id)
}

#[cfg(test)]
mod tests {}
