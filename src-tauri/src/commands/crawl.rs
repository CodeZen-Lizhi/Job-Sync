use tauri::State;

use crate::{
    db::{self, models},
    ipc::protocol::{
        BossChatSyncPayload, BossMetaSyncPayload, CommandIn, CrawlAutoStartPayload,
        CrawlManualStartPayload, RefreshJobEvidencePayload, SearchTaskPayload, SessionStatePayload,
    },
    paths,
    sidecar::SidecarManager,
    storage,
};

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

fn load_session_optional(app_data_dir: &std::path::Path) -> SessionStatePayload {
    let cookies_path = storage::boss_cookies_path(app_data_dir);
    let local_storage_path = storage::boss_local_storage_path(app_data_dir);

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

#[tauri::command]
pub fn crawl_manual_start(sidecar: State<SidecarManager>) -> Result<(), String> {
    let session = load_session(sidecar.app_data_dir())?;
    sidecar
        .send(&CommandIn::CrawlManualStart(CrawlManualStartPayload {
            session,
        }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn crawl_auto_start(
    sidecar: State<SidecarManager>,
    task: SearchTaskPayload,
) -> Result<(), String> {
    let conn = db::init_db(sidecar.app_data_dir()).map_err(|e| e.to_string())?;
    let run_id = models::new_collection_run_id();
    let source_platform = task
        .source_platform
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("boss")
        .to_string();
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

    let session = match if source_platform == "v2ex" {
        Ok(load_session_optional(sidecar.app_data_dir()))
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
    if let Err(err) = sidecar.send(&CommandIn::CrawlAutoStart(CrawlAutoStartPayload {
        session,
        task,
        run_id: Some(run_id.clone()),
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

#[tauri::command]
pub fn crawl_stop(sidecar: State<SidecarManager>) -> Result<(), String> {
    sidecar.send(&CommandIn::Stop).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_boss_meta(sidecar: State<SidecarManager>) -> Result<Option<serde_json::Value>, String> {
    let meta_path = storage::boss_meta_path(sidecar.app_data_dir());
    storage::read_json(&meta_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_boss_meta(sidecar: State<SidecarManager>) -> Result<(), String> {
    let session = load_session_optional(sidecar.app_data_dir());
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
                   j.raw_payload_json,
                   COALESCE(json_extract(r.reason_json, '$.bucket'), '')
            FROM job j
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

    let session = match load_session(sidecar.app_data_dir()) {
        Ok(session) => session,
        Err(err) => {
            let _ = models::record_collection_failure(
                &conn,
                &models::NewCollectionFailure {
                    run_id: None,
                    source_platform: Some(&source_platform),
                    event_type: "REFRESH_JOB_EVIDENCE",
                    keyword: None,
                    encrypt_job_id: Some(&encrypt_job_id),
                    reason: &err,
                    raw_payload: None,
                },
            );
            return Err(err);
        }
    };

    let raw_payload = raw_payload_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
    sidecar
        .send(&CommandIn::RefreshJobEvidence(RefreshJobEvidencePayload {
            session,
            encrypt_job_id: encrypt_job_id.clone(),
            source_url,
            raw_payload,
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
