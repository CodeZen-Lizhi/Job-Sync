mod company_score;
mod config;
mod greeting;
mod models;
mod optimized_resume;
mod post_collection_judge;
mod shared;
mod worker;

use serde_json::Value;

pub use models::ModelInfo;

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
pub async fn generate_optimized_resume_for_job(
    app: tauri::AppHandle,
    encrypt_job_id: String,
    resume_id: Option<String>,
    context_text: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: Option<bool>,
) -> Result<Value, String> {
    optimized_resume::generate_optimized_resume_for_job(
        app,
        encrypt_job_id,
        resume_id,
        context_text,
        api_key,
        base_url,
        model,
        api_mode,
        debug,
    )
    .await
}

#[tauri::command]
pub fn list_models(
    app: tauri::AppHandle,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    models::list_models(app, api_key, base_url)
}
