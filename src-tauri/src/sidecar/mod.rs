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
    commands::filter_profile,
    db,
    db::models,
    ipc,
    ipc::protocol::{CommandIn, EventOut, JobListCapturedPayload, JobNormalizedCapturedPayload},
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

fn note_inserted_and_should_stop(
    active_collection_run: &Arc<Mutex<Option<ActiveCollectionRun>>>,
) -> bool {
    let mut guard = match active_collection_run.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };
    let Some(run) = guard.as_mut() else {
        return false;
    };
    run.note_inserted_and_should_stop()
}

fn request_stop_when_ready(
    active_collection_run: &Arc<Mutex<Option<ActiveCollectionRun>>>,
    inner: &Arc<Mutex<Option<RunningSidecar>>>,
) {
    let should_stop = note_inserted_and_should_stop(active_collection_run);
    if should_stop {
        let _ = send_worker_command(inner, &CommandIn::Stop);
    }
}

fn should_skip_new_insert_for_limit(
    conn: &rusqlite::Connection,
    active_collection_run: &Arc<Mutex<Option<ActiveCollectionRun>>>,
    encrypt_job_id: &str,
) -> bool {
    let limit_reached = active_collection_run
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .as_ref()
                .map(ActiveCollectionRun::insert_limit_reached)
        })
        .unwrap_or(false);
    limit_reached && !local_job_exists(conn, encrypt_job_id)
}

fn persist_job_list_capture(
    conn: &rusqlite::Connection,
    active_run: Option<&ActiveCollectionRun>,
    active_collection_run: &Arc<Mutex<Option<ActiveCollectionRun>>>,
    payload: &JobListCapturedPayload,
) -> bool {
    let mut should_stop_worker = false;
    let jobs = extract_job_items_from_joblist(&payload.raw);
    if let Some(active_run) = active_run {
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
                active_run,
                "JOB_LIST_CAPTURED",
                payload.keyword.as_deref(),
                None,
                "missing stable job id",
                Some(&item.raw),
            );
            continue;
        };
        if should_skip_new_insert_for_limit(conn, active_collection_run, id) {
            break;
        }
        match models::upsert_job_from_list_item_with_outcome(conn, id, &item.raw) {
            Ok(outcome) => {
                if let Some(active_run) = active_run {
                    let _ = models::increment_collection_counter(
                        conn,
                        &active_run.id,
                        outcome.counter(),
                        1,
                    );
                    if matches!(outcome.counter(), models::CollectionCounter::Inserted)
                        && note_inserted_and_should_stop(active_collection_run)
                    {
                        should_stop_worker = true;
                    }
                    if matches!(outcome.counter(), models::CollectionCounter::Inserted) {
                        let _ =
                            models::record_collection_run_job_inserted(conn, &active_run.id, id);
                    }
                }
            }
            Err(err) => {
                record_collection_failure(
                    conn,
                    active_run,
                    "JOB_LIST_CAPTURED",
                    payload.keyword.as_deref(),
                    Some(id),
                    &format!("db upsert list job failed: {err}"),
                    Some(&item.raw),
                );
                continue;
            }
        }
        if let Err(err) = models::insert_job_source_link(
            conn,
            id,
            payload.keyword.as_deref(),
            filters_json.as_deref(),
        ) {
            record_collection_failure(
                conn,
                active_run,
                "JOB_LIST_CAPTURED",
                payload.keyword.as_deref(),
                Some(id),
                &format!("source link insert failed: {err}"),
                Some(&item.raw),
            );
        }
        if let Err(err) = filter_profile::recompute_default_filter_profile_for_job_on_conn(conn, id)
        {
            record_collection_failure(
                conn,
                active_run,
                "JOB_LIST_CAPTURED",
                payload.keyword.as_deref(),
                Some(id),
                &format!("filter recompute failed: {err}"),
                Some(&item.raw),
            );
        }
    }
    should_stop_worker
}

fn persist_normalized_capture(
    conn: &rusqlite::Connection,
    active_run: Option<&ActiveCollectionRun>,
    active_collection_run: &Arc<Mutex<Option<ActiveCollectionRun>>>,
    payload: &JobNormalizedCapturedPayload,
) -> std::result::Result<bool, String> {
    if should_skip_new_insert_for_limit(conn, active_collection_run, &payload.encrypt_job_id) {
        return Ok(false);
    }
    if let Some(active_run) = active_run {
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
    let mut should_stop_worker = false;
    match models::upsert_job_from_normalized_with_outcome(conn, &input) {
        Ok(outcome) => {
            if let Some(active_run) = active_run {
                let _ = models::increment_collection_counter(
                    conn,
                    &active_run.id,
                    outcome.counter(),
                    1,
                );
                if matches!(outcome.counter(), models::CollectionCounter::Inserted) {
                    let _ = models::record_collection_run_job_inserted(
                        conn,
                        &active_run.id,
                        &payload.encrypt_job_id,
                    );
                    should_stop_worker = note_inserted_and_should_stop(active_collection_run);
                }
            }
        }
        Err(err) => {
            let message = format!("db upsert normalized job failed: {err}");
            record_collection_failure(
                conn,
                active_run,
                "JOB_NORMALIZED_CAPTURED",
                payload.keyword.as_deref(),
                Some(&payload.encrypt_job_id),
                &message,
                Some(&payload.raw_payload),
            );
            return Err(message);
        }
    }
    if let Err(err) = filter_profile::recompute_default_filter_profile_for_job_on_conn(
        conn,
        &payload.encrypt_job_id,
    ) {
        record_collection_failure(
            conn,
            active_run,
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
    Ok(should_stop_worker)
}

fn persist_collection_finished(conn: &rusqlite::Connection, active_run: &ActiveCollectionRun) {
    if let Ok(counts) = filter_profile::count_filter_buckets_on_conn(conn) {
        let _ = models::refresh_collection_run_bucket_counts(conn, &active_run.id, counts);
    }
    let _ = models::finish_collection_run(conn, &active_run.id, None);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::protocol::{CrawlAutoStartPayload, SearchTaskPayload, SessionStatePayload};
    use serde_json::json;
    use std::io::BufWriter;

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

    #[test]
    fn active_collection_run_marks_insert_limit_reached_once() {
        let mut run = ActiveCollectionRun {
            id: "run-1".to_string(),
            source_platform: "boss".to_string(),
            max_jobs: Some(2),
            inserted_count: 0,
            stop_sent: false,
        };

        assert!(!run.insert_limit_reached());
        assert!(!run.note_inserted_and_should_stop());
        assert!(!run.insert_limit_reached());
        assert!(run.note_inserted_and_should_stop());
        assert!(run.insert_limit_reached());
        assert!(!run.note_inserted_and_should_stop());
    }

    #[test]
    fn persist_job_list_capture_writes_boss_job_and_run_counters() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");
        let run_id = models::new_collection_run_id();
        models::create_collection_run(
            &conn,
            &models::NewCollectionRun {
                id: &run_id,
                source_platform: "boss",
                keywords: &["Go 远程".to_string()],
                filters: &json!({ "city": "101020100" }),
                limits: &json!({ "maxJobs": 1 }),
            },
        )
        .expect("create run");
        let active_collection_run = Arc::new(Mutex::new(Some(ActiveCollectionRun {
            id: run_id.clone(),
            source_platform: "boss".to_string(),
            max_jobs: Some(1),
            inserted_count: 0,
            stop_sent: false,
        })));
        let active_run = active_collection_run
            .lock()
            .expect("active run lock")
            .clone();
        let payload = JobListCapturedPayload {
            keyword: Some("Go 远程".to_string()),
            filters: Some(json!({ "city": "101020100" })),
            capture_source: Some("natural".to_string()),
            raw: json!({
              "zpData": {
                "query": "Go 远程",
                "page": 1,
                "city": "101020100",
                "jobList": [{
                  "securityId": "canary-sec-1",
                  "encryptJobId": "canary-encrypt-1",
                  "jobName": "Go 远程平台工程师",
                  "brandName": "Canary Tech",
                  "cityName": "上海",
                  "salaryDesc": "30-50K",
                  "jobExperience": "3-5年",
                  "jobDegree": "本科",
                  "skills": ["Go", "Kubernetes"]
                }]
              }
            }),
        };

        let should_stop_worker =
            persist_job_list_capture(&conn, active_run.as_ref(), &active_collection_run, &payload);

        assert!(should_stop_worker);
        let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].id, run_id);
        assert_eq!(runs[0].status, "running");
        assert_eq!(runs[0].captured, 1);
        assert_eq!(runs[0].inserted, 1);
        assert_eq!(runs[0].failed, 0);
        assert_eq!(
            models::list_collection_run_inserted_job_ids(&conn, &run_id)
                .expect("list inserted job ids"),
            vec!["canary-sec-1".to_string()]
        );

        let row: (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                r#"
                SELECT source_platform, source_url, dedup_key, position_name,
                       brand_name, city_name, raw_payload_json
                FROM job
                WHERE encrypt_job_id = ?1
                "#,
                ["canary-sec-1"],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .expect("query job");
        assert_eq!(row.0, "boss");
        assert_eq!(
            row.1.as_deref(),
            Some("https://www.zhipin.com/job_detail/canary-sec-1.html")
        );
        assert_eq!(row.2.as_deref(), Some("canary-sec-1"));
        assert_eq!(row.3.as_deref(), Some("Go 远程平台工程师"));
        assert_eq!(row.4.as_deref(), Some("Canary Tech"));
        assert_eq!(row.5.as_deref(), Some("上海"));
        let raw_payload: serde_json::Value =
            serde_json::from_str(row.6.as_deref().unwrap_or("{}")).expect("parse raw payload");
        assert_eq!(
            raw_payload
                .get("skills")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(2)
        );

        let link: (Option<String>, Option<String>, String) = conn
            .query_row(
                "SELECT keyword, filters_json, captured_at FROM job_source_link WHERE encrypt_job_id = ?1",
                ["canary-sec-1"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("query job source link");
        assert_eq!(link.0.as_deref(), Some("Go 远程"));
        let link_filters: serde_json::Value =
            serde_json::from_str(link.1.as_deref().unwrap_or("{}")).expect("parse link filters");
        assert_eq!(
            link_filters.get("city").and_then(Value::as_str),
            Some("101020100")
        );
        assert!(link.2.as_str() >= runs[0].started_at.as_str());

        let (detail_status, post_description): (String, String) = conn
            .query_row(
                r#"
                SELECT json_extract(zp_data_json, '$.detailStatus'),
                       json_extract(zp_data_json, '$.jobInfo.postDescription')
                FROM job_detail_raw
                WHERE encrypt_job_id = ?1
                "#,
                ["canary-sec-1"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query list-only detail raw");
        assert_eq!(detail_status, "list_only");
        assert!(!post_description.trim().is_empty());

        let filter_result: (i64, String) = conn
            .query_row(
                "SELECT eligible, reason_json FROM job_filter_result WHERE encrypt_job_id = ?1",
                ["canary-sec-1"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query filter result");
        assert_eq!(filter_result.0, 1);
        let reason: serde_json::Value =
            serde_json::from_str(&filter_result.1).expect("parse filter reason");
        assert!(matches!(
            reason.get("bucket").and_then(Value::as_str),
            Some("recommended" | "pending_confirmation" | "filtered")
        ));

        let active_run = active_collection_run
            .lock()
            .expect("active run lock")
            .clone()
            .expect("active run");
        persist_collection_finished(&conn, &active_run);
        let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs after finish");
        assert_eq!(runs[0].status, "finished");
        assert!(runs[0].finished_at.is_some());
        assert!(runs[0].error_message.is_none());
        assert_eq!(runs[0].recommended + runs[0].pending + runs[0].filtered, 1);
        assert_eq!(runs[0].all_jobs, 1);

        let failures = models::list_collection_failures(&conn, Some(5)).expect("list failures");
        assert!(failures.is_empty());
        let terminal_failure_count: i64 = conn
            .query_row(
                r#"
                SELECT COUNT(*)
                FROM collection_failure
                WHERE run_id = ?1
                  AND event_type IN ('ERROR', 'WORKER_EXIT', 'CRAWL_AUTO_START')
                "#,
                [&run_id],
                |row| row.get(0),
            )
            .expect("count terminal failures");
        assert_eq!(terminal_failure_count, 0);
    }

    #[test]
    fn persist_normalized_capture_writes_zhilian_job_and_run_counters() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");
        let run_id = models::new_collection_run_id();
        models::create_collection_run(
            &conn,
            &models::NewCollectionRun {
                id: &run_id,
                source_platform: "zhilian",
                keywords: &["Java".to_string()],
                filters: &json!({ "city": "530" }),
                limits: &json!({ "maxJobs": 20 }),
            },
        )
        .expect("create run");
        let active_collection_run = Arc::new(Mutex::new(Some(ActiveCollectionRun {
            id: run_id.clone(),
            source_platform: "zhilian".to_string(),
            max_jobs: Some(20),
            inserted_count: 0,
            stop_sent: false,
        })));
        let active_run = active_collection_run
            .lock()
            .expect("active run lock")
            .clone();
        let payload = crate::ipc::protocol::JobNormalizedCapturedPayload {
            encrypt_job_id: "zhilian:CCL1405333700J40877845205".to_string(),
            source_platform: "zhilian".to_string(),
            source_url: Some(
                "https://www.zhaopin.com/jobdetail/CCL1405333700J40877845205.htm".to_string(),
            ),
            dedup_key: "CCL1405333700J40877845205".to_string(),
            position_name: Some("java 开发工程师".to_string()),
            boss_name: None,
            brand_name: Some("北京捷科智诚科技有限公司上海分公司".to_string()),
            city_name: Some("北京·顺义·双丰".to_string()),
            salary_desc: Some("1.3-1.7万".to_string()),
            experience_name: Some("3-5年".to_string()),
            degree_name: Some("本科".to_string()),
            jd_text: Some(
                "列表页证据：java 开发工程师 / 北京捷科智诚科技有限公司上海分公司 / 北京·顺义·双丰 / 1.3-1.7万。详情暂未抓取，需打开原岗位确认。"
                    .to_string(),
            ),
            raw_payload: json!({
                "source_platform": "zhilian",
                "detail_status": "missing",
                "tags": ["Java", "本科"]
            }),
            keyword: Some("Java".to_string()),
            filters: Some(json!({ "city": "530" })),
        };
        let should_stop_worker = persist_normalized_capture(
            &conn,
            active_run.as_ref(),
            &active_collection_run,
            &payload,
        )
        .expect("persist normalized capture");
        assert!(!should_stop_worker);
        let active_run = active_collection_run
            .lock()
            .expect("active run lock")
            .clone()
            .expect("active run");
        persist_collection_finished(&conn, &active_run);

        let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs");
        assert_eq!(runs[0].source_platform, "zhilian");
        assert_eq!(runs[0].status, "finished");
        assert_eq!(runs[0].captured, 1);
        assert_eq!(runs[0].inserted, 1);
        assert_eq!(runs[0].failed, 0);
        assert_eq!(
            models::list_collection_run_inserted_job_ids(&conn, &run_id)
                .expect("list inserted job ids"),
            vec!["zhilian:CCL1405333700J40877845205".to_string()]
        );

        let row: (
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                r#"
                SELECT source_platform, source_url, dedup_key, position_name,
                       brand_name, city_name, salary_desc, experience_name, degree_name
                FROM job
                WHERE encrypt_job_id = ?1
                "#,
                ["zhilian:CCL1405333700J40877845205"],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                    ))
                },
            )
            .expect("query zhilian job");
        assert_eq!(row.0, "zhilian");
        assert_eq!(
            row.1.as_deref(),
            Some("https://www.zhaopin.com/jobdetail/CCL1405333700J40877845205.htm")
        );
        assert_eq!(row.2.as_deref(), Some("CCL1405333700J40877845205"));
        assert_eq!(row.3.as_deref(), Some("java 开发工程师"));
        assert_eq!(row.4.as_deref(), Some("北京捷科智诚科技有限公司上海分公司"));
        assert_eq!(row.5.as_deref(), Some("北京·顺义·双丰"));
        assert_eq!(row.6.as_deref(), Some("1.3-1.7万"));
        assert_eq!(row.7.as_deref(), Some("3-5年"));
        assert_eq!(row.8.as_deref(), Some("本科"));

        let link: (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT keyword, filters_json FROM job_source_link WHERE encrypt_job_id = ?1",
                ["zhilian:CCL1405333700J40877845205"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query source link");
        assert_eq!(link.0.as_deref(), Some("Java"));
        let link_filters: serde_json::Value =
            serde_json::from_str(link.1.as_deref().unwrap_or("{}")).expect("parse filters");
        assert_eq!(
            link_filters.get("city").and_then(Value::as_str),
            Some("530")
        );

        let detail_json: String = conn
            .query_row(
                "SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = ?1",
                ["zhilian:CCL1405333700J40877845205"],
                |row| row.get(0),
            )
            .expect("query detail raw");
        let detail: Value = serde_json::from_str(&detail_json).expect("parse detail");
        assert_eq!(
            detail.get("detailStatus").and_then(Value::as_str),
            Some("missing")
        );
        assert_eq!(
            detail.get("sourcePlatform").and_then(Value::as_str),
            Some("zhilian")
        );
        assert!(detail
            .get("jobInfo")
            .and_then(|job_info| job_info.get("postDescription"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .contains("详情暂未抓取"));

        let terminal_failure_count: i64 = conn
            .query_row(
                r#"
                SELECT COUNT(*)
                FROM collection_failure
                WHERE run_id = ?1
                  AND event_type IN ('ERROR', 'WORKER_EXIT', 'CRAWL_AUTO_START')
                "#,
                [&run_id],
                |row| row.get(0),
            )
            .expect("count terminal failures");
        assert_eq!(terminal_failure_count, 0);
    }

    #[test]
    #[ignore = "real Zhilian sidecar canary; requires network and a ready JOB_SYNC_ZHILIAN_CANARY_PROFILE_DIR"]
    fn real_zhilian_worker_events_persist_through_sidecar_path() {
        let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("project root")
            .to_path_buf();
        let resolve_project_path = |value: String| {
            let path = std::path::PathBuf::from(value);
            if path.is_absolute() {
                path
            } else {
                project_root.join(path)
            }
        };
        let profile_dir = std::env::var("JOB_SYNC_ZHILIAN_CANARY_PROFILE_DIR")
            .unwrap_or_else(|_| "data/zhilian-browser-profile".to_string());
        let profile_dir = resolve_project_path(profile_dir);
        let worker_entry = std::env::var("JOB_SYNC_ZHILIAN_CANARY_WORKER_ENTRY")
            .unwrap_or_else(|_| "packages/boss-crawler-worker/dist/main.js".to_string());
        let worker_entry = resolve_project_path(worker_entry);
        let worker_dir = worker_entry
            .parent()
            .and_then(|dist| dist.parent())
            .expect("worker dist parent")
            .to_path_buf();
        assert!(
            profile_dir.is_dir(),
            "Zhilian profile dir not found: {}",
            profile_dir.display()
        );
        assert!(
            worker_entry.is_file(),
            "worker entry not found: {}; run npm -w @job-sync/boss-crawler-worker run build",
            worker_entry.display()
        );

        let canary_data_dir = std::env::var("JOB_SYNC_ZHILIAN_CANARY_DATA_DIR")
            .ok()
            .map(resolve_project_path);
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = canary_data_dir.unwrap_or_else(|| tmp.path().join("app-data"));
        let conn = db::init_db(&app_data_dir).expect("init db");
        let run_id = models::new_collection_run_id();
        models::create_collection_run(
            &conn,
            &models::NewCollectionRun {
                id: &run_id,
                source_platform: "zhilian",
                keywords: &["Java".to_string()],
                filters: &json!({ "city": "530" }),
                limits: &json!({ "maxPages": 1, "maxJobs": 3, "delayMs": 0 }),
            },
        )
        .expect("create run");
        let active_collection_run = Arc::new(Mutex::new(Some(ActiveCollectionRun {
            id: run_id.clone(),
            source_platform: "zhilian".to_string(),
            max_jobs: Some(3),
            inserted_count: 0,
            stop_sent: false,
        })));
        let active_run = active_collection_run
            .lock()
            .expect("active run lock")
            .clone()
            .expect("active run");

        let command = CommandIn::CrawlAutoStart(CrawlAutoStartPayload {
            session: SessionStatePayload {
                cookies: json!([]),
                local_storage: json!({}),
            },
            task: SearchTaskPayload {
                keywords: vec!["Java".to_string()],
                source_platform: Some("zhilian".to_string()),
                filters: json!({ "city": "530" }),
                limits: json!({ "maxPages": 1, "maxJobs": 3, "pageSize": 3, "delayMs": 0 }),
                mode: Some("auto".to_string()),
            },
            run_id: Some(run_id.clone()),
            user_data_dir: Some(profile_dir.to_string_lossy().to_string()),
        });

        let mut child = std::process::Command::new("node")
            .arg(worker_entry)
            .current_dir(worker_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("spawn worker");
        let stdin = child.stdin.take().expect("worker stdin");
        let mut writer = BufWriter::new(stdin);
        let line = serde_json::to_string(&command).expect("serialize command");
        writeln!(writer, "{line}").expect("write worker command");
        writer.flush().expect("flush worker command");

        let stdout = child.stdout.take().expect("worker stdout");
        let reader = BufReader::new(stdout);
        let started = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(120);
        let mut normalized_count = 0;
        let mut finished = false;
        for line in reader.lines() {
            assert!(started.elapsed() < timeout, "real Zhilian canary timed out");
            let line = line.expect("worker stdout line");
            if line.trim().is_empty() {
                continue;
            }
            let event: EventOut = serde_json::from_str(&line)
                .unwrap_or_else(|err| panic!("bad worker json {err}: {line}"));
            match event {
                EventOut::JobNormalizedCaptured(payload) => {
                    persist_normalized_capture(
                        &conn,
                        Some(&active_run),
                        &active_collection_run,
                        &payload,
                    )
                    .expect("persist normalized capture");
                    normalized_count += 1;
                    if normalized_count >= 3 {
                        break;
                    }
                }
                EventOut::Error(payload) => panic!("worker error: {}", payload.message),
                EventOut::Finished => {
                    finished = true;
                    break;
                }
                _ => {}
            }
        }
        drop(writer);
        let _ = child.kill();
        let _ = child.wait();
        persist_collection_finished(&conn, &active_run);

        assert!(normalized_count > 0, "no Zhilian normalized jobs captured");
        let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs");
        assert_eq!(runs[0].id, run_id);
        assert_eq!(runs[0].status, "finished");
        assert!(runs[0].captured >= normalized_count);
        assert!(runs[0].inserted + runs[0].updated + runs[0].duplicate > 0);

        let sample: (
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                r#"
                SELECT j.encrypt_job_id, j.source_platform, j.position_name,
                       j.brand_name, json_extract(d.zp_data_json, '$.detailStatus')
                FROM job j
                JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
                JOIN job_source_link s ON s.encrypt_job_id = j.encrypt_job_id
                WHERE j.source_platform = 'zhilian'
                ORDER BY s.captured_at DESC
                LIMIT 1
                "#,
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("query persisted Zhilian sample");
        assert!(sample.0.starts_with("zhilian:"));
        assert_eq!(sample.1, "zhilian");
        assert!(sample.2.unwrap_or_default().trim().len() > 0);
        assert!(sample.3.unwrap_or_default().trim().len() > 0);
        assert!(matches!(
            sample.4.as_deref(),
            Some("missing" | "blocked" | "detail")
        ));
        assert!(
            finished || normalized_count >= 3,
            "worker did not finish before sample cap"
        );
        eprintln!(
            "real Zhilian sidecar canary db={} run_id={} jobs={normalized_count} sample={}",
            app_data_dir.join("app.db").display(),
            run_id,
            sample.0
        );
    }

    #[test]
    fn persist_job_list_capture_records_missing_stable_id_failure() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");
        let run_id = models::new_collection_run_id();
        models::create_collection_run(
            &conn,
            &models::NewCollectionRun {
                id: &run_id,
                source_platform: "boss",
                keywords: &["Go 远程".to_string()],
                filters: &json!({}),
                limits: &json!({ "maxJobs": 1 }),
            },
        )
        .expect("create run");
        let active_collection_run = Arc::new(Mutex::new(Some(ActiveCollectionRun {
            id: run_id.clone(),
            source_platform: "boss".to_string(),
            max_jobs: Some(1),
            inserted_count: 0,
            stop_sent: false,
        })));
        let active_run = active_collection_run
            .lock()
            .expect("active run lock")
            .clone();
        let payload = JobListCapturedPayload {
            keyword: Some("Go 远程".to_string()),
            filters: None,
            capture_source: Some("natural".to_string()),
            raw: json!({
              "zpData": {
                "jobList": [{
                  "jobName": "缺少 ID 的岗位",
                  "brandName": "No Id Co"
                }]
              }
            }),
        };

        let should_stop_worker =
            persist_job_list_capture(&conn, active_run.as_ref(), &active_collection_run, &payload);

        assert!(!should_stop_worker);
        let job_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM job", [], |row| row.get(0))
            .expect("count jobs");
        assert_eq!(job_count, 0);
        let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs");
        assert_eq!(runs[0].captured, 1);
        assert_eq!(runs[0].inserted, 0);
        assert_eq!(runs[0].failed, 1);
        let failures = models::list_collection_failures(&conn, Some(5)).expect("list failures");
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].run_id.as_deref(), Some(run_id.as_str()));
        assert_eq!(failures[0].source_platform.as_deref(), Some("boss"));
        assert_eq!(failures[0].event_type, "JOB_LIST_CAPTURED");
        assert_eq!(failures[0].keyword.as_deref(), Some("Go 远程"));
        assert_eq!(failures[0].reason, "missing stable job id");
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
    fn insert_limit_reached(&self) -> bool {
        self.max_jobs
            .map(|max_jobs| self.inserted_count >= max_jobs)
            .unwrap_or(false)
    }

    fn note_inserted_and_should_stop(&mut self) -> bool {
        self.inserted_count += 1;
        if self.stop_sent {
            return false;
        }
        if self.insert_limit_reached() {
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

    pub fn stop_collection_by_user(&self) -> Result<()> {
        let active_run = self
            .active_collection_run
            .lock()
            .ok()
            .and_then(|guard| guard.clone());
        if let Some(active_run) = active_run.as_ref() {
            if let Ok(conn) = db::init_db(&self.app_data_dir) {
                let reason = "用户已停止采集";
                record_collection_failure(
                    &conn,
                    Some(active_run),
                    "STOP",
                    None,
                    None,
                    reason,
                    None,
                );
                let _ = models::fail_collection_run(&conn, &active_run.id, reason);
            }
        }
        self.send(&CommandIn::Stop)
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
                        let platform = payload.source_platform.as_deref().unwrap_or("boss");
                        let (cookies_path, local_storage_path) = match platform {
                            "linuxdo" => (
                                storage::linuxdo_cookies_path(&app_data_dir),
                                storage::linuxdo_local_storage_path(&app_data_dir),
                            ),
                            "zhilian" => (
                                storage::zhilian_cookies_path(&app_data_dir),
                                storage::zhilian_local_storage_path(&app_data_dir),
                            ),
                            _ => (
                                storage::boss_cookies_path(&app_data_dir),
                                storage::boss_local_storage_path(&app_data_dir),
                            ),
                        };
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
                            if should_skip_new_insert_for_limit(
                                conn,
                                &active_collection_run,
                                &payload.encrypt_job_id,
                            ) {
                                continue;
                            }
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
                                                let _ = models::record_collection_run_job_inserted(
                                                    conn,
                                                    &active_run.id,
                                                    &payload.encrypt_job_id,
                                                );
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
                            match persist_normalized_capture(
                                conn,
                                active_run.as_ref(),
                                &active_collection_run,
                                payload,
                            ) {
                                Ok(true) => {
                                    let _ = send_worker_command(&inner, &CommandIn::Stop);
                                }
                                Ok(false) => {}
                                Err(err) => {
                                    let _ = ipc::emit_event_all(
                                        &app_handle,
                                        &EventOut::Error(crate::ipc::protocol::ErrorPayload {
                                            message: err,
                                            stack: None,
                                        }),
                                    );
                                    continue;
                                }
                            }
                        }
                        EventOut::JobListCaptured(payload) => {
                            if persist_job_list_capture(
                                conn,
                                active_run.as_ref(),
                                &active_collection_run,
                                payload,
                            ) {
                                let _ = send_worker_command(&inner, &CommandIn::Stop);
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
                                    if should_skip_new_insert_for_limit(
                                        conn,
                                        &active_collection_run,
                                        encrypt_job_id,
                                    ) {
                                        continue;
                                    }
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
                                                if matches!(
                                                    outcome.counter(),
                                                    models::CollectionCounter::Inserted
                                                ) {
                                                    let _ =
                                                        models::record_collection_run_job_inserted(
                                                            conn,
                                                            &active_run.id,
                                                            encrypt_job_id,
                                                        );
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
                                persist_collection_finished(conn, active_run);
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
