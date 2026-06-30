use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    db,
    ipc::protocol::{AiOptimizeResumeForJobPayload, CommandIn},
    paths, resume_library, settings,
};

use super::{
    config::{opt_trimmed, resolve_openai_request, OpenAiOverrides},
    shared::{load_job_ai_context, load_job_detail_raw},
    worker::run_worker_command,
};

pub async fn generate_optimized_resume_for_job(
    app: AppHandle,
    encrypt_job_id: String,
    resume_id: Option<String>,
    context_text: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_generate_optimized_resume_for_job(
            app,
            encrypt_job_id,
            resume_id,
            context_text,
            api_key,
            base_url,
            model,
            api_mode,
            debug == Some(true),
        )
    })
    .await
    .map_err(|e| format!("岗位版简历生成任务异常退出：{e}"))?
}

fn run_generate_optimized_resume_for_job(
    app: AppHandle,
    encrypt_job_id: String,
    resume_id: Option<String>,
    context_text: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: bool,
) -> Result<Value, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let saved_settings = settings::read_settings(&app_data_dir).ok();
    let config = resolve_openai_request(
        saved_settings.as_ref(),
        OpenAiOverrides {
            api_key,
            base_url,
            model,
            api_mode,
            temperature: None,
        },
    );
    let resolved_context_text = opt_trimmed(context_text).or_else(|| {
        saved_settings
            .as_ref()
            .and_then(|settings| opt_trimmed(Some(settings.ai_context_text.clone())))
    });

    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    let job_detail_raw = load_job_detail_raw(&conn, &encrypt_job_id)
        .map_err(|_| "未找到职位，无法生成岗位版简历。".to_string())?;
    let job_detail = serde_json::from_str(&job_detail_raw).unwrap_or(Value::Null);
    let job_context = load_job_ai_context(&conn, &encrypt_job_id)?;
    let source_resume =
        resolve_source_resume(&app_data_dir, &encrypt_job_id, resume_id.as_deref())?;
    let command = CommandIn::AiOptimizeResumeForJob(AiOptimizeResumeForJobPayload {
        resume_text: source_resume.body.clone(),
        job_detail,
        context_text: resolved_context_text,
        filter_reason: job_context.filter_reason,
        score_reason: job_context.score_reason,
        source_context: job_context.source_context,
        review_context: job_context.review_context,
    });

    let mut result = run_worker_command(&app, &app_data_dir, command, &config, debug)?;
    if let Some(object) = result.as_object_mut() {
        object.insert(
            "source_resume".to_string(),
            json!({
                "id": source_resume.id,
                "title": source_resume.title,
            }),
        );
    }
    Ok(result)
}

fn resolve_source_resume(
    app_data_dir: &std::path::Path,
    encrypt_job_id: &str,
    resume_id: Option<&str>,
) -> Result<resume_library::ResolvedResume, String> {
    if let Some(resume_id) = resume_id.map(str::trim).filter(|value| !value.is_empty()) {
        return resume_library::resolve_resume_text_by_id(app_data_dir, resume_id)?
            .ok_or_else(|| "未找到这份简历，无法生成岗位版简历。".to_string());
    }

    resume_library::resolve_resume_text_for_job(app_data_dir, encrypt_job_id)?
        .ok_or_else(|| "请先在简历库为该岗位关联简历，或设置一份默认简历。".to_string())
}

#[cfg(test)]
mod tests {
    use super::resolve_source_resume;
    use crate::resume_library;

    #[test]
    fn source_resume_prefers_explicit_resume_id() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let first =
            resume_library::create_resume(tmp.path(), "默认", "# Default").expect("default");
        let default_id = first.selected_resume.expect("selected").id;
        let second =
            resume_library::create_resume(tmp.path(), "显式", "# Explicit").expect("explicit");
        let explicit_id = second.selected_resume.expect("selected").id;
        resume_library::set_default_resume(tmp.path(), Some(&default_id)).expect("set default");
        resume_library::link_resume_to_jobs(tmp.path(), &default_id, vec!["job-1".to_string()])
            .expect("link");

        let resolved = resolve_source_resume(tmp.path(), "job-1", Some(&explicit_id))
            .expect("resolve explicit");

        assert_eq!(resolved.id, explicit_id);
        assert_eq!(resolved.body, "# Explicit");
    }

    #[test]
    fn source_resume_falls_back_to_link_then_default() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let default = resume_library::create_resume(tmp.path(), "默认", "# Default")
            .expect("default")
            .selected_resume
            .expect("selected")
            .id;
        let linked = resume_library::create_resume(tmp.path(), "关联", "# Linked")
            .expect("linked")
            .selected_resume
            .expect("selected")
            .id;
        resume_library::set_default_resume(tmp.path(), Some(&default)).expect("set default");
        resume_library::link_resume_to_jobs(tmp.path(), &linked, vec!["job-1".to_string()])
            .expect("link");

        let linked_resume =
            resolve_source_resume(tmp.path(), "job-1", None).expect("resolve linked");
        let default_resume =
            resolve_source_resume(tmp.path(), "job-2", None).expect("resolve default");

        assert_eq!(linked_resume.id, linked);
        assert_eq!(default_resume.id, default);
    }

    #[test]
    fn source_resume_errors_without_available_resume() {
        let tmp = tempfile::tempdir().expect("tempdir");

        let err = resolve_source_resume(tmp.path(), "job-1", None).expect_err("missing resume");

        assert!(err.contains("请先在简历库"));
    }
}
