use std::{
    collections::HashSet,
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
    commands::filter_profile,
    db,
    db::models,
    ipc,
    ipc::protocol::{CommandIn, EventOut},
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

fn local_job_exists(conn: &rusqlite::Connection, encrypt_job_id: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM job WHERE encrypt_job_id = ?1)",
        params![encrypt_job_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|exists| exists != 0)
    .unwrap_or(false)
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

fn extract_jobs_from_joblist(raw: &Value) -> Vec<(String, Value)> {
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
        let Some(id) = extract_job_id_from_list_item(it) else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        out.push((id, it.clone()));
    }
    out
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

pub struct SidecarManager {
    app_handle: tauri::AppHandle,
    app_data_dir: PathBuf,
    inner: Arc<Mutex<Option<RunningSidecar>>>,
}

impl SidecarManager {
    pub fn new(app_handle: tauri::AppHandle, app_data_dir: PathBuf) -> Self {
        Self {
            app_handle,
            app_data_dir,
            inner: Arc::new(Mutex::new(None)),
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
                    match &evt {
                        EventOut::JobDetailCaptured(payload) => {
                            if let Ok(zp_json) = serde_json::to_string(&payload.zp_data) {
                                if let Err(err) = models::upsert_job_from_detail(
                                    conn,
                                    &payload.encrypt_job_id,
                                    &zp_json,
                                ) {
                                    let _ = ipc::emit_event_all(
                                        &app_handle,
                                        &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                                            message: format!("db upsert job failed: {err}"),
                                            stack: None,
                                        }),
                                    );
                                } else {
                                    let _ =
                                        filter_profile::recompute_default_filter_profile_for_job_on_conn(
                                            conn,
                                            &payload.encrypt_job_id,
                                        );
                                }
                            }
                        }
                        EventOut::JobNormalizedCaptured(payload) => {
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
                            if let Err(err) = models::upsert_job_from_normalized(conn, &input) {
                                let _ = ipc::emit_event_all(
                                    &app_handle,
                                    &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                                        message: format!("db upsert normalized job failed: {err}"),
                                        stack: None,
                                    }),
                                );
                                continue;
                            }
                            let _ = models::insert_job_source_link(
                                conn,
                                &payload.encrypt_job_id,
                                payload.keyword.as_deref(),
                                filters_json.as_deref(),
                            );
                            let _ =
                                filter_profile::recompute_default_filter_profile_for_job_on_conn(
                                    conn,
                                    &payload.encrypt_job_id,
                                );
                        }
                        EventOut::JobListCaptured(payload) => {
                            let jobs = extract_jobs_from_joblist(&payload.raw);
                            let filters_json = payload
                                .filters
                                .as_ref()
                                .and_then(|v| serde_json::to_string(v).ok());
                            for (id, item) in jobs {
                                let upserted =
                                    models::upsert_job_from_list_item(conn, &id, &item).is_ok();
                                let _ = models::insert_job_source_link(
                                    conn,
                                    &id,
                                    payload.keyword.as_deref(),
                                    filters_json.as_deref(),
                                );
                                if upserted {
                                    let _ = filter_profile::recompute_default_filter_profile_for_job_on_conn(conn, &id);
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
                                    let _ = models::upsert_job_from_list_item(
                                        conn,
                                        encrypt_job_id,
                                        raw,
                                    );
                                    let _ = models::insert_job_source_link(
                                        conn,
                                        encrypt_job_id,
                                        payload.keyword.as_deref(),
                                        filters_json.as_deref(),
                                    );
                                    let _ = filter_profile::recompute_default_filter_profile_for_job_on_conn(conn, encrypt_job_id);
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
                        _ => {}
                    }
                }
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

        let line = serde_json::to_string(cmd)?;
        running.stdin.write_all(format!("{line}\n").as_bytes())?;
        running.stdin.flush().ok();
        Ok(())
    }
}
