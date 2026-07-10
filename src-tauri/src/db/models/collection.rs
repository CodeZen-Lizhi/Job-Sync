use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use time::OffsetDateTime;

use crate::db::Result;

use super::common::now_rfc3339;

#[derive(Debug, Clone, Copy)]
pub(crate) enum CollectionCounter {
    Captured,
    Inserted,
    Updated,
    Duplicate,
    Failed,
}

impl CollectionCounter {
    fn column(self) -> &'static str {
        match self {
            Self::Captured => "captured",
            Self::Inserted => "inserted",
            Self::Updated => "updated",
            Self::Duplicate => "duplicate",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JobUpsertOutcome {
    Inserted,
    Updated,
    Duplicate,
}

impl JobUpsertOutcome {
    pub(crate) fn counter(self) -> CollectionCounter {
        match self {
            Self::Inserted => CollectionCounter::Inserted,
            Self::Updated => CollectionCounter::Updated,
            Self::Duplicate => CollectionCounter::Duplicate,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct BucketCounts {
    pub recommended: i64,
    pub pending: i64,
    pub filtered: i64,
    pub processed: i64,
    pub all: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectionRun {
    pub id: String,
    pub batch_id: Option<String>,
    pub source_platform: String,
    pub keywords_json: String,
    pub filters_json: Option<String>,
    pub limits_json: Option<String>,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub error_message: Option<String>,
    pub captured: i64,
    pub inserted: i64,
    pub updated: i64,
    pub duplicate: i64,
    pub recommended: i64,
    pub pending: i64,
    pub filtered: i64,
    pub failed: i64,
    pub processed: i64,
    pub all_jobs: i64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct CollectionBatchSummary {
    pub batch_id: String,
    pub captured: i64,
    pub inserted: i64,
    pub not_inserted: i64,
    pub passed: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectionFailure {
    pub id: i64,
    pub run_id: Option<String>,
    pub source_platform: Option<String>,
    pub event_type: String,
    pub keyword: Option<String>,
    pub encrypt_job_id: Option<String>,
    pub reason: String,
    pub raw_payload_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug)]
pub(crate) struct NewCollectionRun<'a> {
    pub id: &'a str,
    pub batch_id: Option<&'a str>,
    pub source_platform: &'a str,
    pub keywords: &'a [String],
    pub filters: &'a Value,
    pub limits: &'a Value,
}

#[derive(Debug)]
pub(crate) struct NewCollectionFailure<'a> {
    pub run_id: Option<&'a str>,
    pub source_platform: Option<&'a str>,
    pub event_type: &'a str,
    pub keyword: Option<&'a str>,
    pub encrypt_job_id: Option<&'a str>,
    pub reason: &'a str,
    pub raw_payload: Option<&'a Value>,
}

pub(crate) fn new_collection_run_id() -> String {
    format!("run_{}", OffsetDateTime::now_utc().unix_timestamp_nanos())
}

pub(crate) fn create_collection_run(conn: &Connection, input: &NewCollectionRun<'_>) -> Result<()> {
    let keywords_json = serde_json::to_string(input.keywords).unwrap_or_else(|_| "[]".to_string());
    let filters_json = serde_json::to_string(input.filters).unwrap_or_else(|_| "{}".to_string());
    let limits_json = serde_json::to_string(input.limits).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        r#"
        INSERT INTO collection_run (
          id, batch_id, source_platform, keywords_json, filters_json, limits_json, status, started_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?7)
        "#,
        params![
            input.id,
            input.batch_id,
            input.source_platform,
            keywords_json,
            filters_json,
            limits_json,
            now_rfc3339(),
        ],
    )?;
    Ok(())
}

pub(crate) fn fail_stale_running_collection_runs(conn: &Connection, reason: &str) -> Result<usize> {
    let changed = conn.execute(
        r#"
        UPDATE collection_run
        SET status = 'failed',
            finished_at = COALESCE(finished_at, ?1),
            error_message = COALESCE(error_message, ?2)
        WHERE status = 'running'
        "#,
        params![now_rfc3339(), reason],
    )?;
    Ok(changed)
}

pub(crate) fn increment_collection_counter(
    conn: &Connection,
    run_id: &str,
    counter: CollectionCounter,
    amount: i64,
) -> Result<()> {
    if amount <= 0 {
        return Ok(());
    }
    let sql = format!(
        "UPDATE collection_run SET {} = {} + ?2 WHERE id = ?1",
        counter.column(),
        counter.column()
    );
    conn.execute(&sql, params![run_id, amount])?;
    Ok(())
}

pub(crate) fn record_collection_run_job_inserted(
    conn: &Connection,
    run_id: &str,
    encrypt_job_id: &str,
) -> Result<()> {
    let clean_id = encrypt_job_id.trim();
    if clean_id.is_empty() {
        return Ok(());
    }
    conn.execute(
        r#"
        INSERT INTO collection_run_job (run_id, encrypt_job_id, outcome, created_at)
        VALUES (?1, ?2, 'inserted', ?3)
        ON CONFLICT(run_id, encrypt_job_id, outcome) DO NOTHING
        "#,
        params![run_id, clean_id, now_rfc3339()],
    )?;
    Ok(())
}

pub(crate) fn record_collection_failure(
    conn: &Connection,
    input: &NewCollectionFailure<'_>,
) -> Result<()> {
    let raw_payload_json = input
        .raw_payload
        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()));
    conn.execute(
        r#"
        INSERT INTO collection_failure (
          run_id, source_platform, event_type, keyword, encrypt_job_id,
          reason, raw_payload_json, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            input.run_id,
            input.source_platform,
            input.event_type,
            input.keyword,
            input.encrypt_job_id,
            input.reason,
            raw_payload_json,
            now_rfc3339(),
        ],
    )?;
    if let Some(run_id) = input.run_id {
        increment_collection_counter(conn, run_id, CollectionCounter::Failed, 1)?;
    }
    Ok(())
}

pub(crate) fn refresh_collection_run_bucket_counts(
    conn: &Connection,
    run_id: &str,
    counts: BucketCounts,
) -> Result<()> {
    conn.execute(
        r#"
        UPDATE collection_run
        SET recommended = ?2,
            pending = ?3,
            filtered = ?4,
            processed = ?5,
            all_jobs = ?6
        WHERE id = ?1
        "#,
        params![
            run_id,
            counts.recommended,
            counts.pending,
            counts.filtered,
            counts.processed,
            counts.all,
        ],
    )?;
    Ok(())
}

pub(crate) fn finish_collection_run(
    conn: &Connection,
    run_id: &str,
    error_message: Option<&str>,
) -> Result<()> {
    let status = if error_message.is_some() {
        "failed"
    } else {
        "finished"
    };
    conn.execute(
        r#"
        UPDATE collection_run
        SET status = ?2,
            finished_at = COALESCE(finished_at, ?3),
            error_message = COALESCE(?4, error_message)
        WHERE id = ?1 AND status = 'running'
        "#,
        params![run_id, status, now_rfc3339(), error_message],
    )?;
    Ok(())
}

pub(crate) fn fail_collection_run(
    conn: &Connection,
    run_id: &str,
    error_message: &str,
) -> Result<()> {
    conn.execute(
        r#"
        UPDATE collection_run
        SET status = 'failed',
            finished_at = COALESCE(finished_at, ?2),
            error_message = COALESCE(error_message, ?3)
        WHERE id = ?1
        "#,
        params![run_id, now_rfc3339(), error_message],
    )?;
    Ok(())
}

pub fn list_collection_runs(conn: &Connection, limit: Option<u32>) -> Result<Vec<CollectionRun>> {
    let limit = limit.unwrap_or(10).clamp(1, 100);
    let mut stmt = conn.prepare(
        r#"
        SELECT id, batch_id, source_platform, keywords_json, filters_json, limits_json,
               status, started_at, finished_at, error_message,
               captured, inserted, updated, duplicate,
               recommended, pending, filtered, failed, processed, all_jobs
        FROM collection_run
        ORDER BY started_at DESC
        LIMIT ?1
        "#,
    )?;
    let rows = stmt.query_map([limit], |row| {
        Ok(CollectionRun {
            id: row.get(0)?,
            batch_id: row.get(1)?,
            source_platform: row.get(2)?,
            keywords_json: row.get(3)?,
            filters_json: row.get(4)?,
            limits_json: row.get(5)?,
            status: row.get(6)?,
            started_at: row.get(7)?,
            finished_at: row.get(8)?,
            error_message: row.get(9)?,
            captured: row.get(10)?,
            inserted: row.get(11)?,
            updated: row.get(12)?,
            duplicate: row.get(13)?,
            recommended: row.get(14)?,
            pending: row.get(15)?,
            filtered: row.get(16)?,
            failed: row.get(17)?,
            processed: row.get(18)?,
            all_jobs: row.get(19)?,
        })
    })?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

pub fn get_collection_batch_summary(
    conn: &Connection,
    batch_id: &str,
) -> Result<CollectionBatchSummary> {
    Ok(conn.query_row(
        r#"
        WITH batch_runs AS (
          SELECT id, captured, inserted, updated, duplicate
          FROM collection_run
          WHERE batch_id = ?1
             OR ((batch_id IS NULL OR batch_id = '') AND id = ?1)
        ), inserted_jobs AS (
          SELECT DISTINCT crj.encrypt_job_id
          FROM collection_run_job crj
          INNER JOIN batch_runs br ON br.id = crj.run_id
          WHERE crj.outcome = 'inserted'
        )
        SELECT
          COALESCE((SELECT SUM(captured) FROM batch_runs), 0),
          COALESCE((SELECT SUM(inserted) FROM batch_runs), 0),
          COALESCE((SELECT SUM(updated + duplicate) FROM batch_runs), 0),
          COALESCE((
            SELECT COUNT(*)
            FROM inserted_jobs ij
            INNER JOIN job_filter_result r ON r.encrypt_job_id = ij.encrypt_job_id
            WHERE r.eligible = 1
              AND COALESCE(json_extract(r.reason_json, '$.bucket'), 'recommended') = 'recommended'
              AND json_extract(r.reason_json, '$.ai_judgement.status') = 'passed'
          ), 0)
        "#,
        [batch_id],
        |row| {
            Ok(CollectionBatchSummary {
                batch_id: batch_id.to_string(),
                captured: row.get(0)?,
                inserted: row.get(1)?,
                not_inserted: row.get(2)?,
                passed: row.get(3)?,
            })
        },
    )?)
}

pub fn list_collection_run_inserted_job_ids(
    conn: &Connection,
    run_id: &str,
) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT encrypt_job_id
        FROM collection_run_job
        WHERE run_id = ?1 AND outcome = 'inserted'
        ORDER BY created_at ASC, encrypt_job_id ASC
        "#,
    )?;
    let rows = stmt.query_map([run_id], |row| row.get::<_, String>(0))?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

pub fn list_collection_failures(
    conn: &Connection,
    limit: Option<u32>,
) -> Result<Vec<CollectionFailure>> {
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let mut stmt = conn.prepare(
        r#"
        SELECT id, run_id, source_platform, event_type, keyword, encrypt_job_id,
               reason, raw_payload_json, created_at
        FROM collection_failure
        ORDER BY created_at DESC, id DESC
        LIMIT ?1
        "#,
    )?;
    let rows = stmt.query_map([limit], |row| {
        Ok(CollectionFailure {
            id: row.get(0)?,
            run_id: row.get(1)?,
            source_platform: row.get(2)?,
            event_type: row.get(3)?,
            keyword: row.get(4)?,
            encrypt_job_id: row.get(5)?,
            reason: row.get(6)?,
            raw_payload_json: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}
