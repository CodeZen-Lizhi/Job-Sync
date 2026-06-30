use rusqlite::OptionalExtension;
use serde_json::Value;
use tauri::AppHandle;

use crate::{
    db,
    ipc::protocol::{AiGreetingPayload, CommandIn},
    paths, resume_library, resume_text, settings,
};

use super::{
    config::{opt_trimmed, resolve_openai_request, OpenAiOverrides},
    shared::{load_job_ai_context, load_job_detail_raw},
    worker::run_worker_command,
};

const GREETING_ALLOWED_REVIEW_STATUSES: &[&str] = &["ready_to_apply", "applied"];

pub async fn generate_greeting_message(
    app: AppHandle,
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
    tauri::async_runtime::spawn_blocking(move || {
        run_generate_greeting(
            app,
            encrypt_job_id,
            resume_text,
            context_text,
            resume_files,
            api_key,
            base_url,
            model,
            api_mode,
            debug == Some(true),
        )
    })
    .await
    .map_err(|e| format!("AI 打招呼文案任务异常退出：{e}"))?
}

fn run_generate_greeting(
    app: AppHandle,
    encrypt_job_id: String,
    resume_text: Option<String>,
    context_text: Option<String>,
    resume_files: Option<String>,
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

    let explicit_resume_text = opt_trimmed(resume_text);
    let explicit_resume_files = opt_trimmed(resume_files);
    let resolved_context_text = opt_trimmed(context_text).or_else(|| {
        saved_settings
            .as_ref()
            .and_then(|settings| opt_trimmed(Some(settings.ai_context_text.clone())))
    });
    let greeting_prompt_extra = saved_settings
        .as_ref()
        .and_then(|settings| opt_trimmed(Some(settings.ai_greeting_prompt_extra.clone())));

    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    ensure_greeting_allowed_review_status(&conn, &encrypt_job_id)?;
    let job_detail_raw = load_job_detail_raw(&conn, &encrypt_job_id)?;
    let job_detail = serde_json::from_str(&job_detail_raw).unwrap_or(Value::Null);
    let match_report = load_latest_resume_match_report(&conn, &encrypt_job_id)?;
    let (resume_text_source, resolved_resume_files) = if explicit_resume_text.is_some()
        || explicit_resume_files.is_some()
    {
        (explicit_resume_text, explicit_resume_files)
    } else {
        let resolved = resume_library::resolve_resume_text_for_job(&app_data_dir, &encrypt_job_id)?;
        (resolved.map(|resume| resume.body), None)
    };
    let resolved_resume_text = match (
        resume_text_source,
        resolved_resume_files.as_deref(),
        match_report.as_ref(),
    ) {
        (Some(text), files, _) => Some(resume_text::resolve_resume_text(&text, files)?),
        (None, Some(files), _) => Some(resume_text::resolve_resume_text("", Some(files))?),
        (None, None, _)
            if has_greeting_candidate_fallback(
                resolved_context_text.as_deref(),
                match_report.as_ref(),
            ) =>
        {
            None
        }
        (None, None, _) => {
            return Err("请先在简历库为该岗位关联简历，或手工设置一份默认简历。".to_string());
        }
    };

    ensure_greeting_has_candidate_context(
        resolved_resume_text.as_deref(),
        resolved_context_text.as_deref(),
        match_report.as_ref(),
    )?;
    let job_context = load_job_ai_context(&conn, &encrypt_job_id)?;
    let command = CommandIn::AiGreeting(AiGreetingPayload {
        resume_text: resolved_resume_text,
        context_text: resolved_context_text,
        resume_files: resolved_resume_files,
        greeting_prompt_extra,
        job_detail,
        match_report,
        filter_reason: job_context.filter_reason,
        score_reason: job_context.score_reason,
        source_context: job_context.source_context,
        review_context: job_context.review_context,
    });

    run_worker_command(&app, &app_data_dir, command, &config, debug)
}

fn has_greeting_candidate_fallback(
    context_text: Option<&str>,
    match_report: Option<&Value>,
) -> bool {
    context_text
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
        || match_report.map(is_non_empty_match_report).unwrap_or(false)
}

fn is_non_empty_match_report(report: &Value) -> bool {
    report
        .as_object()
        .map(|object| !object.is_empty())
        .unwrap_or(false)
}

fn ensure_greeting_allowed_review_status(
    conn: &rusqlite::Connection,
    encrypt_job_id: &str,
) -> Result<(), String> {
    let review_status: Option<String> = conn
        .query_row(
            r#"
      SELECT COALESCE(rs.review_status, 'pending')
      FROM job j
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      WHERE j.encrypt_job_id = ?1
      LIMIT 1
      "#,
            [encrypt_job_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let status = review_status.ok_or_else(|| "未找到职位，无法生成打招呼草稿。".to_string())?;
    if GREETING_ALLOWED_REVIEW_STATUSES.contains(&status.as_str()) {
        return Ok(());
    }

    Err("请先人工确认岗位并标记为准备投递，再生成打招呼草稿。".to_string())
}

fn load_latest_resume_match_report(
    conn: &rusqlite::Connection,
    encrypt_job_id: &str,
) -> Result<Option<Value>, String> {
    let raw: Option<String> = conn
        .query_row(
            r#"
      SELECT result_json
      FROM ai_report
      WHERE encrypt_job_id = ?1
        AND (kind = 'resume' OR kind IS NULL)
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      "#,
            [encrypt_job_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    raw.map(|value| serde_json::from_str(&value).map_err(|e| e.to_string()))
        .transpose()
}

fn ensure_greeting_has_candidate_context(
    resume_text: Option<&str>,
    context_text: Option<&str>,
    match_report: Option<&Value>,
) -> Result<(), String> {
    let has_resume_text = resume_text
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    let has_context_text = context_text
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    let has_match_report = match_report
        .filter(|value| !value.is_null())
        .and_then(|value| value.as_object())
        .map(|object| !object.is_empty())
        .unwrap_or(false);

    if has_resume_text || has_context_text || has_match_report {
        return Ok(());
    }

    Err("请先提供简历或当前情况说明，或先为该岗位生成简历匹配报告，再生成打招呼草稿。".to_string())
}

#[cfg(test)]
mod tests {
    use super::super::shared::load_job_ai_context;
    use super::{
        ensure_greeting_allowed_review_status, ensure_greeting_has_candidate_context,
        has_greeting_candidate_fallback, is_non_empty_match_report,
    };
    use crate::db::{self, models};
    use rusqlite::params;
    use serde_json::json;

    #[test]
    fn load_job_ai_context_includes_filter_score_source_and_review_reasons() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        conn.execute(
            r#"
      INSERT INTO job (
        encrypt_job_id,
        position_name,
        boss_name,
        brand_name,
        city_name,
        salary_desc,
        experience_name,
        degree_name,
        last_seen_at
      )
      VALUES (?1, 'Boss', 'Boss', ?2, '北京', '20-40K', '3-5 年', '本科', '2026-06-13T00:00:00Z')
      "#,
            params!["job_greeting_context", "Greeting Co"],
        )
        .expect("seed job");

        models::upsert_job_filter_result(
            &conn,
            "job_greeting_context",
            models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({
              "eligible": true,
              "matched_preferences": ["Go", "Kubernetes"],
              "missing_preferences": ["AWS"]
            }),
        )
        .expect("seed filter");

        conn.execute(
            r#"
      INSERT INTO company_score (
        company_name,
        company_score,
        risk_flags_json,
        evidence_json,
        source_text_len,
        updated_at
      )
      VALUES (?1, 74.5, ?2, ?3, 128, '2026-06-13T00:00:00Z')
      "#,
            params![
                "Greeting Co",
                serde_json::to_string(&json!(["outsourcing_risk", "onsite_risk"]))
                    .expect("risk json"),
                serde_json::to_string(&json!([
                    "职位信息出现外包相关描述: 外包",
                    "职位信息出现驻场要求: 驻场"
                ]))
                .expect("evidence json"),
            ],
        )
        .expect("seed company score");

        conn.execute(
            r#"
      INSERT INTO ai_report (
        encrypt_job_id,
        resume_hash,
        job_hash,
        kind,
        title,
        match_score,
        jobs_count,
        result_json,
        created_at
      )
      VALUES (?1, 'resume_hash', 'job_hash', 'resume', 'resume', 88.0, 1, ?2, '2026-06-13T00:00:00Z')
      "#,
            params![
                "job_greeting_context",
                json!({
                  "resume_match_score": 88,
                  "matched_stack": ["Go", "Kubernetes", "Prometheus"],
                  "matched_direction": ["Infra", "SRE"],
                  "matched_resume_evidence": ["候选人建设过 Kubernetes 多集群发布平台"],
                  "experience_fit": "3-5年",
                  "missing_points": ["AWS 未明确"],
                  "confidence": 0.86
                })
                .to_string()
            ],
        )
        .expect("seed resume report");

        conn.execute(
            r#"
      INSERT INTO filter_profile (id, name, profile_json, is_default, updated_at)
      VALUES (
        'default',
        '默认筛选画像',
        ?1,
        1,
        '2026-06-13T00:00:00Z'
      )
      ON CONFLICT(id) DO UPDATE SET
        profile_json = excluded.profile_json,
        is_default = excluded.is_default,
        updated_at = excluded.updated_at
      "#,
            params![json!({
              "scoreWeights": {
                "resume": 0.5,
                "preference": 0.3,
                "company": 0.2
              },
              "sourcePlatforms": ["boss"]
            })
            .to_string()],
        )
        .expect("seed filter profile");

        let context =
            load_job_ai_context(&conn, "job_greeting_context").expect("load review context");

        let filter_reason = context.filter_reason.expect("filter reason");
        assert_eq!(filter_reason["matched_preferences"][0], "Go");
        assert_eq!(filter_reason["missing_preferences"][0], "AWS");

        let score_reason = context.score_reason.expect("score reason");
        assert_eq!(score_reason["weights"]["resume"], 0.5);
        assert_eq!(score_reason["weights"]["preference"], 0.3);
        assert_eq!(score_reason["weights"]["company"], 0.2);
        assert_eq!(score_reason["resume_match_score"], 88.0);
        assert_eq!(score_reason["resume"]["matched_stack"][0], "Go");
        assert_eq!(score_reason["resume"]["matched_direction"][0], "Infra");
        assert_eq!(
            score_reason["resume"]["matched_resume_evidence"][0],
            "候选人建设过 Kubernetes 多集群发布平台"
        );
        assert_eq!(score_reason["preference"]["matched"][0], "Go");
        assert_eq!(score_reason["preference"]["missing"][0], "AWS");
        assert_eq!(score_reason["company"]["company_score"], 74.5);
        assert_eq!(score_reason["company"]["risk_flags"][0], "outsourcing_risk");
        assert_eq!(
            score_reason["company"]["evidence"][0],
            "职位信息出现外包相关描述: 外包"
        );

        let source_context = context.source_context.expect("source context");
        assert_eq!(source_context["source_platform"], "boss");
        assert_eq!(
            source_context["default_profile"]["allowed_source_platforms"][0],
            "boss"
        );

        let review_context = context.review_context.expect("review context");
        assert_eq!(review_context["review_status"], "pending");
        assert_eq!(review_context["communication_status"], "not_contacted");
    }

    #[test]
    fn greeting_requires_candidate_context_or_match_report() {
        let empty = ensure_greeting_has_candidate_context(None, None, None);
        assert!(empty.is_err());
        assert!(empty
            .err()
            .expect("empty context error")
            .contains("简历匹配报告"));

        ensure_greeting_has_candidate_context(Some("Kubernetes 平台项目"), None, None)
            .expect("resume text allowed");
        ensure_greeting_has_candidate_context(None, Some("当前主攻 Go / SRE 岗位"), None)
            .expect("context text allowed");
        ensure_greeting_has_candidate_context(
            None,
            None,
            Some(&json!({ "matchScore": 82, "strengths": ["Go"] })),
        )
        .expect("match report allowed");
    }

    #[test]
    fn greeting_treats_non_empty_match_report_as_resume_fallback() {
        assert!(has_greeting_candidate_fallback(
            Some("当前主攻 Go / SRE 岗位"),
            None
        ));
        assert!(has_greeting_candidate_fallback(
            None,
            Some(&json!({
                "matchScore": 82,
                "matched_stack": ["Go"]
            }))
        ));
        assert!(!has_greeting_candidate_fallback(None, Some(&json!({}))));
        assert!(!has_greeting_candidate_fallback(Some("  "), None));
        assert!(is_non_empty_match_report(&json!({
            "matchScore": 82,
            "matched_stack": ["Go"]
        })));
        assert!(!is_non_empty_match_report(&json!({})));
        assert!(!is_non_empty_match_report(&json!(null)));
    }

    #[test]
    fn greeting_requires_manual_ready_to_apply_review_status() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        for job_id in ["job_pending", "job_ready", "job_applied"] {
            conn.execute(
        r#"
        INSERT INTO job (
          encrypt_job_id,
          position_name,
          boss_name,
          brand_name,
          city_name,
          salary_desc,
          experience_name,
          degree_name,
          last_seen_at
        )
        VALUES (?1, 'Go SRE 工程师', 'Boss', 'Greeting Co', '北京', '20-40K', '3-5 年', '本科', '2026-06-13T00:00:00Z')
        "#,
        params![job_id],
      )
      .expect("seed job");
        }

        models::upsert_job_review_state(
            &conn,
            "job_ready",
            Some("ready_to_apply"),
            None,
            None,
            None,
        )
        .expect("seed ready state");
        models::upsert_job_review_state(&conn, "job_applied", Some("applied"), None, None, None)
            .expect("seed applied state");

        let pending = ensure_greeting_allowed_review_status(&conn, "job_pending");
        assert!(pending.is_err());
        assert!(pending.err().expect("pending error").contains("准备投递"));
        ensure_greeting_allowed_review_status(&conn, "job_ready").expect("ready allowed");
        ensure_greeting_allowed_review_status(&conn, "job_applied").expect("applied allowed");
    }
}
