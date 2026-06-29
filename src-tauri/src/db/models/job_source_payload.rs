use rusqlite::{params, Connection, OptionalExtension};

use crate::db::Result;

use super::{common::now_rfc3339, job_projection::source_hash};

const UPSERT_JOB_SOURCE_PAYLOAD_SQL: &str = r#"
  INSERT INTO job_source_payload (
    encrypt_job_id,
    raw_payload_json,
    source_hash,
    updated_at
  )
  VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    raw_payload_json = excluded.raw_payload_json,
    source_hash = excluded.source_hash,
    updated_at = excluded.updated_at
"#;

pub(crate) fn upsert_job_source_payload(
    conn: &Connection,
    encrypt_job_id: &str,
    raw_payload_json: &str,
) -> Result<()> {
    let hash = source_hash(raw_payload_json);
    let now = now_rfc3339();
    conn.execute(
        UPSERT_JOB_SOURCE_PAYLOAD_SQL,
        params![encrypt_job_id, raw_payload_json, hash, now],
    )?;
    Ok(())
}

pub(crate) fn get_job_source_payload(
    conn: &Connection,
    encrypt_job_id: &str,
) -> Result<Option<String>> {
    conn.query_row(
        r#"
        SELECT COALESCE(sp.raw_payload_json, j.raw_payload_json)
        FROM job j
        LEFT JOIN job_source_payload sp ON sp.encrypt_job_id = j.encrypt_job_id
        WHERE j.encrypt_job_id = ?1
        "#,
        [encrypt_job_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

pub(crate) fn backfill_job_source_payloads(conn: &Connection) -> Result<u64> {
    let mut stmt = conn.prepare(
        r#"
        SELECT j.encrypt_job_id, j.raw_payload_json, sp.source_hash
        FROM job j
        LEFT JOIN job_source_payload sp ON sp.encrypt_job_id = j.encrypt_job_id
        WHERE j.raw_payload_json IS NOT NULL
          AND trim(j.raw_payload_json) != ''
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let rows: Vec<_> = rows.collect::<std::result::Result<_, _>>()?;
    drop(stmt);

    let mut changed = 0_u64;
    for (encrypt_job_id, raw_payload_json, current_hash) in rows {
        let next_hash = source_hash(&raw_payload_json);
        if current_hash.as_deref() == Some(next_hash.as_str()) {
            continue;
        }
        upsert_job_source_payload(conn, &encrypt_job_id, &raw_payload_json)?;
        changed += 1;
    }
    Ok(changed)
}
