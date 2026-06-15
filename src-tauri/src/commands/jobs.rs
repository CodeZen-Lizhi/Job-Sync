mod models;
mod mutations;
mod queries;
mod shared;

use std::time::Duration;

use serde_json::{json, Value};

use crate::{paths, settings};

pub use models::{
    CompanyScoreRebuildResult, JobBlacklistEntry, JobCandidatePage, JobDailyIntelligence, JobRow,
    JobSourceEntry, KeywordGroup,
};

#[derive(Debug, serde::Serialize)]
pub struct DailyIntelligenceWebhookResult {
    pub report_date: String,
    pub channel: String,
}

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
    query: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    processed: Option<String>,
    status_filters: Option<Vec<String>>,
    source_platforms: Option<Vec<String>>,
    collection_methods: Option<Vec<String>>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<JobCandidatePage, String> {
    queries::list_job_candidates(
        app,
        query,
        start_date,
        end_date,
        processed,
        status_filters,
        source_platforms,
        collection_methods,
        limit,
        offset,
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
pub fn send_daily_job_intelligence_wecom_notification(
    app: tauri::AppHandle,
    report_date: Option<String>,
) -> Result<DailyIntelligenceWebhookResult, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let saved_settings = settings::read_settings(&app_data_dir).map_err(|e| e.to_string())?;
    let webhook_url = normalize_wecom_webhook_url(saved_settings.wecom_webhook_url)?;
    let summary = queries::get_daily_job_intelligence(app, report_date)?;
    let content = truncate_wecom_text(&summary.notification_brief_text);

    post_wecom_text_webhook(&webhook_url, &content)?;

    Ok(DailyIntelligenceWebhookResult {
        report_date: summary.report_date,
        channel: "wecom".to_string(),
    })
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

fn normalize_wecom_webhook_url(value: Option<String>) -> Result<String, String> {
    let Some(value) = value else {
        return Err("未配置企业微信机器人 Webhook，请先到设置页保存。".to_string());
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("未配置企业微信机器人 Webhook，请先到设置页保存。".to_string());
    }
    if !trimmed.starts_with("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=") {
        return Err(
            "企业微信机器人 Webhook 必须使用 qyapi.weixin.qq.com 的 HTTPS 地址。".to_string(),
        );
    }
    Ok(trimmed.to_string())
}

fn truncate_wecom_text(content: &str) -> String {
    const MAX_CHARS: usize = 1900;
    if content.chars().count() <= MAX_CHARS {
        return content.to_string();
    }

    let mut out = content.chars().take(MAX_CHARS).collect::<String>();
    out.push_str("\n...（内容过长，请打开 Job Sync 查看完整每日岗位情报；不会自动投递。）");
    out
}

fn post_wecom_text_webhook(webhook_url: &str, content: &str) -> Result<(), String> {
    let payload = json!({
        "msgtype": "text",
        "text": {
            "content": content,
        },
    });

    let response = ureq::post(webhook_url)
        .set("Content-Type", "application/json")
        .timeout(Duration::from_secs(10))
        .send_json(payload);

    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            return Err(format!("企业微信通知发送失败：HTTP {status} {body}"));
        }
        Err(err) => {
            return Err(format!("企业微信通知发送失败：{err}"));
        }
    };

    let body: Value = response
        .into_json()
        .map_err(|e| format!("解析企业微信响应失败：{e}"))?;
    let errcode = body.get("errcode").and_then(Value::as_i64).unwrap_or(-1);
    if errcode != 0 {
        let errmsg = body
            .get("errmsg")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        return Err(format!("企业微信通知发送失败：errcode {errcode} {errmsg}"));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_wecom_webhook_accepts_enterprise_wechat_robot_url() {
        let url = normalize_wecom_webhook_url(Some(
            " https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc ".to_string(),
        ))
        .expect("valid wecom webhook");

        assert_eq!(
            url,
            "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc"
        );
    }

    #[test]
    fn normalize_wecom_webhook_rejects_missing_or_non_wecom_url() {
        assert!(normalize_wecom_webhook_url(None).is_err());
        assert!(
            normalize_wecom_webhook_url(Some("https://example.test/hook".to_string())).is_err()
        );
    }

    #[test]
    fn truncate_wecom_text_keeps_manual_boundary_notice() {
        let content = "岗位".repeat(2000);
        let truncated = truncate_wecom_text(&content);

        assert!(truncated.chars().count() < content.chars().count());
        assert!(truncated.contains("不会自动投递"));
    }
}
