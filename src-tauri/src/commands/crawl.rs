use tauri::State;

use crate::{
    db::{self, models},
    ipc::protocol::{
        BossChatSyncPayload, BossMetaSyncPayload, CommandIn, CrawlAutoStartPayload,
        RefreshJobEvidencePayload, SearchTaskPayload, SessionStatePayload,
    },
    paths,
    sidecar::SidecarManager,
    storage,
};

fn session_storage_paths(
    app_data_dir: &std::path::Path,
    source_platform: &str,
) -> (std::path::PathBuf, std::path::PathBuf) {
    match normalize_collection_platform(Some(source_platform)).as_str() {
        "linuxdo" => (
            storage::linuxdo_cookies_path(app_data_dir),
            storage::linuxdo_local_storage_path(app_data_dir),
        ),
        _ => (
            storage::boss_cookies_path(app_data_dir),
            storage::boss_local_storage_path(app_data_dir),
        ),
    }
}

#[derive(Debug, serde::Serialize)]
pub struct PendingEvidenceRefreshResult {
    pub encrypt_job_id: String,
    pub status: String,
    pub message: String,
}

fn load_session(app_data_dir: &std::path::Path) -> Result<SessionStatePayload, String> {
    let cookies_path = storage::boss_cookies_path(app_data_dir);
    let local_storage_path = storage::boss_local_storage_path(app_data_dir);

    let cookies = storage::read_json(&cookies_path)
        .map_err(|e| e.to_string())?
        .ok_or("cookies not found, please login first")?;
    let local_storage = storage::read_json(&local_storage_path)
        .map_err(|e| e.to_string())?
        .ok_or("localStorage not found, please login first")?;

    Ok(SessionStatePayload {
        cookies,
        local_storage,
    })
}

fn load_session_optional(
    app_data_dir: &std::path::Path,
    source_platform: &str,
) -> SessionStatePayload {
    let (cookies_path, local_storage_path) = session_storage_paths(app_data_dir, source_platform);

    let cookies = storage::read_json(&cookies_path)
        .ok()
        .flatten()
        .unwrap_or_else(|| serde_json::Value::Array(vec![]));
    let local_storage = storage::read_json(&local_storage_path)
        .ok()
        .flatten()
        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));

    SessionStatePayload {
        cookies,
        local_storage,
    }
}

fn normalize_collection_platform(source_platform: Option<&str>) -> String {
    source_platform
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| "boss".to_string())
}

fn collection_browser_profile_path(
    app_data_dir: &std::path::Path,
    source_platform: &str,
) -> Option<String> {
    let normalized_platform = normalize_collection_platform(Some(source_platform));
    match normalized_platform.as_str() {
        "boss" => Some(storage::boss_browser_profile_path(app_data_dir)),
        "linuxdo" => Some(storage::linuxdo_browser_profile_path(app_data_dir)),
        _ => None,
    }
    .map(|path| path.to_string_lossy().to_string())
}

fn collection_uses_optional_session(source_platform: &str) -> bool {
    matches!(
        normalize_collection_platform(Some(source_platform)).as_str(),
        "boss" | "v2ex" | "linuxdo"
    )
}

#[tauri::command]
pub fn crawl_auto_start(
    sidecar: State<SidecarManager>,
    mut task: SearchTaskPayload,
) -> Result<(), String> {
    let conn = db::init_db(sidecar.app_data_dir()).map_err(|e| e.to_string())?;
    let run_id = models::new_collection_run_id();
    let source_platform = normalize_collection_platform(task.source_platform.as_deref());
    task.source_platform = Some(source_platform.clone());
    models::create_collection_run(
        &conn,
        &models::NewCollectionRun {
            id: &run_id,
            source_platform: &source_platform,
            keywords: &task.keywords,
            filters: &task.filters,
            limits: &task.limits,
        },
    )
    .map_err(|e| e.to_string())?;

    let session = match if collection_uses_optional_session(&source_platform) {
        Ok(load_session_optional(
            sidecar.app_data_dir(),
            &source_platform,
        ))
    } else {
        load_session(sidecar.app_data_dir())
    } {
        Ok(session) => session,
        Err(err) => {
            let _ = models::fail_collection_run(&conn, &run_id, &err);
            let _ = models::record_collection_failure(
                &conn,
                &models::NewCollectionFailure {
                    run_id: Some(&run_id),
                    source_platform: Some(&source_platform),
                    event_type: "CRAWL_AUTO_START",
                    keyword: None,
                    encrypt_job_id: None,
                    reason: &err,
                    raw_payload: None,
                },
            );
            return Err(err);
        }
    };
    let user_data_dir = collection_browser_profile_path(sidecar.app_data_dir(), &source_platform);

    if let Err(err) = sidecar.send(&CommandIn::CrawlAutoStart(CrawlAutoStartPayload {
        session,
        task,
        run_id: Some(run_id.clone()),
        user_data_dir,
    })) {
        let message = err.to_string();
        let _ = models::fail_collection_run(&conn, &run_id, &message);
        let _ = models::record_collection_failure(
            &conn,
            &models::NewCollectionFailure {
                run_id: Some(&run_id),
                source_platform: Some(&source_platform),
                event_type: "CRAWL_AUTO_START",
                keyword: None,
                encrypt_job_id: None,
                reason: &message,
                raw_payload: None,
            },
        );
        return Err(message);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boss_collection_uses_boss_browser_profile() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();
        let expected = storage::boss_browser_profile_path(app_data_dir)
            .to_string_lossy()
            .to_string();

        assert_eq!(
            collection_browser_profile_path(app_data_dir, "boss").as_deref(),
            Some(expected.as_str())
        );
    }

    #[test]
    fn boss_collection_profile_normalizes_platform_case() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();
        let expected = storage::boss_browser_profile_path(app_data_dir)
            .to_string_lossy()
            .to_string();

        assert_eq!(normalize_collection_platform(Some(" Boss ")), "boss");
        assert_eq!(
            collection_browser_profile_path(app_data_dir, " Boss ").as_deref(),
            Some(expected.as_str())
        );
    }

    #[test]
    fn linuxdo_collection_uses_linuxdo_browser_profile() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();
        let expected = storage::linuxdo_browser_profile_path(app_data_dir)
            .to_string_lossy()
            .to_string();

        assert_eq!(
            collection_browser_profile_path(app_data_dir, "linuxdo").as_deref(),
            Some(expected.as_str())
        );
    }

    #[test]
    fn linuxdo_collection_profile_normalizes_platform_case() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();
        let expected = storage::linuxdo_browser_profile_path(app_data_dir)
            .to_string_lossy()
            .to_string();

        assert_eq!(
            collection_browser_profile_path(app_data_dir, " LinuxDo ").as_deref(),
            Some(expected.as_str())
        );
    }

    #[test]
    fn feed_collection_without_browser_profile_stays_none() {
        let tmp = tempfile::tempdir().expect("tempdir");

        assert_eq!(collection_browser_profile_path(tmp.path(), "v2ex"), None);
    }

    #[test]
    fn boss_collection_can_start_with_optional_session() {
        assert!(collection_uses_optional_session("boss"));
        assert!(collection_uses_optional_session(" Boss "));
        assert!(collection_uses_optional_session("v2ex"));
        assert!(collection_uses_optional_session(" V2EX "));
        assert!(collection_uses_optional_session("linuxdo"));
        assert!(collection_uses_optional_session(" LinuxDo "));
        assert!(!collection_uses_optional_session("liepin"));
    }

    #[test]
    fn linuxdo_optional_session_reads_linuxdo_cookie_snapshot() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path();
        storage::write_json(
            &storage::boss_cookies_path(app_data_dir),
            &serde_json::json!([{ "name": "boss", "value": "wrong" }]),
        )
        .expect("write boss cookies");
        storage::write_json(
            &storage::linuxdo_cookies_path(app_data_dir),
            &serde_json::json!([{ "name": "_t", "value": "linuxdo-token", "domain": "linux.do" }]),
        )
        .expect("write linuxdo cookies");

        let session = load_session_optional(app_data_dir, "linuxdo");

        assert_eq!(
            session.cookies,
            serde_json::json!([{ "name": "_t", "value": "linuxdo-token", "domain": "linux.do" }])
        );
    }
}

#[tauri::command]
pub fn crawl_stop(sidecar: State<SidecarManager>) -> Result<(), String> {
    sidecar
        .stop_collection_by_user()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_boss_meta(sidecar: State<SidecarManager>) -> Result<Option<serde_json::Value>, String> {
    let meta_path = storage::boss_meta_path(sidecar.app_data_dir());
    storage::read_json(&meta_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_boss_meta(sidecar: State<SidecarManager>) -> Result<(), String> {
    let session = load_session_optional(sidecar.app_data_dir(), "boss");
    sidecar
        .send(&CommandIn::BossMetaSync(BossMetaSyncPayload { session }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn sync_boss_chat_status(sidecar: State<SidecarManager>) -> Result<(), String> {
    let session = load_session(sidecar.app_data_dir())?;
    sidecar
        .send(&CommandIn::BossChatSync(BossChatSyncPayload {
            session,
            limits: serde_json::Value::Object(serde_json::Map::new()),
        }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_collection_runs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<models::CollectionRun>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    models::list_collection_runs(&conn, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_collection_failures(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<models::CollectionFailure>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    models::list_collection_failures(&conn, limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn refresh_pending_job_evidence(
    sidecar: State<SidecarManager>,
    encrypt_job_id: String,
) -> Result<PendingEvidenceRefreshResult, String> {
    let encrypt_job_id = encrypt_job_id.trim().to_string();
    if encrypt_job_id.is_empty() {
        return Err("岗位 ID 不能为空".to_string());
    }

    let conn = db::init_db(sidecar.app_data_dir()).map_err(|e| e.to_string())?;
    let row = conn
        .query_row(
            r#"
            SELECT COALESCE(j.source_platform, 'boss'),
                   j.source_url,
                   COALESCE(sp.raw_payload_json, j.raw_payload_json),
                   COALESCE(json_extract(r.reason_json, '$.bucket'), '')
            FROM job j
            LEFT JOIN job_source_payload sp ON sp.encrypt_job_id = j.encrypt_job_id
            LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
            WHERE j.encrypt_job_id = ?1
            "#,
            [&encrypt_job_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|_| "未找到该岗位，无法补证据".to_string())?;

    let (source_platform, source_url, raw_payload_json, bucket) = row;
    if bucket != "pending_confirmation" {
        return Err("只有待确认岗位需要补证据".to_string());
    }
    if source_platform != "boss" {
        let message = "当前来源暂不支持自动补证据".to_string();
        let _ = models::record_collection_failure(
            &conn,
            &models::NewCollectionFailure {
                run_id: None,
                source_platform: Some(&source_platform),
                event_type: "REFRESH_JOB_EVIDENCE",
                keyword: None,
                encrypt_job_id: Some(&encrypt_job_id),
                reason: &message,
                raw_payload: None,
            },
        );
        return Err(message);
    }

    let session = load_session_optional(sidecar.app_data_dir(), "boss");

    let raw_payload = raw_payload_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
    sidecar
        .send(&CommandIn::RefreshJobEvidence(RefreshJobEvidencePayload {
            session,
            encrypt_job_id: encrypt_job_id.clone(),
            source_url,
            raw_payload,
            user_data_dir: Some(
                storage::boss_browser_profile_path(sidecar.app_data_dir())
                    .to_string_lossy()
                    .to_string(),
            ),
        }))
        .map_err(|e| {
            let message = e.to_string();
            let _ = models::record_collection_failure(
                &conn,
                &models::NewCollectionFailure {
                    run_id: None,
                    source_platform: Some(&source_platform),
                    event_type: "REFRESH_JOB_EVIDENCE",
                    keyword: None,
                    encrypt_job_id: Some(&encrypt_job_id),
                    reason: &message,
                    raw_payload: None,
                },
            );
            message
        })?;

    Ok(PendingEvidenceRefreshResult {
        encrypt_job_id,
        status: "started".to_string(),
        message: "已开始补充岗位详情证据，完成后会自动重新筛选。".to_string(),
    })
}
