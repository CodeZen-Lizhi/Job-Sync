use std::{path::Path, thread, time::Duration};

use serde_json::json;

use crate::{paths, settings, storage};

const TELEGRAM_SEND_MAX_ATTEMPTS: usize = 4;
const TELEGRAM_RETRY_INITIAL_DELAY_MS: u64 = 600;
const TELEGRAM_RETRY_MAX_DELAY_MS: u64 = 8_000;

#[derive(Clone, Copy)]
struct TelegramSendRetryPolicy {
    max_attempts: usize,
    initial_delay: Duration,
}

impl Default for TelegramSendRetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: TELEGRAM_SEND_MAX_ATTEMPTS,
            initial_delay: Duration::from_millis(TELEGRAM_RETRY_INITIAL_DELAY_MS),
        }
    }
}

enum TelegramSendAttemptError {
    Retryable(String),
    Permanent(String),
}

#[derive(Debug, serde::Serialize)]
pub struct PublicAppSettings {
    pub browser_executable_path: Option<String>,
    pub openai_api_key: Option<String>,
    pub has_openai_api_key: bool,
    pub openai_provider: Option<String>,
    pub openai_base_url: Option<String>,
    pub openai_model: Option<String>,
    pub openai_api_mode: Option<String>,
    pub openai_temperature: Option<f64>,
    pub openai_prompt_extra: String,
    pub openai_schema_extra: String,
    pub ai_greeting_prompt_extra: String,
    pub telegram_bot_token: Option<String>,
    pub has_telegram_bot_token: bool,
    pub telegram_chat_id: Option<String>,
    pub has_telegram_chat_id: bool,
    pub proxy_url: Option<String>,
    pub collection_config: Option<serde_json::Value>,
    pub ai_resume_text: String,
    pub ai_context_text: String,
    pub ai_resume_files: String,
    pub ai_profile_updated_at: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct BossSessionDiagnostic {
    pub status: String,
    pub checked_at: String,
    pub message: String,
    pub ready: bool,
    pub cookies_present: bool,
    pub cookies_valid_json: bool,
    pub local_storage_present: bool,
    pub local_storage_valid_json: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct ModelServiceDiagnostic {
    pub status: String,
    pub checked_at: String,
    pub message: String,
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub model_count: Option<usize>,
    pub model_sample: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct TelegramDiagnostic {
    pub status: String,
    pub checked_at: String,
    pub message: String,
    pub has_bot_token: bool,
    pub bot_token_valid: bool,
    pub has_chat_id: bool,
    pub chat_id_valid: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct ExternalDependencyDiagnostics {
    pub checked_at: String,
    pub boss_session: BossSessionDiagnostic,
    pub model_service: ModelServiceDiagnostic,
    pub telegram: TelegramDiagnostic,
}

impl From<settings::AppSettings> for PublicAppSettings {
    fn from(settings: settings::AppSettings) -> Self {
        let has_openai_api_key = settings
            .openai_api_key
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        let has_telegram_bot_token = settings
            .telegram_bot_token
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        let has_telegram_chat_id = settings
            .telegram_chat_id
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());

        Self {
            browser_executable_path: settings.browser_executable_path,
            openai_api_key: None,
            has_openai_api_key,
            openai_provider: settings.openai_provider,
            openai_base_url: settings.openai_base_url,
            openai_model: settings.openai_model,
            openai_api_mode: settings.openai_api_mode,
            openai_temperature: settings.openai_temperature,
            openai_prompt_extra: settings.openai_prompt_extra,
            openai_schema_extra: settings.openai_schema_extra,
            ai_greeting_prompt_extra: settings.ai_greeting_prompt_extra,
            telegram_bot_token: None,
            has_telegram_bot_token,
            telegram_chat_id: None,
            has_telegram_chat_id,
            proxy_url: settings.proxy_url,
            collection_config: settings.collection_config,
            ai_resume_text: settings.ai_resume_text,
            ai_context_text: settings.ai_context_text,
            ai_resume_files: settings.ai_resume_files,
            ai_profile_updated_at: settings.ai_profile_updated_at,
        }
    }
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Result<PublicAppSettings, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;

    settings::read_settings(&app_data_dir)
        .map(PublicAppSettings::from)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn diagnose_external_dependencies(
    app: tauri::AppHandle,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<ExternalDependencyDiagnostics, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let saved_settings = settings::read_settings(&app_data_dir)
        .unwrap_or_else(|_| settings::AppSettings::platform_default());
    let checked_at = now_rfc3339();

    Ok(ExternalDependencyDiagnostics {
        checked_at: checked_at.clone(),
        boss_session: diagnose_boss_session(&app_data_dir, &checked_at),
        model_service: diagnose_model_service(app, &saved_settings, api_key, base_url, &checked_at),
        telegram: diagnose_telegram(&saved_settings, &checked_at),
    })
}

#[tauri::command]
pub fn set_browser_executable_path(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<PublicAppSettings, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;

    let mut current = settings::read_settings(&app_data_dir)
        .unwrap_or_else(|_| settings::AppSettings::platform_default());
    current.browser_executable_path = path.and_then(|p| {
        let trimmed = p.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    settings::write_settings(&app_data_dir, &current).map_err(|e| e.to_string())?;
    Ok(PublicAppSettings::from(current))
}

#[tauri::command]
pub fn set_ai_settings(
    app: tauri::AppHandle,
    resume_text: String,
    context_text: Option<String>,
    resume_files: Option<String>,
) -> Result<PublicAppSettings, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;

    let mut current = settings::read_settings(&app_data_dir)
        .unwrap_or_else(|_| settings::AppSettings::platform_default());

    current.ai_resume_text = resume_text;
    current.ai_context_text = context_text.unwrap_or_default();
    current.ai_resume_files = resume_files.unwrap_or_default();
    current.ai_profile_updated_at = Some(
        time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap(),
    );

    settings::write_settings(&app_data_dir, &current).map_err(|e| e.to_string())?;
    Ok(PublicAppSettings::from(current))
}

#[tauri::command]
pub fn save_collection_config(
    app: tauri::AppHandle,
    collection_config: serde_json::Value,
) -> Result<PublicAppSettings, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;

    let mut current = settings::read_settings(&app_data_dir)
        .unwrap_or_else(|_| settings::AppSettings::platform_default());
    current.collection_config = if collection_config.is_null() {
        None
    } else {
        Some(collection_config)
    };

    settings::write_settings(&app_data_dir, &current).map_err(|e| e.to_string())?;
    Ok(PublicAppSettings::from(current))
}

fn opt_trimmed(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn json_file_status(path: &Path) -> (bool, bool) {
    let present = path.is_file();
    let valid_json = if present {
        matches!(storage::read_json(path), Ok(Some(_)))
    } else {
        false
    };
    (present, valid_json)
}

fn diagnose_boss_session(app_data_dir: &Path, checked_at: &str) -> BossSessionDiagnostic {
    let (cookies_present, cookies_valid_json) =
        json_file_status(&storage::boss_cookies_path(app_data_dir));
    let (local_storage_present, local_storage_valid_json) =
        json_file_status(&storage::boss_local_storage_path(app_data_dir));
    let ready = cookies_valid_json && local_storage_valid_json;
    let status = if ready { "ok" } else { "warning" }.to_string();
    let message = if ready {
        "Boss Cookie 快照可用；自动采集仍优先复用持久浏览器 profile。"
    } else if !cookies_present && !local_storage_present {
        "尚未发现 Boss Cookie 快照；自动采集会打开持久浏览器 profile，如未登录会等待你人工登录/验证。"
    } else if !cookies_valid_json || !local_storage_valid_json {
        "Boss Cookie 快照不完整或不可解析；自动采集仍会复用持久浏览器 profile，并在需要时等待人工登录/验证。"
    } else {
        "Boss Cookie 快照不完整；自动采集仍会复用持久浏览器 profile，并在需要时等待人工登录/验证。"
    }
    .to_string();

    BossSessionDiagnostic {
        status,
        checked_at: checked_at.to_string(),
        message,
        ready,
        cookies_present,
        cookies_valid_json,
        local_storage_present,
        local_storage_valid_json,
    }
}

fn diagnose_model_service(
    app: tauri::AppHandle,
    saved_settings: &settings::AppSettings,
    api_key: Option<String>,
    base_url: Option<String>,
    checked_at: &str,
) -> ModelServiceDiagnostic {
    let provider = opt_trimmed(saved_settings.openai_provider.clone());
    let effective_base_url = Some(crate::commands::ai::resolve_effective_openai_base_url(
        Some(saved_settings),
        base_url.clone(),
    ));

    match crate::commands::ai::list_models(app, api_key, base_url) {
        Ok(models) => {
            let model_count = models.len();
            let model_sample = models.into_iter().take(5).map(|model| model.id).collect();
            ModelServiceDiagnostic {
                status: "ok".to_string(),
                checked_at: checked_at.to_string(),
                message: format!("模型服务可访问，已读取 {model_count} 个模型。"),
                provider,
                base_url: effective_base_url,
                model_count: Some(model_count),
                model_sample,
            }
        }
        Err(message) => ModelServiceDiagnostic {
            status: "error".to_string(),
            checked_at: checked_at.to_string(),
            message,
            provider,
            base_url: effective_base_url,
            model_count: None,
            model_sample: Vec::new(),
        },
    }
}

fn diagnose_telegram(settings: &settings::AppSettings, checked_at: &str) -> TelegramDiagnostic {
    let bot_token = opt_trimmed(settings.telegram_bot_token.clone());
    let chat_id = opt_trimmed(settings.telegram_chat_id.clone());
    let has_bot_token = bot_token.is_some();
    let has_chat_id = chat_id.is_some();
    let bot_token_valid = bot_token.as_deref().is_some_and(|value| {
        let mut parts = value.splitn(2, ':');
        parts.next().is_some_and(|head| !head.trim().is_empty())
            && parts.next().is_some_and(|tail| !tail.trim().is_empty())
    });
    let chat_id_valid = chat_id
        .as_deref()
        .is_some_and(|value| value.parse::<i64>().is_ok() || value.starts_with('@'));
    let status = if bot_token_valid && chat_id_valid {
        "ok"
    } else {
        "warning"
    }
    .to_string();
    let message = if bot_token_valid && chat_id_valid {
        "Telegram 配置已保存；AI 采后判断完成后会自动推送摘要。"
    } else if has_bot_token || has_chat_id {
        "Telegram 配置已保存但 bot token 或 chat id 格式需要检查。"
    } else {
        "尚未保存 Telegram 配置；AI 采后判断不会自动推送。"
    }
    .to_string();

    TelegramDiagnostic {
        status,
        checked_at: checked_at.to_string(),
        message,
        has_bot_token,
        bot_token_valid,
        has_chat_id,
        chat_id_valid,
    }
}

fn clamp_temperature(value: Option<f64>) -> Option<f64> {
    value.and_then(|v| {
        if v.is_finite() {
            Some(v.clamp(0.0, 2.0))
        } else {
            None
        }
    })
}

fn telegram_bot_api_base(token: &str) -> String {
    format!("https://api.telegram.org/bot{token}")
}

fn telegram_agent(settings: &settings::AppSettings) -> Result<ureq::Agent, String> {
    let mut builder = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(10));
    if let Some(proxy_url) = opt_trimmed(settings.proxy_url.clone()) {
        let proxy = ureq::Proxy::new(&proxy_url)
            .map_err(|err| format!("Telegram 代理配置不正确，请检查代理地址：{err}"))?;
        builder = builder.proxy(proxy);
    }
    Ok(builder.build())
}

pub(crate) fn telegram_message_is_valid(token: &str, chat_id: &str) -> bool {
    let token = token.trim();
    let chat_id = chat_id.trim();
    let mut parts = token.splitn(2, ':');
    let token_ok = parts.next().is_some_and(|head| !head.trim().is_empty())
        && parts.next().is_some_and(|tail| !tail.trim().is_empty());
    let chat_id_ok = chat_id.parse::<i64>().is_ok() || chat_id.starts_with('@');
    token_ok && chat_id_ok
}

pub(crate) fn send_telegram_message_from_settings(
    settings: &settings::AppSettings,
    content: &str,
) -> Result<(), String> {
    send_telegram_message_from_settings_with_format(settings, content, None)
}

pub(crate) fn send_telegram_message_from_settings_with_format(
    settings: &settings::AppSettings,
    content: &str,
    parse_mode: Option<&str>,
) -> Result<(), String> {
    send_telegram_message_from_settings_with_policy(
        settings,
        content,
        parse_mode,
        TelegramSendRetryPolicy::default(),
    )
}

fn send_telegram_message_from_settings_with_policy(
    settings: &settings::AppSettings,
    content: &str,
    parse_mode: Option<&str>,
    retry_policy: TelegramSendRetryPolicy,
) -> Result<(), String> {
    let bot_token = settings
        .telegram_bot_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "未配置 Telegram bot token，请先到设置页保存。".to_string())?;
    let chat_id = settings
        .telegram_chat_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "未配置 Telegram chat id，请先到设置页保存。".to_string())?;
    if !telegram_message_is_valid(bot_token, chat_id) {
        return Err("Telegram 配置格式不正确，请检查 bot token 和 chat id。".to_string());
    }

    let mut payload = json!({
        "chat_id": chat_id,
        "text": content,
        "disable_web_page_preview": true,
    });
    if let Some(parse_mode) = parse_mode {
        if !parse_mode.trim().is_empty() {
            payload["parse_mode"] = json!(parse_mode);
        }
    }

    let agent = telegram_agent(settings)?;
    let url = format!("{}/sendMessage", telegram_bot_api_base(bot_token));
    let max_attempts = retry_policy.max_attempts.max(1);
    let mut last_retryable_error = None::<String>;
    for attempt in 1..=max_attempts {
        match send_telegram_message_once(&agent, &url, &payload) {
            Ok(()) => return Ok(()),
            Err(TelegramSendAttemptError::Permanent(err)) => return Err(err),
            Err(TelegramSendAttemptError::Retryable(err)) => {
                last_retryable_error = Some(err);
                if attempt < max_attempts {
                    thread::sleep(telegram_retry_delay(retry_policy.initial_delay, attempt));
                }
            }
        }
    }

    Err(format!(
        "Telegram 通知发送失败（共尝试 {max_attempts} 次仍失败）：{}",
        last_retryable_error.unwrap_or_else(|| "unknown error".to_string())
    ))
}

fn telegram_retry_delay(initial_delay: Duration, failed_attempt: usize) -> Duration {
    let base_ms = initial_delay.as_millis().min(u128::from(u64::MAX)) as u64;
    let multiplier = 1_u64
        .checked_shl(failed_attempt.saturating_sub(1) as u32)
        .unwrap_or(u64::MAX);
    Duration::from_millis(
        base_ms
            .saturating_mul(multiplier)
            .min(TELEGRAM_RETRY_MAX_DELAY_MS),
    )
}

fn send_telegram_message_once(
    agent: &ureq::Agent,
    url: &str,
    payload: &serde_json::Value,
) -> Result<(), TelegramSendAttemptError> {
    let response = agent
        .post(url)
        .set("Content-Type", "application/json")
        .send_json(payload.clone());

    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(status, response)) => {
            let body = response.into_string().unwrap_or_default();
            let message = format!("Telegram 通知发送失败：HTTP {status} {body}");
            if status == 429 || status >= 500 {
                return Err(TelegramSendAttemptError::Retryable(message));
            }
            return Err(TelegramSendAttemptError::Permanent(message));
        }
        Err(err) => {
            return Err(TelegramSendAttemptError::Retryable(format!(
                "Telegram 通知发送失败：{err}"
            )));
        }
    };

    let body: serde_json::Value = response
        .into_json()
        .map_err(|e| TelegramSendAttemptError::Permanent(format!("解析 Telegram 响应失败：{e}")))?;
    let ok = body
        .get("ok")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    if !ok {
        let description = body
            .get("description")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown error");
        let message = format!("Telegram 通知发送失败：{description}");
        let error_code = body
            .get("error_code")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or_default();
        if error_code == 429 || error_code >= 500 {
            return Err(TelegramSendAttemptError::Retryable(message));
        }
        return Err(TelegramSendAttemptError::Permanent(message));
    }

    Ok(())
}

#[tauri::command]
pub fn save_settings(
    app: tauri::AppHandle,
    browser_executable_path: Option<String>,
    openai_provider: Option<String>,
    openai_api_key: Option<String>,
    openai_base_url: Option<String>,
    openai_model: Option<String>,
    openai_api_mode: Option<String>,
    openai_temperature: Option<f64>,
    openai_prompt_extra: Option<String>,
    openai_schema_extra: Option<String>,
    ai_greeting_prompt_extra: Option<String>,
    telegram_bot_token: Option<String>,
    telegram_chat_id: Option<String>,
    proxy_url: Option<String>,
    ai_resume_text: Option<String>,
    ai_context_text: Option<String>,
    ai_resume_files: Option<String>,
) -> Result<PublicAppSettings, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;

    let mut current = settings::read_settings(&app_data_dir)
        .unwrap_or_else(|_| settings::AppSettings::platform_default());

    current.browser_executable_path = opt_trimmed(browser_executable_path);
    current.openai_provider = opt_trimmed(openai_provider);
    if let Some(api_key) = openai_api_key {
        current.openai_api_key = opt_trimmed(Some(api_key));
    }
    current.openai_base_url = opt_trimmed(openai_base_url);
    current.openai_model = opt_trimmed(openai_model);
    current.openai_api_mode = opt_trimmed(openai_api_mode);
    current.openai_temperature = clamp_temperature(openai_temperature);
    if let Some(value) = openai_prompt_extra {
        current.openai_prompt_extra = opt_trimmed(Some(value)).unwrap_or_default();
    }
    if let Some(value) = openai_schema_extra {
        current.openai_schema_extra = opt_trimmed(Some(value)).unwrap_or_default();
    }
    current.ai_greeting_prompt_extra = opt_trimmed(ai_greeting_prompt_extra).unwrap_or_default();
    if let Some(bot_token) = telegram_bot_token {
        current.telegram_bot_token = opt_trimmed(Some(bot_token));
    }
    if let Some(chat_id) = telegram_chat_id {
        current.telegram_chat_id = opt_trimmed(Some(chat_id));
    }
    current.proxy_url = opt_trimmed(proxy_url);
    if let Some(value) = ai_resume_text {
        current.ai_resume_text = value;
    }
    if let Some(value) = ai_context_text {
        current.ai_context_text = value;
    }
    if let Some(value) = ai_resume_files {
        current.ai_resume_files = value;
    }
    if current.ai_resume_text.trim().is_empty() {
        current.ai_resume_text.clear();
    }
    if current.ai_context_text.trim().is_empty() {
        current.ai_context_text.clear();
    }
    if current.ai_resume_files.trim().is_empty() {
        current.ai_resume_files.clear();
    }

    settings::write_settings(&app_data_dir, &current).map_err(|e| e.to_string())?;
    Ok(PublicAppSettings::from(current))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn public_settings_redacts_saved_api_key() {
        let mut settings = settings::AppSettings::platform_default();
        settings.openai_api_key = Some("sk-secret".to_string());
        settings.openai_provider = Some("deepseek".to_string());

        let public = PublicAppSettings::from(settings);

        assert_eq!(public.openai_api_key, None);
        assert!(public.has_openai_api_key);
        assert_eq!(public.openai_provider.as_deref(), Some("deepseek"));
    }

    #[test]
    fn public_settings_redacts_saved_telegram_values() {
        let mut settings = settings::AppSettings::platform_default();
        settings.telegram_bot_token = Some("123:secret".to_string());
        settings.telegram_chat_id = Some("987654321".to_string());

        let public = PublicAppSettings::from(settings);

        assert_eq!(public.telegram_bot_token, None);
        assert_eq!(public.telegram_chat_id, None);
        assert!(public.has_telegram_bot_token);
        assert!(public.has_telegram_chat_id);
    }

    #[test]
    fn public_settings_exposes_saved_proxy_url() {
        let mut settings = settings::AppSettings::platform_default();
        settings.proxy_url = Some("http://127.0.0.1:7890".to_string());

        let public = PublicAppSettings::from(settings);

        assert_eq!(public.proxy_url.as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn public_settings_exposes_collection_config() {
        let mut settings = settings::AppSettings::platform_default();
        settings.collection_config = Some(serde_json::json!({
            "version": 1,
            "selectedCollectionSources": ["boss", "v2ex"]
        }));

        let public = PublicAppSettings::from(settings);

        assert_eq!(
            public
                .collection_config
                .as_ref()
                .and_then(|value| value.get("version"))
                .and_then(|value| value.as_i64()),
            Some(1)
        );
    }

    #[test]
    fn public_settings_exposes_greeting_prompt_extra() {
        let mut settings = settings::AppSettings::platform_default();
        settings.ai_greeting_prompt_extra = "更偏项目成果".to_string();

        let public = PublicAppSettings::from(settings);

        assert_eq!(public.ai_greeting_prompt_extra, "更偏项目成果");
    }

    #[test]
    fn boss_session_diagnostic_requires_cookie_and_local_storage_json() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let checked_at = "2026-06-14T00:00:00Z";

        let empty = diagnose_boss_session(tmp.path(), checked_at);
        assert_eq!(empty.status, "warning");
        assert!(!empty.ready);
        assert!(!empty.cookies_present);
        assert!(!empty.local_storage_present);
        assert!(empty.message.contains("持久浏览器 profile"));
        assert!(empty.message.contains("人工登录/验证"));

        storage::write_json(
            &storage::boss_cookies_path(tmp.path()),
            &serde_json::json!([{"name": "sid"}]),
        )
        .expect("write cookies");
        let partial = diagnose_boss_session(tmp.path(), checked_at);
        assert!(!partial.ready);
        assert!(partial.cookies_present);
        assert!(partial.cookies_valid_json);
        assert!(!partial.local_storage_present);
        assert!(partial.message.contains("持久浏览器 profile"));

        storage::write_json(
            &storage::boss_local_storage_path(tmp.path()),
            &serde_json::json!({"__zp_stoken__": "token"}),
        )
        .expect("write local storage");
        let ready = diagnose_boss_session(tmp.path(), checked_at);
        assert_eq!(ready.status, "ok");
        assert!(ready.ready);
        assert!(ready.local_storage_valid_json);
    }

    #[test]
    fn telegram_diagnostic_reports_saved_values_without_revealing_content() {
        let mut settings = settings::AppSettings::platform_default();
        let checked_at = "2026-06-14T00:00:00Z";

        let empty = diagnose_telegram(&settings, checked_at);
        assert_eq!(empty.status, "warning");
        assert!(!empty.has_bot_token);
        assert!(!empty.has_chat_id);

        settings.telegram_bot_token = Some("123:secret".to_string());
        settings.telegram_chat_id = Some("987654321".to_string());
        let configured = diagnose_telegram(&settings, checked_at);
        assert_eq!(configured.status, "ok");
        assert!(configured.has_bot_token);
        assert!(configured.has_chat_id);
        assert!(configured.bot_token_valid);
        assert!(configured.chat_id_valid);
        assert!(!configured.message.contains("secret"));
    }

    #[test]
    fn telegram_sender_uses_saved_proxy_url() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("proxy listener");
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        let proxy_addr = listener.local_addr().expect("proxy addr");
        let (tx, rx) = mpsc::channel();

        let proxy = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut buffer = [0_u8; 512];
                        let n = stream.read(&mut buffer).unwrap_or_default();
                        let request = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ = tx.send(request);
                        let _ = stream
                            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
                        return;
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            let _ = tx.send(String::new());
                            return;
                        }
                        thread::sleep(Duration::from_millis(20));
                    }
                    Err(_) => {
                        let _ = tx.send(String::new());
                        return;
                    }
                }
            }
        });

        let mut settings = settings::AppSettings::platform_default();
        settings.telegram_bot_token = Some("123:secret".to_string());
        settings.telegram_chat_id = Some("987654321".to_string());
        settings.proxy_url = Some(format!("http://{proxy_addr}"));

        let result = send_telegram_message_from_settings_with_policy(
            &settings,
            "hello",
            Some("HTML"),
            TelegramSendRetryPolicy {
                max_attempts: 1,
                initial_delay: Duration::ZERO,
            },
        );

        assert!(result.is_err());
        let request = rx
            .recv_timeout(Duration::from_secs(6))
            .expect("proxy request");
        proxy.join().expect("proxy thread");
        assert!(
            request.starts_with("CONNECT api.telegram.org:443 "),
            "unexpected proxy request: {request:?}"
        );
    }

    #[test]
    fn telegram_sender_retries_retryable_transport_errors() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("proxy listener");
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        let proxy_addr = listener.local_addr().expect("proxy addr");
        let expected_attempts = 3;
        let (tx, rx) = mpsc::channel();

        let proxy = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut accepted = 0;
            while accepted < expected_attempts {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut buffer = [0_u8; 512];
                        let n = stream.read(&mut buffer).unwrap_or_default();
                        let request = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ = tx.send(request);
                        let _ = stream
                            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
                        accepted += 1;
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            return;
                        }
                        thread::sleep(Duration::from_millis(20));
                    }
                    Err(_) => return,
                }
            }
        });

        let mut settings = settings::AppSettings::platform_default();
        settings.telegram_bot_token = Some("123:secret".to_string());
        settings.telegram_chat_id = Some("987654321".to_string());
        settings.proxy_url = Some(format!("http://{proxy_addr}"));

        let result = send_telegram_message_from_settings_with_policy(
            &settings,
            "hello",
            Some("HTML"),
            TelegramSendRetryPolicy {
                max_attempts: expected_attempts,
                initial_delay: Duration::ZERO,
            },
        );

        assert!(result.is_err());
        let error = result.expect_err("retryable proxy error");
        assert!(
            error.contains("共尝试 3 次仍失败"),
            "unexpected error: {error}"
        );
        let requests = (0..expected_attempts)
            .map(|_| {
                rx.recv_timeout(Duration::from_secs(6))
                    .expect("proxy request")
            })
            .collect::<Vec<_>>();
        proxy.join().expect("proxy thread");
        assert_eq!(requests.len(), expected_attempts);
        assert!(
            requests
                .iter()
                .all(|request| request.starts_with("CONNECT api.telegram.org:443 ")),
            "unexpected proxy requests: {requests:?}"
        );
    }
}
