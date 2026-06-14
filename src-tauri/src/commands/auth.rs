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

#[tauri::command]
pub fn get_login_status(sidecar: State<SidecarManager>) -> Result<bool, String> {
    Ok(has_boss_session(sidecar.app_data_dir()))
}

#[tauri::command]
pub fn start_login(sidecar: State<SidecarManager>) -> Result<(), String> {
    let payload = LoginStartPayload {
        executable_path: settings::browser_executable_path(sidecar.app_data_dir()),
        user_data_dir: None,
    };
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
}
