use rusqlite::Connection;
use serde_json::{json, Value};

use super::{models::supported_job_source_adapters, Result};

const JOB_FTS_TABLE: &str = "job_fts";
const JOB_FTS_CREATE_SQL: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS job_fts USING fts5(
  encrypt_job_id UNINDEXED,
  position_name,
  boss_name,
  brand_name,
  city_name,
  salary_desc,
  experience_name,
  degree_name,
  detail_text,
  tokenize='trigram'
);
"#;

const JOB_FTS_TRIGGERS_SQL: &str = r#"
CREATE TRIGGER IF NOT EXISTS trg_job_fts_job_ai
AFTER INSERT ON job
BEGIN
  DELETE FROM job_fts WHERE encrypt_job_id = NEW.encrypt_job_id;
  INSERT INTO job_fts(
    encrypt_job_id,
    position_name,
    boss_name,
    brand_name,
    city_name,
    salary_desc,
    experience_name,
    degree_name,
    detail_text
  )
  VALUES(
    NEW.encrypt_job_id,
    COALESCE(NEW.position_name, ''),
    COALESCE(NEW.boss_name, ''),
    COALESCE(NEW.brand_name, ''),
    COALESCE(NEW.city_name, ''),
	    COALESCE(NEW.salary_desc, ''),
	    COALESCE(NEW.experience_name, ''),
	    COALESCE(NEW.degree_name, ''),
	    COALESCE(NEW.boss_active_status, '') || ' ' ||
	    COALESCE(NEW.source_platform, '') || ' ' ||
    COALESCE(NEW.source_url, '') || ' ' ||
    COALESCE(NEW.dedup_key, '') || ' ' ||
    COALESCE(NEW.jd_text, '') || ' ' ||
    COALESCE(NEW.raw_payload_json, '') || ' ' ||
    COALESCE((SELECT zp_data_json FROM job_detail_raw d WHERE d.encrypt_job_id = NEW.encrypt_job_id), '')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_job_fts_job_au
AFTER UPDATE ON job
BEGIN
  DELETE FROM job_fts WHERE encrypt_job_id = NEW.encrypt_job_id;
  INSERT INTO job_fts(
    encrypt_job_id,
    position_name,
    boss_name,
    brand_name,
    city_name,
    salary_desc,
    experience_name,
    degree_name,
    detail_text
  )
  VALUES(
    NEW.encrypt_job_id,
    COALESCE(NEW.position_name, ''),
    COALESCE(NEW.boss_name, ''),
    COALESCE(NEW.brand_name, ''),
    COALESCE(NEW.city_name, ''),
	    COALESCE(NEW.salary_desc, ''),
	    COALESCE(NEW.experience_name, ''),
	    COALESCE(NEW.degree_name, ''),
	    COALESCE(NEW.boss_active_status, '') || ' ' ||
	    COALESCE(NEW.source_platform, '') || ' ' ||
    COALESCE(NEW.source_url, '') || ' ' ||
    COALESCE(NEW.dedup_key, '') || ' ' ||
    COALESCE(NEW.jd_text, '') || ' ' ||
    COALESCE(NEW.raw_payload_json, '') || ' ' ||
    COALESCE((SELECT zp_data_json FROM job_detail_raw d WHERE d.encrypt_job_id = NEW.encrypt_job_id), '')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_job_fts_job_ad
AFTER DELETE ON job
BEGIN
  DELETE FROM job_fts WHERE encrypt_job_id = OLD.encrypt_job_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_job_fts_job_detail_raw_ai
AFTER INSERT ON job_detail_raw
BEGIN
  DELETE FROM job_fts WHERE encrypt_job_id = NEW.encrypt_job_id;
  INSERT INTO job_fts(
    encrypt_job_id,
    position_name,
    boss_name,
    brand_name,
    city_name,
    salary_desc,
    experience_name,
    degree_name,
    detail_text
  )
  SELECT
    j.encrypt_job_id,
    COALESCE(j.position_name, ''),
    COALESCE(j.boss_name, ''),
    COALESCE(j.brand_name, ''),
    COALESCE(j.city_name, ''),
	    COALESCE(j.salary_desc, ''),
	    COALESCE(j.experience_name, ''),
	    COALESCE(j.degree_name, ''),
	    COALESCE(j.boss_active_status, '') || ' ' ||
	    COALESCE(j.source_platform, '') || ' ' ||
    COALESCE(j.source_url, '') || ' ' ||
    COALESCE(j.dedup_key, '') || ' ' ||
    COALESCE(j.jd_text, '') || ' ' ||
    COALESCE(j.raw_payload_json, '') || ' ' ||
    NEW.zp_data_json
  FROM job j
  WHERE j.encrypt_job_id = NEW.encrypt_job_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_job_fts_job_detail_raw_au
AFTER UPDATE ON job_detail_raw
BEGIN
  DELETE FROM job_fts WHERE encrypt_job_id = NEW.encrypt_job_id;
  INSERT INTO job_fts(
    encrypt_job_id,
    position_name,
    boss_name,
    brand_name,
    city_name,
    salary_desc,
    experience_name,
    degree_name,
    detail_text
  )
  SELECT
    j.encrypt_job_id,
    COALESCE(j.position_name, ''),
    COALESCE(j.boss_name, ''),
    COALESCE(j.brand_name, ''),
    COALESCE(j.city_name, ''),
	    COALESCE(j.salary_desc, ''),
	    COALESCE(j.experience_name, ''),
	    COALESCE(j.degree_name, ''),
	    COALESCE(j.boss_active_status, '') || ' ' ||
	    COALESCE(j.source_platform, '') || ' ' ||
    COALESCE(j.source_url, '') || ' ' ||
    COALESCE(j.dedup_key, '') || ' ' ||
    COALESCE(j.jd_text, '') || ' ' ||
    COALESCE(j.raw_payload_json, '') || ' ' ||
    NEW.zp_data_json
  FROM job j
  WHERE j.encrypt_job_id = NEW.encrypt_job_id;
END;
"#;

const JOB_FTS_BACKFILL_SQL: &str = r#"
INSERT INTO job_fts(
  encrypt_job_id,
  position_name,
  boss_name,
  brand_name,
  city_name,
  salary_desc,
  experience_name,
  degree_name,
  detail_text
)
SELECT
  j.encrypt_job_id,
  COALESCE(j.position_name, ''),
  COALESCE(j.boss_name, ''),
  COALESCE(j.brand_name, ''),
  COALESCE(j.city_name, ''),
	  COALESCE(j.salary_desc, ''),
	  COALESCE(j.experience_name, ''),
	  COALESCE(j.degree_name, ''),
	  COALESCE(j.boss_active_status, '') || ' ' ||
	  COALESCE(j.source_platform, '') || ' ' ||
  COALESCE(j.source_url, '') || ' ' ||
  COALESCE(j.dedup_key, '') || ' ' ||
  COALESCE(j.jd_text, '') || ' ' ||
  COALESCE(j.raw_payload_json, '') || ' ' ||
  COALESCE(d.zp_data_json, '')
FROM job j
LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id;
"#;

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    column_type: &str,
) -> Result<()> {
    if column_exists(conn, table, column)? {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {column_type}"),
        [],
    )?;
    Ok(())
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |row| row.get(0),
    )?;
    Ok(exists)
}

fn ensure_job_fts(conn: &Connection) -> Result<()> {
    let existed = table_exists(conn, JOB_FTS_TABLE)?;

    conn.execute_batch(JOB_FTS_CREATE_SQL)?;
    conn.execute_batch(JOB_FTS_TRIGGERS_SQL)?;

    if existed {
        return Ok(());
    }

    conn.execute_batch(JOB_FTS_BACKFILL_SQL)?;
    Ok(())
}

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(include_str!("schema.sql"))?;
    upsert_job_sources(conn)?;

    // Forward-compatible, additive migrations for existing databases.
    add_column_if_missing(conn, "job", "boss_name", "TEXT")?;
    add_column_if_missing(conn, "job", "boss_active_status", "TEXT")?;
    add_column_if_missing(
        conn,
        "job",
        "source_platform",
        "TEXT NOT NULL DEFAULT 'boss'",
    )?;
    add_column_if_missing(conn, "job", "source_url", "TEXT")?;
    add_column_if_missing(conn, "job", "dedup_key", "TEXT")?;
    add_column_if_missing(conn, "job", "jd_text", "TEXT")?;
    add_column_if_missing(conn, "job", "raw_payload_json", "TEXT")?;
    conn.execute(
    "UPDATE job SET source_platform = COALESCE(NULLIF(source_platform, ''), 'boss'), dedup_key = COALESCE(NULLIF(dedup_key, ''), encrypt_job_id)",
    [],
  )?;
    conn.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_job_source_dedup ON job(source_platform, dedup_key) WHERE dedup_key IS NOT NULL",
    [],
  )?;
    add_column_if_missing(conn, "ai_report", "kind", "TEXT")?;
    add_column_if_missing(conn, "ai_report", "title", "TEXT")?;
    add_column_if_missing(conn, "ai_report", "match_score", "REAL")?;
    add_column_if_missing(conn, "ai_report", "jobs_count", "INTEGER")?;
    add_column_if_missing(
        conn,
        "company_score",
        "confidence",
        "REAL NOT NULL DEFAULT 0.72",
    )?;
    backfill_v2ex_job_detail_raw(conn)?;
    backfill_company_scores(conn)?;

    // Deduplicate job_source_link rows and add a unique index to prevent future duplicates.
    dedup_job_source_link(conn)?;

    ensure_job_fts(conn)?;

    Ok(())
}

fn backfill_v2ex_job_detail_raw(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare(
        r#"
    SELECT
      j.encrypt_job_id,
      j.source_platform,
      j.source_url,
      j.dedup_key,
      j.position_name,
      j.boss_name,
      j.brand_name,
      j.city_name,
      j.salary_desc,
      j.experience_name,
      j.degree_name,
      j.jd_text,
      j.raw_payload_json
    FROM job j
    LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
    WHERE j.source_platform = 'v2ex'
      AND d.encrypt_job_id IS NULL
    "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, Option<String>>(10)?,
            row.get::<_, Option<String>>(11)?,
            row.get::<_, Option<String>>(12)?,
        ))
    })?;
    let rows: Vec<_> = rows.collect::<std::result::Result<_, _>>()?;
    drop(stmt);

    for row in rows {
        let (
            encrypt_job_id,
            source_platform,
            source_url,
            dedup_key,
            position_name,
            boss_name,
            brand_name,
            city_name,
            salary_desc,
            experience_name,
            degree_name,
            jd_text,
            raw_payload_json,
        ) = row;
        let raw_payload = raw_payload_json
            .as_deref()
            .and_then(|value| serde_json::from_str::<Value>(value).ok())
            .unwrap_or(Value::Null);
        let Some(post_description) = v2ex_post_description(&raw_payload, jd_text.as_deref()) else {
            continue;
        };
        let detail = json!({
            "sourcePlatform": source_platform,
            "sourceUrl": source_url,
            "dedupKey": dedup_key,
            "jobInfo": {
                "positionName": position_name,
                "postDescription": post_description,
                "cityName": city_name,
                "salaryDesc": salary_desc,
                "experienceName": experience_name,
                "degreeName": degree_name,
            },
            "bossInfo": {
                "name": boss_name,
            },
            "brandInfo": {
                "brandName": brand_name,
            },
            "rawPayload": raw_payload,
        });
        conn.execute(
            r#"
      INSERT INTO job_detail_raw (encrypt_job_id, zp_data_json, fetched_at)
      VALUES (?1, ?2, datetime('now'))
      ON CONFLICT(encrypt_job_id) DO NOTHING
      "#,
            rusqlite::params![encrypt_job_id, detail.to_string()],
        )?;
    }

    Ok(())
}

fn v2ex_post_description(raw_payload: &Value, jd_text: Option<&str>) -> Option<String> {
    raw_payload
        .get("contentHtml")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            jd_text
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .or_else(|| {
            raw_payload
                .get("contentText")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

fn upsert_job_sources(conn: &Connection) -> Result<()> {
    for spec in supported_job_source_adapters() {
        conn.execute(
            r#"
    INSERT INTO job_sources (
      platform,
      display_name,
      adapter_kind,
      enabled,
      config_json,
      created_at,
      updated_at
    )
    VALUES (?1, ?2, ?3, ?4, '{}', datetime('now'), datetime('now'))
    ON CONFLICT(platform) DO UPDATE SET
      display_name = excluded.display_name,
      adapter_kind = excluded.adapter_kind,
      updated_at = excluded.updated_at
    "#,
            rusqlite::params![
                spec.platform,
                spec.display_name,
                spec.adapter_kind,
                if spec.enabled_by_default { 1 } else { 0 },
            ],
        )?;
    }
    Ok(())
}

fn backfill_company_scores(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare(
        r#"
    SELECT
      j.brand_name,
      COALESCE(j.position_name, '') || ' ' ||
      COALESCE(j.boss_name, '') || ' ' ||
      COALESCE(j.brand_name, '') || ' ' ||
      COALESCE(j.city_name, '') || ' ' ||
	      COALESCE(j.salary_desc, '') || ' ' ||
	      COALESCE(j.experience_name, '') || ' ' ||
	      COALESCE(j.degree_name, '') || ' ' ||
	      COALESCE(j.boss_active_status, '') || ' ' ||
	      COALESCE(d.zp_data_json, '')
    FROM job j
    LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
    WHERE j.brand_name IS NOT NULL AND trim(j.brand_name) != ''
    "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let rows: Vec<(String, String)> = rows.collect::<std::result::Result<_, _>>()?;
    drop(stmt);

    for row in rows {
        let (company_name, source_text) = row;
        crate::db::models::upsert_company_score_from_source(conn, &company_name, &source_text)?;
    }

    Ok(())
}

fn dedup_job_source_link(conn: &Connection) -> Result<()> {
    let exists: bool = conn.query_row(
    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='index' AND name='idx_job_source_link_dedup'",
    [],
    |row| row.get(0),
  )?;

    if exists {
        return Ok(());
    }

    // Delete duplicate rows with non-NULL keyword, keeping only the latest (MAX id) per pair.
    conn.execute_batch(
        r#"
    DELETE FROM job_source_link
    WHERE keyword IS NOT NULL
      AND id NOT IN (
        SELECT MAX(id) FROM job_source_link
        WHERE keyword IS NOT NULL
        GROUP BY encrypt_job_id, keyword
      )
    "#,
    )?;

    // Create partial unique index for non-NULL keywords.
    conn.execute_batch(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_job_source_link_dedup ON job_source_link(encrypt_job_id, keyword) WHERE keyword IS NOT NULL",
  )?;

    Ok(())
}
