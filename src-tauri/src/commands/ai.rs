mod company_score;
mod config;
mod greeting;
mod models;
mod post_collection_judge;
mod report_meta;
mod reports;
mod shared;
mod worker;

use serde_json::Value;

pub use models::ModelInfo;
pub use report_meta::AiReportMeta;

pub(in crate::commands) fn resolve_effective_openai_base_url(
    saved_settings: Option<&crate::settings::AppSettings>,
    base_url: Option<String>,
) -> String {
    config::resolve_openai_request(
        saved_settings,
        config::OpenAiOverrides {
            base_url,
            ..config::OpenAiOverrides::default()
        },
    )
    .effective_base_url
}

#[tauri::command]
pub async fn generate_greeting_message(
    app: tauri::AppHandle,
    encrypt_job_id: String,
    resume_text: Option<String>,
    context_text: Option<String>,
    resume_files: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: Option<bool>,
) -> Result<Value, String> {
    greeting::generate_greeting_message(
        app,
        encrypt_job_id,
        resume_text,
        context_text,
        resume_files,
        api_key,
        base_url,
        model,
        api_mode,
        debug,
    )
    .await
}

#[tauri::command]
pub async fn generate_ai_company_scores(
    app: tauri::AppHandle,
    limit: Option<u32>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: Option<bool>,
) -> Result<Value, String> {
    company_score::generate_ai_company_scores(app, limit, api_key, base_url, model, api_mode, debug)
        .await
}

#[tauri::command]
pub async fn recompute_ai_post_collection_judgement(
    app: tauri::AppHandle,
    job_ids: Option<Vec<String>>,
    limit: Option<u32>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: Option<bool>,
) -> Result<Value, String> {
    post_collection_judge::recompute_ai_post_collection_judgement(
        app, job_ids, limit, api_key, base_url, model, api_mode, debug,
    )
    .await
}

#[tauri::command]
pub fn list_ai_reports(
    app: tauri::AppHandle,
    limit: Option<u32>,
    offset: Option<u32>,
    kind: Option<String>,
    query: Option<String>,
) -> Result<Vec<AiReportMeta>, String> {
    reports::list_ai_reports(app, limit, offset, kind, query)
}

#[tauri::command]
pub fn clear_ai_reports(app: tauri::AppHandle) -> Result<u64, String> {
    reports::clear_ai_reports(app)
}

#[tauri::command]
pub fn get_ai_report(app: tauri::AppHandle, id: i64) -> Result<Value, String> {
    reports::get_ai_report(app, id)
}

#[tauri::command]
pub fn list_models(
    app: tauri::AppHandle,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    models::list_models(app, api_key, base_url)
}
