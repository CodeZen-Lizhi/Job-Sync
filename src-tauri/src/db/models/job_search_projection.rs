use rusqlite::{params, Connection};
use serde_json::Value;

use crate::db::Result;

use super::{common::now_rfc3339, job_projection::source_hash};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JobSearchProjection {
    pub encrypt_job_id: String,
    pub title_text: String,
    pub company_text: String,
    pub location_text: String,
    pub requirement_text: String,
    pub source_text: String,
    pub search_text: String,
    pub job_hash: String,
    pub detail_hash: Option<String>,
    pub source_hash: Option<String>,
}

const UPSERT_JOB_SEARCH_PROJECTION_SQL: &str = r#"
  INSERT INTO job_search_projection (
    encrypt_job_id,
    title_text,
    company_text,
    location_text,
    requirement_text,
    source_text,
    search_text,
    job_hash,
    detail_hash,
    source_hash,
    updated_at
  )
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    title_text = excluded.title_text,
    company_text = excluded.company_text,
    location_text = excluded.location_text,
    requirement_text = excluded.requirement_text,
    source_text = excluded.source_text,
    search_text = excluded.search_text,
    job_hash = excluded.job_hash,
    detail_hash = excluded.detail_hash,
    source_hash = excluded.source_hash,
    updated_at = excluded.updated_at
"#;

pub(crate) fn refresh_job_search_projection(conn: &Connection, encrypt_job_id: &str) -> Result<()> {
    let projection = load_job_search_projection(conn, encrypt_job_id)?;
    let now = now_rfc3339();
    conn.execute(
        UPSERT_JOB_SEARCH_PROJECTION_SQL,
        params![
            projection.encrypt_job_id,
            projection.title_text,
            projection.company_text,
            projection.location_text,
            projection.requirement_text,
            projection.source_text,
            projection.search_text,
            projection.job_hash,
            projection.detail_hash,
            projection.source_hash,
            now,
        ],
    )?;
    Ok(())
}

pub(crate) fn backfill_job_search_projections(conn: &Connection) -> Result<u64> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
          j.encrypt_job_id,
          COALESCE(j.source_platform, ''),
          COALESCE(j.source_url, ''),
          COALESCE(j.dedup_key, ''),
          COALESCE(j.position_name, ''),
          COALESCE(j.boss_name, ''),
          COALESCE(j.boss_active_status, ''),
          COALESCE(j.brand_name, ''),
          COALESCE(j.city_name, ''),
          COALESCE(j.salary_desc, ''),
          COALESCE(j.experience_name, ''),
          COALESCE(j.degree_name, ''),
          COALESCE(j.jd_text, ''),
          dp.source_hash,
          src.source_hash,
          sp.job_hash,
          sp.detail_hash,
          sp.source_hash
        FROM job j
        LEFT JOIN job_search_projection sp ON sp.encrypt_job_id = j.encrypt_job_id
        LEFT JOIN job_detail_projection dp ON dp.encrypt_job_id = j.encrypt_job_id
        LEFT JOIN job_source_payload src ON src.encrypt_job_id = j.encrypt_job_id
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        let encrypt_job_id: String = row.get(0)?;
        let source_platform: String = row.get(1)?;
        let source_url: String = row.get(2)?;
        let dedup_key: String = row.get(3)?;
        let position_name: String = row.get(4)?;
        let boss_name: String = row.get(5)?;
        let boss_active_status: String = row.get(6)?;
        let brand_name: String = row.get(7)?;
        let city_name: String = row.get(8)?;
        let salary_desc: String = row.get(9)?;
        let experience_name: String = row.get(10)?;
        let degree_name: String = row.get(11)?;
        let jd_text: String = row.get(12)?;
        let job_hash = compact_hash_text([
            source_platform.as_str(),
            source_url.as_str(),
            dedup_key.as_str(),
            position_name.as_str(),
            boss_name.as_str(),
            boss_active_status.as_str(),
            brand_name.as_str(),
            city_name.as_str(),
            salary_desc.as_str(),
            experience_name.as_str(),
            degree_name.as_str(),
            jd_text.as_str(),
        ]);
        let detail_hash = row.get::<_, Option<String>>(13)?;
        let source_hash = row.get::<_, Option<String>>(14)?;
        let current_job_hash = row.get::<_, Option<String>>(15)?;
        let current_detail_hash = row.get::<_, Option<String>>(16)?;
        let current_source_hash = row.get::<_, Option<String>>(17)?;
        Ok((
            encrypt_job_id,
            job_hash,
            detail_hash,
            source_hash,
            current_job_hash,
            current_detail_hash,
            current_source_hash,
        ))
    })?;
    let rows: Vec<_> = rows.collect::<std::result::Result<_, _>>()?;
    drop(stmt);

    let mut changed = 0_u64;
    for (
        encrypt_job_id,
        job_hash,
        detail_hash,
        source_hash,
        current_job_hash,
        current_detail_hash,
        current_source_hash,
    ) in rows
    {
        if current_job_hash.as_deref() == Some(job_hash.as_str())
            && current_detail_hash == detail_hash
            && current_source_hash == source_hash
        {
            continue;
        }
        refresh_job_search_projection(conn, &encrypt_job_id)?;
        changed += 1;
    }
    Ok(changed)
}

fn load_job_search_projection(
    conn: &Connection,
    encrypt_job_id: &str,
) -> Result<JobSearchProjection> {
    conn.query_row(
        r#"
        SELECT
          j.encrypt_job_id,
          COALESCE(j.source_platform, ''),
          COALESCE(j.source_url, ''),
          COALESCE(j.dedup_key, ''),
          COALESCE(j.position_name, ''),
          COALESCE(j.boss_name, ''),
          COALESCE(j.boss_active_status, ''),
          COALESCE(j.brand_name, ''),
          COALESCE(j.city_name, ''),
          COALESCE(j.salary_desc, ''),
          COALESCE(j.experience_name, ''),
          COALESCE(j.degree_name, ''),
          COALESCE(j.jd_text, ''),
          COALESCE(dp.search_text, ''),
          dp.source_hash,
          COALESCE(src.raw_payload_json, j.raw_payload_json),
          src.source_hash
        FROM job j
        LEFT JOIN job_detail_projection dp ON dp.encrypt_job_id = j.encrypt_job_id
        LEFT JOIN job_source_payload src ON src.encrypt_job_id = j.encrypt_job_id
        WHERE j.encrypt_job_id = ?1
        "#,
        [encrypt_job_id],
        |row| {
            let encrypt_job_id: String = row.get(0)?;
            let source_platform: String = row.get(1)?;
            let source_url: String = row.get(2)?;
            let dedup_key: String = row.get(3)?;
            let position_name: String = row.get(4)?;
            let boss_name: String = row.get(5)?;
            let boss_active_status: String = row.get(6)?;
            let brand_name: String = row.get(7)?;
            let city_name: String = row.get(8)?;
            let salary_desc: String = row.get(9)?;
            let experience_name: String = row.get(10)?;
            let degree_name: String = row.get(11)?;
            let jd_text: String = row.get(12)?;
            let detail_search_text: String = row.get(13)?;
            let detail_hash: Option<String> = row.get(14)?;
            let raw_source_payload: Option<String> = row.get(15)?;
            let source_hash_value: Option<String> = row.get(16)?;
            let lightweight_source_text = raw_source_payload
                .as_deref()
                .map(lightweight_source_text)
                .unwrap_or_default();
            let title_text = compact_text([position_name.as_str()]);
            let company_text = compact_text([brand_name.as_str(), boss_name.as_str()]);
            let location_text = compact_text([city_name.as_str()]);
            let requirement_text = compact_text([
                salary_desc.as_str(),
                experience_name.as_str(),
                degree_name.as_str(),
                jd_text.as_str(),
                detail_search_text.as_str(),
            ]);
            let source_text = compact_text([
                source_platform.as_str(),
                source_url.as_str(),
                dedup_key.as_str(),
                boss_active_status.as_str(),
                lightweight_source_text.as_str(),
            ]);
            let job_hash = compact_hash_text([
                source_platform.as_str(),
                source_url.as_str(),
                dedup_key.as_str(),
                position_name.as_str(),
                boss_name.as_str(),
                boss_active_status.as_str(),
                brand_name.as_str(),
                city_name.as_str(),
                salary_desc.as_str(),
                experience_name.as_str(),
                degree_name.as_str(),
                jd_text.as_str(),
            ]);
            let search_text = compact_text([
                title_text.as_str(),
                company_text.as_str(),
                location_text.as_str(),
                requirement_text.as_str(),
                source_text.as_str(),
            ]);
            Ok(JobSearchProjection {
                encrypt_job_id,
                title_text,
                company_text,
                location_text,
                requirement_text,
                source_text,
                search_text,
                job_hash,
                detail_hash,
                source_hash: source_hash_value,
            })
        },
    )
    .map_err(Into::into)
}

fn lightweight_source_text(raw_payload_json: &str) -> String {
    let parsed = serde_json::from_str::<Value>(raw_payload_json).unwrap_or(Value::Null);
    let items = [
        text_key(&parsed, "title"),
        text_key(&parsed, "jobName"),
        text_key(&parsed, "positionName"),
        text_key(&parsed, "companyName"),
        text_key(&parsed, "brandName"),
        text_key(&parsed, "cityName"),
        text_key(&parsed, "contentText"),
    ];
    items
        .iter()
        .filter_map(Option::as_deref)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .fold(Vec::<String>::new(), |mut acc, item| {
            if !acc.iter().any(|existing| existing == item) {
                acc.push(item.to_string());
            }
            acc
        })
        .join(" ")
}

fn text_key(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn compact_text<const N: usize>(items: [&str; N]) -> String {
    items
        .into_iter()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .fold(Vec::<String>::new(), |mut acc, item| {
            if !acc.iter().any(|existing| existing == item) {
                acc.push(item.to_string());
            }
            acc
        })
        .join(" ")
}

fn compact_hash_text<const N: usize>(items: [&str; N]) -> String {
    source_hash(&items.join("\u{1f}"))
}
