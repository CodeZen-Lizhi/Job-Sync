use crate::{paths, settings};

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
}
