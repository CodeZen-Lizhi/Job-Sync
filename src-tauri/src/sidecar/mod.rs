use std::{
    collections::HashSet,
    convert::TryFrom,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Stdio},
    sync::{Arc, Mutex},
    thread,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use rusqlite::params;
use serde_json::Value;
use time::format_description::well_known::Rfc3339;

use crate::{
    commands::{ai, filter_profile},
    db,
    db::models,
    ipc,
    ipc::protocol::{CommandIn, EventOut, LogPayload},
    settings, storage,
};

#[derive(thiserror::Error, Debug)]
pub enum SidecarError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("db error: {0}")]
    Db(#[from] db::DbError),
    #[error("{0}")]
    Message(String),
}

pub type Result<T> = std::result::Result<T, SidecarError>;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc().format(&Rfc3339).unwrap()
}

fn extract_max_jobs(limits: &Value) -> Option<i64> {
    let raw = limits.get("maxJobs").or_else(|| limits.get("max_jobs"))?;
    let parsed = if let Some(value) = raw.as_i64() {
        Some(value)
    } else if let Some(value) = raw.as_u64() {
        i64::try_from(value).ok()
    } else if let Some(value) = raw.as_f64() {
        if value.is_finite() {
            Some(value.floor() as i64)
        } else {
            None
        }
    } else {
        None
    }?;
    if parsed > 0 {
        Some(parsed)
    } else {
        None
    }
}

fn local_job_exists(conn: &rusqlite::Connection, encrypt_job_id: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM job WHERE encrypt_job_id = ?1)",
        params![encrypt_job_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|exists| exists != 0)
    .unwrap_or(false)
}

fn emit_runtime_log(app_handle: &tauri::AppHandle, level: &str, message: impl Into<String>) {
    let _ = ipc::emit_event_all(
        app_handle,
        &EventOut::Log(LogPayload {
            level: level.to_string(),
            message: message.into(),
            ts: Some(now_rfc3339()),
        }),
    );
}

fn summarize_auto_ai_result(result: &Value) -> String {
    let updated = result
        .get("updated")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let ai_judged = result
        .get("ai_judged")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let hard_skipped = result
        .get("hard_skipped")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let failed = result
        .get("failed")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let mut message = format!("AI 采后判断已更新 {updated} 个岗位，其中 {ai_judged} 个由 AI 判断");
    if hard_skipped > 0 {
        message.push_str(&format!("，{hard_skipped} 个保留硬规则结果"));
    }
    if failed > 0 {
        message.push_str(&format!("，{failed} 个转入待确认"));
    }
    message
}

fn auto_recompute_ai_after_collection(app_handle: &tauri::AppHandle) {
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        match ai::recompute_ai_post_collection_judgement(
            app_handle.clone(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        {
            Ok(result) => emit_runtime_log(&app_handle, "info", summarize_auto_ai_result(&result)),
            Err(err) => emit_runtime_log(&app_handle, "error", format!("AI 采后判断失败：{err}")),
        }
    });
}

fn extract_job_id_from_list_item(item: &Value) -> Option<String> {
    item.get("securityId")
        .and_then(|v| v.as_str())
        .or_else(|| item.get("security_id").and_then(|v| v.as_str()))
        .or_else(|| {
            item.get("jobInfo")
                .and_then(|v| v.get("securityId").or_else(|| v.get("security_id")))
                .and_then(|v| v.as_str())
        })
        .or_else(|| item.get("encryptJobId").and_then(|v| v.as_str()))
        .or_else(|| item.get("encrypt_job_id").and_then(|v| v.as_str()))
        .or_else(|| {
            item.get("jobInfo")
                .and_then(|v| v.get("encryptJobId"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            item.get("jobInfo")
                .and_then(|v| v.get("encrypt_job_id"))
                .and_then(|v| v.as_str())
        })
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(ToString::to_string)
}

struct ExtractedJobListItem {
    encrypt_job_id: Option<String>,
    raw: Value,
}

fn extract_job_items_from_joblist(raw: &Value) -> Vec<ExtractedJobListItem> {
    let list = raw
        .get("zpData")
        .and_then(|v| {
            v.get("jobList")
                .or_else(|| v.get("list"))
                .or_else(|| v.get("data"))
        })
        .or_else(|| raw.get("jobList").or_else(|| raw.get("data")));

    let Some(arr) = list.and_then(|v| v.as_array()) else {
        return vec![];
    };

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for it in arr {
        let encrypt_job_id = extract_job_id_from_list_item(it);
        if let Some(id) = encrypt_job_id.as_ref() {
            if !seen.insert(id.clone()) {
                continue;
            }
        }
        out.push(ExtractedJobListItem {
            encrypt_job_id,
            raw: it.clone(),
        });
    }
    out
}

#[cfg(test)]
fn extract_jobs_from_joblist(raw: &Value) -> Vec<(String, Value)> {
    extract_job_items_from_joblist(raw)
        .into_iter()
        .filter_map(|item| item.encrypt_job_id.map(|id| (id, item.raw)))
        .collect()
}

fn record_collection_failure(
    conn: &rusqlite::Connection,
    active_run: Option<&ActiveCollectionRun>,
    event_type: &str,
    keyword: Option<&str>,
    encrypt_job_id: Option<&str>,
    reason: &str,
    raw_payload: Option<&Value>,
) {
    let _ = models::record_collection_failure(
        conn,
        &models::NewCollectionFailure {
            run_id: active_run.map(|run| run.id.as_str()),
            source_platform: active_run.map(|run| run.source_platform.as_str()),
            event_type,
            keyword,
            encrypt_job_id,
            reason,
            raw_payload,
        },
    );
}

fn send_worker_command(inner: &Arc<Mutex<Option<RunningSidecar>>>, cmd: &CommandIn) -> Result<()> {
    let mut guard = inner
        .lock()
        .map_err(|_| SidecarError::Message("sidecar lock poisoned".into()))?;
    let Some(running) = guard.as_mut() else {
        return Err(SidecarError::Message("sidecar not running".into()));
    };

    if let Ok(Some(_)) = running.child.try_wait() {
        let _ = running.child.wait();
        *guard = None;
        return Err(SidecarError::Message("sidecar exited".into()));
    }

    let line = serde_json::to_string(cmd)?;
    running.stdin.write_all(format!("{line}\n").as_bytes())?;
    running.stdin.flush().ok();
    Ok(())
}

fn request_stop_when_ready(
    active_collection_run: &Arc<Mutex<Option<ActiveCollectionRun>>>,
    inner: &Arc<Mutex<Option<RunningSidecar>>>,
) {
    let should_stop = {
        let mut guard = match active_collection_run.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(run) = guard.as_mut() else {
            return;
        };
        run.note_inserted_and_should_stop()
    };

    if should_stop {
        let _ = send_worker_command(inner, &CommandIn::Stop);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_job_id_from_list_item_reads_nested_boss_ids() {
        let item = json!({
          "jobInfo": {
            "encryptJobId": " nested-encrypt-123 "
          }
        });

        assert_eq!(
            extract_job_id_from_list_item(&item).as_deref(),
            Some("nested-encrypt-123")
        );
    }

    #[test]
    fn extract_jobs_from_joblist_reuses_shared_boss_id_paths() {
        let raw = json!({
          "zpData": {
            "jobList": [
              { "jobInfo": { "securityId": "nested-sec-1" } },
              { "security_id": "sec-2" },
              { "jobInfo": { "encrypt_job_id": "nested-encrypt-3" } }
            ]
          }
        });

        let ids = extract_jobs_from_joblist(&raw)
            .into_iter()
            .map(|(id, _)| id)
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["nested-sec-1", "sec-2", "nested-encrypt-3"]);
    }
}

struct RunningSidecar {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Clone)]
struct ActiveCollectionRun {
    id: String,
    source_platform: String,
    max_jobs: Option<i64>,
    inserted_count: i64,
    stop_sent: bool,
}

impl ActiveCollectionRun {
    fn note_inserted_and_should_stop(&mut self) -> bool {
        self.inserted_count += 1;
        if self.stop_sent {
            return false;
        }
        let Some(max_jobs) = self.max_jobs else {
            return false;
        };
        if self.inserted_count >= max_jobs {
            self.stop_sent = true;
            return true;
        }
        false
    }
}

pub struct SidecarManager {
    app_handle: tauri::AppHandle,
    app_data_dir: PathBuf,
    inner: Arc<Mutex<Option<RunningSidecar>>>,
    active_collection_run: Arc<Mutex<Option<ActiveCollectionRun>>>,
}

impl SidecarManager {
    pub fn new(app_handle: tauri::AppHandle, app_data_dir: PathBuf) -> Self {
        Self {
            app_handle,
            app_data_dir,
            inner: Arc::new(Mutex::new(None)),
            active_collection_run: Arc::new(Mutex::new(None)),
        }
    }

    pub fn app_data_dir(&self) -> &Path {
        &self.app_data_dir
    }

    pub fn is_running(&self) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|_| ()))
            .is_some()
    }

    pub fn start_if_needed(&self) -> Result<()> {
        if self.is_running() {
            return Ok(());
        }

        let mut cmd =
            crate::worker::build_worker_command(&self.app_handle).map_err(SidecarError::Message)?;

        settings::apply_worker_env(&mut cmd, &self.app_data_dir);

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| SidecarError::Message("failed to open worker stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SidecarError::Message("failed to open worker stdout".into()))?;

        let app_handle = self.app_handle.clone();
        let app_data_dir = self.app_data_dir.clone();
        let inner = Arc::clone(&self.inner);
        let active_collection_run = Arc::clone(&self.active_collection_run);

        thread::spawn(move || {
            let conn = db::init_db(&app_data_dir);
            let conn = match conn {
                Ok(c) => Some(c),
                Err(err) => {
                    let _ = ipc::emit_event_all(
                        &app_handle,
                        &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                            message: format!("db init failed: {err}"),
                            stack: None,
                        }),
                    );
                    None
                }
            };

            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let evt: EventOut = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(err) => {
                        let _ = ipc::emit_event_all(
                            &app_handle,
                            &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                                message: "worker emitted invalid json".into(),
                                stack: Some(err.to_string()),
                            }),
                        );
                        continue;
                    }
                };

                let _ = ipc::emit_event_all(&app_handle, &evt);

                match &evt {
                    EventOut::CookieCollected(payload) => {
                        let cookies_path = storage::boss_cookies_path(&app_data_dir);
                        let local_storage_path = storage::boss_local_storage_path(&app_data_dir);
                        let _ = storage::write_json(&cookies_path, &payload.cookies);
                        let _ = storage::write_json(&local_storage_path, &payload.local_storage);
                    }
                    EventOut::BossMetaSynced(payload) => {
                        let meta_path = storage::boss_meta_path(&app_data_dir);
                        let mut meta = storage::read_json(&meta_path)
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
                        if !meta.is_object() {
                            meta = Value::Object(serde_json::Map::new());
                        }
                        if let Some(obj) = meta.as_object_mut() {
                            if let Some(synced_at) = &payload.synced_at {
                                obj.insert("synced_at".into(), Value::String(synced_at.clone()));
                            }
                            if let Some(city_group) = &payload.city_group {
                                obj.insert("city_group".into(), city_group.clone());
                            }
                            if let Some(filter_conditions) = &payload.filter_conditions {
                                obj.insert("filter_conditions".into(), filter_conditions.clone());
                            }
                            if let Some(industry_filter_exemption) =
                                &payload.industry_filter_exemption
                            {
                                obj.insert(
                                    "industry_filter_exemption".into(),
                                    industry_filter_exemption.clone(),
                                );
                            }
                        }
                        let _ = storage::write_json(&meta_path, &meta);
                    }
                    _ => {}
                }

                if let Some(conn) = conn.as_ref() {
                    let active_run = active_collection_run
                        .lock()
                        .ok()
                        .and_then(|guard| guard.clone());
                    match &evt {
                        EventOut::JobDetailCaptured(payload) => {
                            if let Ok(zp_json) = serde_json::to_string(&payload.zp_data) {
                                match models::upsert_job_from_detail_with_outcome(
                                    conn,
                                    &payload.encrypt_job_id,
                                    &zp_json,
                                ) {
                                    Ok(outcome) => {
                                        if let Some(active_run) = active_run.as_ref() {
                                            let _ = models::increment_collection_counter(
                                                conn,
                                                &active_run.id,
                                                outcome.counter(),
                                                1,
                                            );
                                            if matches!(
                                                outcome.counter(),
                                                models::CollectionCounter::Inserted
                                            ) {
                                                request_stop_when_ready(
                                                    &active_collection_run,
                                                    &inner,
                                                );
                                            }
                                        }
                                        if let Err(err) =
                                            filter_profile::recompute_default_filter_profile_for_job_on_conn(
                                                conn,
                                                &payload.encrypt_job_id,
                                            )
                                        {
                                            record_collection_failure(
                                                conn,
                                                active_run.as_ref(),
                                                "JOB_DETAIL_CAPTURED",
                                                None,
                                                Some(&payload.encrypt_job_id),
                                                &format!("filter recompute failed: {err}"),
                                                Some(&payload.zp_data),
                                            );
                                        }
                                    }
                                    Err(err) => {
                                        record_collection_failure(
                                            conn,
                                            active_run.as_ref(),
                                            "JOB_DETAIL_CAPTURED",
                                            None,
                                            Some(&payload.encrypt_job_id),
                                            &format!("db upsert job failed: {err}"),
                                            Some(&payload.zp_data),
                                        );
                                        let _ = ipc::emit_event_all(
                                            &app_handle,
                                            &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                                                message: format!("db upsert job failed: {err}"),
                                                stack: None,
                                            }),
                                        );
                                    }
                                }
                            }
                        }
                        EventOut::JobNormalizedCaptured(payload) => {
                            if let Some(active_run) = active_run.as_ref() {
                                let _ = models::increment_collection_counter(
                                    conn,
                                    &active_run.id,
                                    models::CollectionCounter::Captured,
                                    1,
                                );
                            }
                            let filters_json = payload
                                .filters
                                .as_ref()
                                .and_then(|v| serde_json::to_string(v).ok());
                            let input = models::NormalizedJobInput {
                                encrypt_job_id: payload.encrypt_job_id.clone(),
                                source_platform: payload.source_platform.clone(),
                                source_url: payload.source_url.clone(),
                                dedup_key: payload.dedup_key.clone(),
                                position_name: payload.position_name.clone(),
                                boss_name: payload.boss_name.clone(),
                                brand_name: payload.brand_name.clone(),
                                city_name: payload.city_name.clone(),
                                salary_desc: payload.salary_desc.clone(),
                                experience_name: payload.experience_name.clone(),
                                degree_name: payload.degree_name.clone(),
                                jd_text: payload.jd_text.clone(),
                                raw_payload: payload.raw_payload.clone(),
                            };
                            match models::upsert_job_from_normalized_with_outcome(conn, &input) {
                                Ok(outcome) => {
                                    if let Some(active_run) = active_run.as_ref() {
                                        let _ = models::increment_collection_counter(
                                            conn,
                                            &active_run.id,
                                            outcome.counter(),
                                            1,
                                        );
                                        if matches!(
                                            outcome.counter(),
                                            models::CollectionCounter::Inserted
                                        ) {
                                            request_stop_when_ready(&active_collection_run, &inner);
                                        }
                                    }
                                }
                                Err(err) => {
                                    record_collection_failure(
                                        conn,
                                        active_run.as_ref(),
                                        "JOB_NORMALIZED_CAPTURED",
                                        payload.keyword.as_deref(),
                                        Some(&payload.encrypt_job_id),
                                        &format!("db upsert normalized job failed: {err}"),
                                        Some(&payload.raw_payload),
                                    );
                                    let _ = ipc::emit_event_all(
                                        &app_handle,
                                        &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                                            message: format!(
                                                "db upsert normalized job failed: {err}"
                                            ),
                                            stack: None,
                                        }),
                                    );
                                    continue;
                                }
                            }
                            if let Err(err) =
                                filter_profile::recompute_default_filter_profile_for_job_on_conn(
                                    conn,
                                    &payload.encrypt_job_id,
                                )
                            {
                                record_collection_failure(
                                    conn,
                                    active_run.as_ref(),
                                    "JOB_NORMALIZED_CAPTURED",
                                    payload.keyword.as_deref(),
                                    Some(&payload.encrypt_job_id),
                                    &format!("filter recompute failed: {err}"),
                                    Some(&payload.raw_payload),
                                );
                            }
                            let _ = models::insert_job_source_link(
                                conn,
                                &payload.encrypt_job_id,
                                payload.keyword.as_deref(),
                                filters_json.as_deref(),
                            );
                        }
                        EventOut::JobListCaptured(payload) => {
                            let jobs = extract_job_items_from_joblist(&payload.raw);
                            if let Some(active_run) = active_run.as_ref() {
                                let _ = models::increment_collection_counter(
                                    conn,
                                    &active_run.id,
                                    models::CollectionCounter::Captured,
                                    jobs.len() as i64,
                                );
                            }
                            let filters_json = payload
                                .filters
                                .as_ref()
                                .and_then(|v| serde_json::to_string(v).ok());
                            for item in jobs {
                                let Some(id) = item.encrypt_job_id.as_deref() else {
                                    record_collection_failure(
                                        conn,
                                        active_run.as_ref(),
                                        "JOB_LIST_CAPTURED",
                                        payload.keyword.as_deref(),
                                        None,
                                        "missing stable job id",
                                        Some(&item.raw),
                                    );
                                    continue;
                                };
                                match models::upsert_job_from_list_item_with_outcome(
                                    conn, id, &item.raw,
                                ) {
                                    Ok(outcome) => {
                                        if let Some(active_run) = active_run.as_ref() {
                                            let _ = models::increment_collection_counter(
                                                conn,
                                                &active_run.id,
                                                outcome.counter(),
                                                1,
                                            );
                                            if matches!(
                                                outcome.counter(),
                                                models::CollectionCounter::Inserted
                                            ) {
                                                request_stop_when_ready(
                                                    &active_collection_run,
                                                    &inner,
                                                );
                                            }
                                        }
                                    }
                                    Err(err) => {
                                        record_collection_failure(
                                            conn,
                                            active_run.as_ref(),
                                            "JOB_LIST_CAPTURED",
                                            payload.keyword.as_deref(),
                                            Some(id),
                                            &format!("db upsert list job failed: {err}"),
                                            Some(&item.raw),
                                        );
                                        continue;
                                    }
                                }
                                let _ = models::insert_job_source_link(
                                    conn,
                                    id,
                                    payload.keyword.as_deref(),
                                    filters_json.as_deref(),
                                );
                                if let Err(err) =
                                    filter_profile::recompute_default_filter_profile_for_job_on_conn(
                                        conn, id,
                                    )
                                {
                                    record_collection_failure(
                                        conn,
                                        active_run.as_ref(),
                                        "JOB_LIST_CAPTURED",
                                        payload.keyword.as_deref(),
                                        Some(id),
                                        &format!("filter recompute failed: {err}"),
                                        Some(&item.raw),
                                    );
                                }
                            }
                        }
                        EventOut::BossChatStatusSynced(payload) => {
                            if !matches!(
                                payload.communication_status.as_str(),
                                "greeted_unread" | "read_no_reply" | "replied" | "rejected"
                            ) {
                                let _ = ipc::emit_event_all(
                                    &app_handle,
                                    &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                                        message: format!(
                                            "unknown boss chat communication status: {}",
                                            payload.communication_status
                                        ),
                                        stack: None,
                                    }),
                                );
                                continue;
                            }
                            if !local_job_exists(conn, &payload.encrypt_job_id) {
                                continue;
                            }
                            let last_greeted_at =
                                if payload.communication_status == "greeted_unread" {
                                    Some(now_rfc3339())
                                } else {
                                    None
                                };
                            if let Err(err) = models::upsert_job_review_state(
                                conn,
                                &payload.encrypt_job_id,
                                None,
                                Some(&payload.communication_status),
                                last_greeted_at.as_deref(),
                                None,
                            ) {
                                let _ = ipc::emit_event_all(
                                    &app_handle,
                                    &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                                        message: format!("db sync boss chat status failed: {err}"),
                                        stack: None,
                                    }),
                                );
                                continue;
                            }
                            let _ =
                                filter_profile::recompute_default_filter_profile_for_job_on_conn(
                                    conn,
                                    &payload.encrypt_job_id,
                                );
                        }
                        EventOut::JobFiltered(payload) => {
                            let fallback_id =
                                payload.raw.as_ref().and_then(extract_job_id_from_list_item);
                            let encrypt_job_id =
                                payload.encrypt_job_id.as_deref().or(fallback_id.as_deref());
                            if let Some(encrypt_job_id) = encrypt_job_id {
                                if let Some(raw) = payload.raw.as_ref() {
                                    let filters_json = payload
                                        .filters
                                        .as_ref()
                                        .and_then(|v| serde_json::to_string(v).ok());
                                    match models::upsert_job_from_list_item_with_outcome(
                                        conn,
                                        encrypt_job_id,
                                        raw,
                                    ) {
                                        Ok(outcome) => {
                                            if let Some(active_run) = active_run.as_ref() {
                                                let _ = models::increment_collection_counter(
                                                    conn,
                                                    &active_run.id,
                                                    outcome.counter(),
                                                    1,
                                                );
                                            }
                                        }
                                        Err(err) => {
                                            record_collection_failure(
                                                conn,
                                                active_run.as_ref(),
                                                "JOB_FILTERED",
                                                payload.keyword.as_deref(),
                                                Some(encrypt_job_id),
                                                &format!("db upsert filtered job failed: {err}"),
                                                Some(raw),
                                            );
                                            continue;
                                        }
                                    }
                                    let _ = models::insert_job_source_link(
                                        conn,
                                        encrypt_job_id,
                                        payload.keyword.as_deref(),
                                        filters_json.as_deref(),
                                    );
                                    if let Err(err) =
                                        filter_profile::recompute_default_filter_profile_for_job_on_conn(conn, encrypt_job_id)
                                    {
                                        record_collection_failure(
                                            conn,
                                            active_run.as_ref(),
                                            "JOB_FILTERED",
                                            payload.keyword.as_deref(),
                                            Some(encrypt_job_id),
                                            &format!("filter recompute failed: {err}"),
                                            Some(raw),
                                        );
                                    }
                                } else {
                                    let profile_id = models::load_default_filter_profile(conn)
                                        .map(|profile| profile.id)
                                        .unwrap_or_else(|_| {
                                            models::DEFAULT_FILTER_PROFILE_ID.to_string()
                                        });
                                    let _ = models::upsert_job_filter_result(
                                        conn,
                                        encrypt_job_id,
                                        &profile_id,
                                        false,
                                        &payload.reason,
                                    );
                                }
                            }
                        }
                        EventOut::Error(payload) => {
                            if let Some(active_run) = active_run.as_ref() {
                                let _ = models::record_collection_failure(
                                    conn,
                                    &models::NewCollectionFailure {
                                        run_id: Some(&active_run.id),
                                        source_platform: Some(&active_run.source_platform),
                                        event_type: "ERROR",
                                        keyword: None,
                                        encrypt_job_id: None,
                                        reason: &payload.message,
                                        raw_payload: None,
                                    },
                                );
                                let _ = models::fail_collection_run(
                                    conn,
                                    &active_run.id,
                                    &payload.message,
                                );
                            }
                        }
                        EventOut::Finished => {
                            if let Some(active_run) = active_run.as_ref() {
                                if let Ok(counts) =
                                    filter_profile::count_filter_buckets_on_conn(conn)
                                {
                                    let _ = models::refresh_collection_run_bucket_counts(
                                        conn,
                                        &active_run.id,
                                        counts,
                                    );
                                }
                                let _ = models::finish_collection_run(conn, &active_run.id, None);
                                if active_run.source_platform == "boss"
                                    || active_run.source_platform == "v2ex"
                                {
                                    auto_recompute_ai_after_collection(&app_handle);
                                }
                                if let Ok(mut guard) = active_collection_run.lock() {
                                    if guard.as_ref().map(|run| run.id.as_str())
                                        == Some(active_run.id.as_str())
                                    {
                                        *guard = None;
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }

            let orphan_run = active_collection_run
                .lock()
                .ok()
                .and_then(|mut guard| guard.take());
            if let Some(active_run) = orphan_run {
                let message = "worker exited before FINISHED";
                if let Some(conn) = conn.as_ref() {
                    let _ = models::record_collection_failure(
                        conn,
                        &models::NewCollectionFailure {
                            run_id: Some(&active_run.id),
                            source_platform: Some(&active_run.source_platform),
                            event_type: "WORKER_EXIT",
                            keyword: None,
                            encrypt_job_id: None,
                            reason: message,
                            raw_payload: None,
                        },
                    );
                    let _ = models::fail_collection_run(conn, &active_run.id, message);
                }
                let _ = ipc::emit_event_all(
                    &app_handle,
                    &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                        message: format!("{}: {}", message, active_run.source_platform),
                        stack: None,
                    }),
                );
                let _ = ipc::emit_event_all(&app_handle, &EventOut::Finished);
            }

            if let Ok(mut guard) = inner.lock() {
                if let Some(mut running) = guard.take() {
                    let _ = running.child.wait();
                }
            }
        });

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| SidecarError::Message("sidecar lock poisoned".into()))?;
        *guard = Some(RunningSidecar { child, stdin });
        Ok(())
    }

    pub fn send(&self, cmd: &CommandIn) -> Result<()> {
        self.start_if_needed()?;

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| SidecarError::Message("sidecar lock poisoned".into()))?;
        let Some(running) = guard.as_mut() else {
            return Err(SidecarError::Message("sidecar not running".into()));
        };

        if let Ok(Some(_)) = running.child.try_wait() {
            let _ = running.child.wait();
            *guard = None;
            return Err(SidecarError::Message("sidecar exited".into()));
        }

        let next_run = match cmd {
            CommandIn::CrawlAutoStart(payload) => {
                payload.run_id.as_ref().map(|run_id| ActiveCollectionRun {
                    id: run_id.clone(),
                    source_platform: payload
                        .task
                        .source_platform
                        .clone()
                        .unwrap_or_else(|| "boss".to_string()),
                    max_jobs: extract_max_jobs(&payload.task.limits),
                    inserted_count: 0,
                    stop_sent: false,
                })
            }
            _ => None,
        };
        let line = serde_json::to_string(cmd)?;
        if let Some(next_run) = next_run.clone() {
            if let Ok(mut guard) = self.active_collection_run.lock() {
                *guard = Some(next_run);
            }
        }
        if let Err(err) = running.stdin.write_all(format!("{line}\n").as_bytes()) {
            if next_run.is_some() {
                if let Ok(mut guard) = self.active_collection_run.lock() {
                    *guard = None;
                }
            }
            return Err(err.into());
        }
        running.stdin.flush().ok();
        Ok(())
    }
}
