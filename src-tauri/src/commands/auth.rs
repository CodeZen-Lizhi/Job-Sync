use tauri::State;

use crate::{
    ipc::protocol::{CommandIn, LoginStartPayload},
    settings,
    sidecar::SidecarManager,
    storage,
};

fn has_boss_session(app_data_dir: &std::path::Path) -> bool {
    storage::boss_cookies_path(app_data_dir).is_file()
        && storage::boss_local_storage_path(app_data_dir).is_file()
}

fn has_linuxdo_session(app_data_dir: &std::path::Path) -> bool {
    storage::linuxdo_cookies_path(app_data_dir).is_file()
        && storage::linuxdo_local_storage_path(app_data_dir).is_file()
}

fn has_zhilian_session(app_data_dir: &std::path::Path) -> bool {
    if !storage::zhilian_browser_profile_path(app_data_dir).is_dir() {
        return false;
    }
    let Ok(Some(cookies)) = storage::read_json(&storage::zhilian_cookies_path(app_data_dir)) else {
        return false;
    };
    cookies
        .as_array()
        .map(|items| !items.is_empty())
        .unwrap_or(false)
        && storage::zhilian_local_storage_path(app_data_dir).is_file()
}

fn has_liepin_session(app_data_dir: &std::path::Path) -> bool {
    if !storage::liepin_browser_profile_path(app_data_dir).is_dir() {
        return false;
    }
    let Ok(Some(cookies)) = storage::read_json(&storage::liepin_cookies_path(app_data_dir)) else {
        return false;
    };
    cookies
        .as_array()
        .map(|items| !items.is_empty())
        .unwrap_or(false)
        && storage::liepin_local_storage_path(app_data_dir).is_file()
}

fn normalize_login_platform(source_platform: Option<&str>) -> Result<&'static str, String> {
    match source_platform
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("boss")
        .to_ascii_lowercase()
        .as_str()
    {
        "boss" => Ok("boss"),
        "liepin" => Ok("liepin"),
        "linuxdo" => Ok("linuxdo"),
        "zhilian" => Ok("zhilian"),
        other => Err(format!("当前平台暂不支持登录：{other}")),
    }
}

#[tauri::command]
pub fn get_login_status(
    sidecar: State<SidecarManager>,
    source_platform: Option<String>,
) -> Result<bool, String> {
    let platform = normalize_login_platform(source_platform.as_deref())?;
    Ok(match platform {
        "boss" => has_boss_session(sidecar.app_data_dir()),
        "liepin" => has_liepin_session(sidecar.app_data_dir()),
        "linuxdo" => has_linuxdo_session(sidecar.app_data_dir()),
        "zhilian" => has_zhilian_session(sidecar.app_data_dir()),
        _ => false,
    })
}

fn build_login_payload(app_data_dir: &std::path::Path, platform: &str) -> LoginStartPayload {
    let user_data_dir = match platform {
        "boss" => Some(storage::boss_browser_profile_path(app_data_dir)),
        "liepin" => Some(storage::liepin_browser_profile_path(app_data_dir)),
        "linuxdo" => Some(storage::linuxdo_browser_profile_path(app_data_dir)),
        "zhilian" => Some(storage::zhilian_browser_profile_path(app_data_dir)),
        _ => None,
    }
    .map(|path| path.to_string_lossy().to_string());

    LoginStartPayload {
        source_platform: Some(platform.to_string()),
        executable_path: settings::browser_executable_path(app_data_dir),
        user_data_dir,
    }
}

#[tauri::command]
pub fn start_login(
    sidecar: State<SidecarManager>,
    source_platform: Option<String>,
) -> Result<(), String> {
    let platform = normalize_login_platform(source_platform.as_deref())?;
    let payload = build_login_payload(sidecar.app_data_dir(), platform);
    sidecar
        .send(&CommandIn::LoginStart(payload))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn login_status_requires_cookies_and_local_storage() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();

        assert!(!has_boss_session(app_data_dir));

        storage::write_json(
            &storage::boss_cookies_path(app_data_dir),
            &json!([{"name": "sid"}]),
        )
        .expect("write cookies");
        assert!(!has_boss_session(app_data_dir));

        std::fs::remove_file(storage::boss_cookies_path(app_data_dir)).expect("remove cookies");
        storage::write_json(
            &storage::boss_local_storage_path(app_data_dir),
            &json!({"__zp_stoken__": "token"}),
        )
        .expect("write local storage");
        assert!(!has_boss_session(app_data_dir));

        storage::write_json(
            &storage::boss_cookies_path(app_data_dir),
            &json!([{"name": "sid"}]),
        )
        .expect("rewrite cookies");
        assert!(has_boss_session(app_data_dir));
    }

    #[test]
    fn zhilian_login_status_requires_profile_and_non_empty_cookies() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();

        storage::write_json(&storage::zhilian_cookies_path(app_data_dir), &json!([]))
            .expect("write empty cookies");
        storage::write_json(
            &storage::zhilian_local_storage_path(app_data_dir),
            &json!({}),
        )
        .expect("write local storage");
        assert!(!has_zhilian_session(app_data_dir));

        std::fs::create_dir_all(storage::zhilian_browser_profile_path(app_data_dir))
            .expect("create profile");
        assert!(!has_zhilian_session(app_data_dir));

        storage::write_json(
            &storage::zhilian_cookies_path(app_data_dir),
            &json!([{ "name": "ZP_TOKEN", "value": "token" }]),
        )
        .expect("write cookies");
        assert!(has_zhilian_session(app_data_dir));
    }

    #[test]
    fn liepin_login_status_requires_profile_and_non_empty_cookies() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();

        storage::write_json(&storage::liepin_cookies_path(app_data_dir), &json!([]))
            .expect("write empty cookies");
        storage::write_json(
            &storage::liepin_local_storage_path(app_data_dir),
            &json!({}),
        )
        .expect("write local storage");
        assert!(!has_liepin_session(app_data_dir));

        std::fs::create_dir_all(storage::liepin_browser_profile_path(app_data_dir))
            .expect("create profile");
        assert!(!has_liepin_session(app_data_dir));

        storage::write_json(
            &storage::liepin_cookies_path(app_data_dir),
            &json!([{ "name": "XSRF-TOKEN", "value": "token" }]),
        )
        .expect("write cookies");
        assert!(has_liepin_session(app_data_dir));
    }

    #[test]
    fn login_platform_defaults_to_boss_and_rejects_unknown() {
        assert_eq!(normalize_login_platform(None).expect("default"), "boss");
        assert_eq!(
            normalize_login_platform(Some("linuxdo")).expect("linuxdo"),
            "linuxdo"
        );
        assert_eq!(
            normalize_login_platform(Some("zhilian")).expect("zhilian"),
            "zhilian"
        );
        assert_eq!(
            normalize_login_platform(Some("liepin")).expect("liepin"),
            "liepin"
        );
        assert!(normalize_login_platform(Some("maimai")).is_err());
    }

    #[test]
    fn linuxdo_login_payload_uses_linuxdo_browser_profile() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();

        let payload = build_login_payload(app_data_dir, "linuxdo");
        let expected_user_data_dir = storage::linuxdo_browser_profile_path(app_data_dir)
            .to_string_lossy()
            .to_string();
        assert_eq!(payload.source_platform.as_deref(), Some("linuxdo"));
        assert_eq!(
            payload.user_data_dir.as_deref(),
            Some(expected_user_data_dir.as_str())
        );
    }

    #[test]
    fn boss_login_payload_uses_boss_browser_profile() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();

        let payload = build_login_payload(app_data_dir, "boss");
        let expected_user_data_dir = storage::boss_browser_profile_path(app_data_dir)
            .to_string_lossy()
            .to_string();
        assert_eq!(payload.source_platform.as_deref(), Some("boss"));
        assert_eq!(
            payload.user_data_dir.as_deref(),
            Some(expected_user_data_dir.as_str())
        );
    }

    #[test]
    fn zhilian_login_payload_uses_zhilian_browser_profile() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();

        let payload = build_login_payload(app_data_dir, "zhilian");
        let expected_user_data_dir = storage::zhilian_browser_profile_path(app_data_dir)
            .to_string_lossy()
            .to_string();
        assert_eq!(payload.source_platform.as_deref(), Some("zhilian"));
        assert_eq!(
            payload.user_data_dir.as_deref(),
            Some(expected_user_data_dir.as_str())
        );
    }

    #[test]
    fn liepin_login_payload_uses_liepin_browser_profile() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();

        let payload = build_login_payload(app_data_dir, "liepin");
        let expected_user_data_dir = storage::liepin_browser_profile_path(app_data_dir)
            .to_string_lossy()
            .to_string();
        assert_eq!(payload.source_platform.as_deref(), Some("liepin"));
        assert_eq!(
            payload.user_data_dir.as_deref(),
            Some(expected_user_data_dir.as_str())
        );
    }
}
