use std::path::Path;

use crate::{paths, settings, storage};

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
    pub wecom_webhook_url: Option<String>,
    pub has_wecom_webhook_url: bool,
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
pub struct WecomDiagnostic {
    pub status: String,
    pub checked_at: String,
    pub message: String,
    pub has_webhook_url: bool,
    pub webhook_url_valid: bool,
}

#[derive(Debug, serde::Serialize)]
pub struct ExternalDependencyDiagnostics {
    pub checked_at: String,
    pub boss_session: BossSessionDiagnostic,
    pub model_service: ModelServiceDiagnostic,
    pub wecom: WecomDiagnostic,
}

impl From<settings::AppSettings> for PublicAppSettings {
    fn from(settings: settings::AppSettings) -> Self {
        let has_openai_api_key = settings
            .openai_api_key
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        let has_wecom_webhook_url = settings
            .wecom_webhook_url
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
            wecom_webhook_url: None,
            has_wecom_webhook_url,
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
        wecom: diagnose_wecom(&saved_settings, &checked_at),
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
        "Boss 登录态可复用：Cookie 与 LocalStorage 均存在且可解析。"
    } else if !cookies_present && !local_storage_present {
        "尚未发现 Boss Cookie 与 LocalStorage，请先在采集页完成人工登录。"
    } else if !cookies_valid_json || !local_storage_valid_json {
        "Boss 登录态不完整或文件不可解析，请重新登录刷新 Cookie 与 LocalStorage。"
    } else {
        "Boss 登录态不完整，请重新登录刷新 Cookie 与 LocalStorage。"
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

fn diagnose_wecom(settings: &settings::AppSettings, checked_at: &str) -> WecomDiagnostic {
    let url = opt_trimmed(settings.wecom_webhook_url.clone());
    let has_webhook_url = url.is_some();
    let webhook_url_valid = url.as_deref().is_some_and(|value| {
        value.starts_with("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=")
    });
    let status = if webhook_url_valid { "ok" } else { "warning" }.to_string();
    let message = if webhook_url_valid {
        "企业微信 Webhook 已保存；每日岗位情报仍需用户手动点击发送。"
    } else if has_webhook_url {
        "企业微信 Webhook 已保存但格式不符合 qyapi.weixin.qq.com 机器人地址。"
    } else {
        "尚未保存企业微信 Webhook；每日岗位情报不会发送到企业微信。"
    }
    .to_string();

    WecomDiagnostic {
        status,
        checked_at: checked_at.to_string(),
        message,
        has_webhook_url,
        webhook_url_valid,
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
    wecom_webhook_url: Option<String>,
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
    current.openai_prompt_extra = opt_trimmed(openai_prompt_extra).unwrap_or_default();
    current.openai_schema_extra = opt_trimmed(openai_schema_extra).unwrap_or_default();
    if let Some(webhook_url) = wecom_webhook_url {
        current.wecom_webhook_url = opt_trimmed(Some(webhook_url));
    }

    settings::write_settings(&app_data_dir, &current).map_err(|e| e.to_string())?;
    Ok(PublicAppSettings::from(current))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn public_settings_redacts_saved_wecom_webhook_url() {
        let mut settings = settings::AppSettings::platform_default();
        settings.wecom_webhook_url =
            Some("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret".to_string());

        let public = PublicAppSettings::from(settings);

        assert_eq!(public.wecom_webhook_url, None);
        assert!(public.has_wecom_webhook_url);
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
    fn wecom_diagnostic_reports_saved_webhook_without_revealing_url() {
        let mut settings = settings::AppSettings::platform_default();
        let checked_at = "2026-06-14T00:00:00Z";

        let empty = diagnose_wecom(&settings, checked_at);
        assert_eq!(empty.status, "warning");
        assert!(!empty.has_webhook_url);
        assert!(!empty.webhook_url_valid);

        settings.wecom_webhook_url =
            Some("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret".to_string());
        let configured = diagnose_wecom(&settings, checked_at);
        assert_eq!(configured.status, "ok");
        assert!(configured.has_webhook_url);
        assert!(configured.webhook_url_valid);
        assert!(!configured.message.contains("secret"));
    }
}
