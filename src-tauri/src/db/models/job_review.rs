use rusqlite::{params, Connection};

use crate::db::Result;

use super::common::now_rfc3339;

pub(crate) const BLACKLIST_KIND_COMPANY: &str = "company";
pub(crate) const BLACKLIST_KIND_JOB: &str = "job";
pub(crate) const BLACKLIST_KIND_KEYWORD: &str = "keyword";

pub(crate) fn upsert_company_review_state(
    conn: &Connection,
    company_name: &str,
    review_status: &str,
    notes: Option<&str>,
) -> Result<()> {
    let updated_at = now_rfc3339();
    conn.execute(
        r#"
    INSERT INTO company_review_state (
      company_name,
      review_status,
      notes,
      updated_at
    )
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(company_name) DO UPDATE SET
      review_status = excluded.review_status,
      notes = excluded.notes,
      updated_at = excluded.updated_at
    "#,
        params![company_name, review_status, notes, updated_at],
    )?;
    Ok(())
}

pub(crate) fn upsert_job_review_state(
    conn: &Connection,
    encrypt_job_id: &str,
    review_status: Option<&str>,
    communication_status: Option<&str>,
    last_greeted_at: Option<&str>,
    notes: Option<&str>,
) -> Result<()> {
    let updated_at = now_rfc3339();
    let next_last_greeted_at = match communication_status {
        Some("not_contacted") => None,
        Some("greeted_unread") => last_greeted_at
            .map(str::to_string)
            .or_else(|| Some(updated_at.clone())),
        Some(_) => last_greeted_at.map(str::to_string),
        None => last_greeted_at.map(str::to_string),
    };
    conn.execute(
        r#"
    INSERT INTO job_review_state (
      encrypt_job_id,
      review_status,
      communication_status,
      last_greeted_at,
      notes,
      updated_at
    )
    VALUES (
      ?1,
      COALESCE(?2, 'pending'),
      COALESCE(?3, 'not_contacted'),
      ?4,
      ?5,
      ?6
    )
    ON CONFLICT(encrypt_job_id) DO UPDATE SET
      review_status = COALESCE(?2, job_review_state.review_status),
      communication_status = COALESCE(?3, job_review_state.communication_status),
      last_greeted_at = CASE
        WHEN ?3 = 'not_contacted' THEN NULL
        WHEN ?4 IS NOT NULL THEN ?4
        ELSE job_review_state.last_greeted_at
      END,
      notes = COALESCE(?5, job_review_state.notes),
      updated_at = excluded.updated_at
    "#,
        params![
            encrypt_job_id,
            review_status,
            communication_status,
            next_last_greeted_at,
            notes,
            updated_at,
        ],
    )?;
    Ok(())
}

pub(crate) fn set_job_review_notes(
    conn: &Connection,
    encrypt_job_id: &str,
    notes: Option<&str>,
) -> Result<()> {
    let updated_at = now_rfc3339();
    conn.execute(
        r#"
    INSERT INTO job_review_state (
      encrypt_job_id,
      review_status,
      communication_status,
      last_greeted_at,
      notes,
      updated_at
    )
    VALUES (?1, 'pending', 'not_contacted', NULL, ?2, ?3)
    ON CONFLICT(encrypt_job_id) DO UPDATE SET
      notes = excluded.notes,
      updated_at = excluded.updated_at
    "#,
        params![encrypt_job_id, notes, updated_at],
    )?;
    Ok(())
}

pub(crate) fn upsert_job_blacklist(
    conn: &Connection,
    kind: &str,
    value: &str,
    reason: Option<&str>,
) -> Result<()> {
    let created_at = now_rfc3339();
    conn.execute(
        r#"
    INSERT INTO job_blacklist (kind, value, reason, created_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(kind, value) DO UPDATE SET
      reason = COALESCE(excluded.reason, job_blacklist.reason),
      created_at = excluded.created_at
    "#,
        params![kind, value, reason, created_at],
    )?;
    Ok(())
}
