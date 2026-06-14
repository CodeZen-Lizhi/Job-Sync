use crate::settings::AppSettings;

pub(super) const DEFAULT_OPENAI_API_MODE: &str = "chat_completions";
pub(super) const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
pub(super) const DEFAULT_OPENAI_MODEL: &str = "gpt-4o-mini";
const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com";
const DEEPSEEK_MODEL: &str = "deepseek-chat";
const OLLAMA_BASE_URL: &str = "http://localhost:11434/v1";
const OLLAMA_MODEL: &str = "qwen2.5:7b";
pub(super) const OLLAMA_DUMMY_API_KEY: &str = "ollama";

#[derive(Debug, Clone, Default)]
pub(super) struct OpenAiOverrides {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub api_mode: Option<String>,
    pub temperature: Option<f64>,
}

#[derive(Debug, Clone)]
pub(super) struct ResolvedOpenAiRequest {
    pub api_key: Option<String>,
    pub effective_base_url: String,
    pub effective_model: String,
    pub effective_api_mode: String,
    pub effective_temperature: f64,
    pub effective_prompt_extra: String,
    pub effective_schema_extra: String,
}

pub(super) fn opt_trimmed(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

pub(super) fn is_local_ollama_base_url(base_url: &str) -> bool {
    let normalized = base_url.trim().trim_end_matches('/').to_ascii_lowercase();
    let root = normalized
        .strip_suffix("/v1")
        .unwrap_or(&normalized)
        .trim_end_matches('/');
    matches!(
        root,
        "http://localhost:11434"
            | "http://127.0.0.1:11434"
            | "http://[::1]:11434"
            | "https://localhost:11434"
            | "https://127.0.0.1:11434"
            | "https://[::1]:11434"
    )
}

fn provider_defaults(provider: Option<&str>) -> (&'static str, &'static str, &'static str) {
    match provider.map(|value| value.trim().to_lowercase()) {
        Some(value) if value == "deepseek" => {
            (DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEFAULT_OPENAI_API_MODE)
        }
        Some(value) if value == "ollama" => {
            (OLLAMA_BASE_URL, OLLAMA_MODEL, DEFAULT_OPENAI_API_MODE)
        }
        _ => (
            DEFAULT_OPENAI_BASE_URL,
            DEFAULT_OPENAI_MODEL,
            DEFAULT_OPENAI_API_MODE,
        ),
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

fn parse_temperature(value: Option<String>) -> Option<f64> {
    value
        .and_then(|raw| raw.trim().parse::<f64>().ok())
        .and_then(|value| clamp_temperature(Some(value)))
}

pub(super) fn resolve_openai_request(
    saved_settings: Option<&AppSettings>,
    overrides: OpenAiOverrides,
) -> ResolvedOpenAiRequest {
    let api_key = opt_trimmed(overrides.api_key);
    let base_url = opt_trimmed(overrides.base_url);
    let model = opt_trimmed(overrides.model);
    let api_mode = opt_trimmed(overrides.api_mode);
    let temperature = clamp_temperature(overrides.temperature);
    let provider = saved_settings.and_then(|settings| settings.openai_provider.as_deref());
    let (provider_base_url, provider_model, provider_api_mode) = provider_defaults(provider);

    let effective_api_mode = api_mode
        .clone()
        .or_else(|| saved_settings.and_then(|settings| settings.openai_api_mode.clone()))
        .or_else(|| std::env::var("OPENAI_API_MODE").ok())
        .unwrap_or_else(|| provider_api_mode.to_string());

    let effective_model = model
        .clone()
        .or_else(|| saved_settings.and_then(|settings| settings.openai_model.clone()))
        .or_else(|| std::env::var("OPENAI_MODEL").ok())
        .unwrap_or_else(|| provider_model.to_string());

    let effective_base_url = base_url
        .clone()
        .or_else(|| saved_settings.and_then(|settings| settings.openai_base_url.clone()))
        .or_else(|| std::env::var("OPENAI_BASE_URL").ok())
        .unwrap_or_else(|| provider_base_url.to_string());

    let effective_temperature = temperature
        .or_else(|| {
            saved_settings.and_then(|settings| clamp_temperature(settings.openai_temperature))
        })
        .or_else(|| parse_temperature(std::env::var("OPENAI_TEMPERATURE").ok()))
        .unwrap_or(0.2);
    let effective_prompt_extra = saved_settings
        .and_then(|settings| opt_trimmed(Some(settings.openai_prompt_extra.clone())))
        .or_else(|| {
            std::env::var("OPENAI_PROMPT_EXTRA")
                .ok()
                .and_then(|v| opt_trimmed(Some(v)))
        })
        .unwrap_or_default();
    let effective_schema_extra = saved_settings
        .and_then(|settings| opt_trimmed(Some(settings.openai_schema_extra.clone())))
        .or_else(|| {
            std::env::var("OPENAI_SCHEMA_EXTRA")
                .ok()
                .and_then(|v| opt_trimmed(Some(v)))
        })
        .unwrap_or_default();

    ResolvedOpenAiRequest {
        api_key,
        effective_api_mode,
        effective_model,
        effective_base_url,
        effective_temperature,
        effective_prompt_extra,
        effective_schema_extra,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_defaults_drive_effective_request_values() {
        let mut settings = AppSettings::platform_default();
        settings.openai_provider = Some("deepseek".to_string());
        let resolved = resolve_openai_request(Some(&settings), OpenAiOverrides::default());
        assert_eq!(resolved.effective_base_url, "https://api.deepseek.com");
        assert_eq!(resolved.effective_model, "deepseek-chat");
        assert_eq!(resolved.effective_api_mode, "chat_completions");

        settings.openai_provider = Some("ollama".to_string());
        let resolved = resolve_openai_request(Some(&settings), OpenAiOverrides::default());
        assert_eq!(resolved.effective_base_url, "http://localhost:11434/v1");
        assert_eq!(resolved.effective_model, "qwen2.5:7b");
    }

    #[test]
    fn local_ollama_base_url_accepts_root_and_v1_urls() {
        for url in [
            "http://localhost:11434",
            "http://localhost:11434/",
            "http://localhost:11434/v1",
            "http://127.0.0.1:11434",
            "http://127.0.0.1:11434/v1",
            "http://[::1]:11434",
            "http://[::1]:11434/v1",
            "https://localhost:11434/v1",
        ] {
            assert!(is_local_ollama_base_url(url), "{url}");
        }

        assert!(!is_local_ollama_base_url("https://api.openai.com/v1"));
        assert!(!is_local_ollama_base_url("http://localhost:11435/v1"));
        assert!(!is_local_ollama_base_url(
            "http://localhost:11434/v1/chat/completions"
        ));
    }

    #[test]
    fn explicit_overrides_win_over_provider_defaults() {
        let mut settings = AppSettings::platform_default();
        settings.openai_provider = Some("ollama".to_string());
        let resolved = resolve_openai_request(
            Some(&settings),
            OpenAiOverrides {
                base_url: Some("https://example.test/v1".to_string()),
                model: Some("custom-model".to_string()),
                api_mode: Some("responses".to_string()),
                ..OpenAiOverrides::default()
            },
        );
        assert_eq!(resolved.effective_base_url, "https://example.test/v1");
        assert_eq!(resolved.effective_model, "custom-model");
        assert_eq!(resolved.effective_api_mode, "responses");
    }

    #[test]
    fn saved_temperature_prompt_extra_and_schema_extra_are_part_of_effective_request() {
        let mut settings = AppSettings::platform_default();
        settings.openai_provider = Some("deepseek".to_string());
        settings.openai_temperature = Some(2.8);
        settings.openai_prompt_extra = "优先关注 Go / Kubernetes 证据".to_string();
        settings.openai_schema_extra = "额外输出 evidenceLevel 字段".to_string();

        let resolved = resolve_openai_request(Some(&settings), OpenAiOverrides::default());

        assert_eq!(resolved.effective_temperature, 2.0);
        assert_eq!(
            resolved.effective_prompt_extra,
            "优先关注 Go / Kubernetes 证据"
        );
        assert_eq!(
            resolved.effective_schema_extra,
            "额外输出 evidenceLevel 字段"
        );
    }

    #[test]
    fn explicit_temperature_override_wins_over_saved_settings() {
        let mut settings = AppSettings::platform_default();
        settings.openai_temperature = Some(0.1);

        let resolved = resolve_openai_request(
            Some(&settings),
            OpenAiOverrides {
                temperature: Some(0.7),
                ..OpenAiOverrides::default()
            },
        );

        assert_eq!(resolved.effective_temperature, 0.7);
    }
}
