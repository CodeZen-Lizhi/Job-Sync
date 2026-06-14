use rusqlite::{params, Connection};
use serde_json::Value;

use crate::db::Result;

use super::{
    common::now_rfc3339,
    company_score::upsert_company_score_from_source,
    job_fields::{
        extract_job_fields_from_detail, extract_job_fields_from_external_source,
        extract_job_fields_from_list_item, JobFields,
    },
    source_adapter::{
        normalize_boss_detail, normalize_boss_list_item, normalize_external_source,
        NormalizedJobSource,
    },
    source_links::insert_job_source_link,
};

const UPSERT_JOB_DETAIL_RAW_SQL: &str = r#"
  INSERT INTO job_detail_raw (encrypt_job_id, zp_data_json, fetched_at)
  VALUES (?1, ?2, ?3)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    zp_data_json = excluded.zp_data_json,
    fetched_at = excluded.fetched_at
"#;

const UPSERT_JOB_FROM_DETAIL_SQL: &str = r#"
  INSERT INTO job (
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
    last_seen_at
  )
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    source_platform = excluded.source_platform,
    source_url = COALESCE(excluded.source_url, job.source_url),
    dedup_key = COALESCE(excluded.dedup_key, job.dedup_key),
    position_name = COALESCE(job.position_name, excluded.position_name),
    boss_name = COALESCE(excluded.boss_name, job.boss_name),
    brand_name = COALESCE(excluded.brand_name, job.brand_name),
    city_name = COALESCE(excluded.city_name, job.city_name),
    salary_desc = COALESCE(excluded.salary_desc, job.salary_desc),
    experience_name = COALESCE(excluded.experience_name, job.experience_name),
    degree_name = COALESCE(excluded.degree_name, job.degree_name),
    jd_text = COALESCE(excluded.jd_text, job.jd_text),
    raw_payload_json = COALESCE(excluded.raw_payload_json, job.raw_payload_json),
    last_seen_at = excluded.last_seen_at
"#;

const UPSERT_JOB_FROM_LIST_SQL: &str = r#"
  INSERT INTO job (
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
    last_seen_at
  )
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    source_platform = excluded.source_platform,
    source_url = COALESCE(excluded.source_url, job.source_url),
    dedup_key = COALESCE(excluded.dedup_key, job.dedup_key),
    position_name = COALESCE(excluded.position_name, job.position_name),
    boss_name = COALESCE(excluded.boss_name, job.boss_name),
    brand_name = COALESCE(excluded.brand_name, job.brand_name),
    city_name = COALESCE(excluded.city_name, job.city_name),
    salary_desc = COALESCE(excluded.salary_desc, job.salary_desc),
    experience_name = COALESCE(excluded.experience_name, job.experience_name),
    degree_name = COALESCE(excluded.degree_name, job.degree_name),
    jd_text = COALESCE(excluded.jd_text, job.jd_text),
    raw_payload_json = COALESCE(excluded.raw_payload_json, job.raw_payload_json),
    last_seen_at = excluded.last_seen_at
"#;

const REBUILD_ALL_JOB_FIELDS_SQL: &str = r#"
  UPDATE job SET
    position_name = COALESCE(position_name, ?2),
    boss_name = COALESCE(boss_name, ?3),
    brand_name = COALESCE(brand_name, ?4),
    city_name = COALESCE(city_name, ?5),
    salary_desc = COALESCE(salary_desc, ?6),
    experience_name = COALESCE(experience_name, ?7),
    degree_name = COALESCE(degree_name, ?8)
  WHERE encrypt_job_id = ?1
"#;

pub(crate) fn upsert_job_from_detail(
    conn: &Connection,
    encrypt_job_id: &str,
    zp_data_json: &str,
) -> Result<()> {
    upsert_job_detail_raw(conn, encrypt_job_id, zp_data_json)?;
    let fields = parse_detail_fields(zp_data_json);
    let zp_data: Value = serde_json::from_str(zp_data_json).unwrap_or(Value::Null);
    let source = normalize_boss_detail(encrypt_job_id, &zp_data, &fields);
    let last_seen_at = now_rfc3339();
    upsert_job_record(
        conn,
        UPSERT_JOB_FROM_DETAIL_SQL,
        encrypt_job_id,
        &fields,
        &source,
        &last_seen_at,
    )?;
    upsert_company_score_for_fields(conn, &fields, zp_data_json)?;
    Ok(())
}

pub(crate) fn upsert_job_from_list_item(
    conn: &Connection,
    encrypt_job_id: &str,
    item: &Value,
) -> Result<()> {
    let fields = extract_job_fields_from_list_item(item);
    let source = normalize_boss_list_item(encrypt_job_id, item, &fields);
    let last_seen_at = now_rfc3339();
    upsert_job_record(
        conn,
        UPSERT_JOB_FROM_LIST_SQL,
        encrypt_job_id,
        &fields,
        &source,
        &last_seen_at,
    )?;
    upsert_company_score_for_fields(conn, &fields, &item.to_string())?;
    Ok(())
}

pub(crate) fn upsert_job_from_external_source(
    conn: &Connection,
    platform: &str,
    payload: &Value,
) -> Result<String> {
    let fields = extract_job_fields_from_external_source(payload);
    let (encrypt_job_id, source) = normalize_external_source(platform, payload, &fields);
    let last_seen_at = now_rfc3339();
    upsert_job_record(
        conn,
        UPSERT_JOB_FROM_LIST_SQL,
        &encrypt_job_id,
        &fields,
        &source,
        &last_seen_at,
    )?;
    upsert_company_score_for_fields(conn, &fields, &source.raw_payload_json)?;
    insert_job_source_link(
        conn,
        &encrypt_job_id,
        Some(&format!("手动导入:{}", source.source_platform)),
        Some(&source.raw_payload_json),
    )?;
    Ok(encrypt_job_id)
}

pub(crate) fn rebuild_all_job_fields(conn: &Connection) -> Result<u64> {
    let rows = load_job_detail_rows(conn)?;
    let mut updated = 0_u64;

    for (encrypt_job_id, zp_data_json) in &rows {
        let fields = parse_detail_fields(zp_data_json);
        upsert_company_score_for_fields(conn, &fields, zp_data_json)?;
        let changes = conn.execute(
            REBUILD_ALL_JOB_FIELDS_SQL,
            params![
                encrypt_job_id,
                &fields.position_name,
                &fields.boss_name,
                &fields.brand_name,
                &fields.city_name,
                &fields.salary_desc,
                &fields.experience_name,
                &fields.degree_name,
            ],
        )?;
        updated += changes as u64;
    }

    Ok(updated)
}

fn upsert_job_detail_raw(
    conn: &Connection,
    encrypt_job_id: &str,
    zp_data_json: &str,
) -> Result<()> {
    let fetched_at = now_rfc3339();
    conn.execute(
        UPSERT_JOB_DETAIL_RAW_SQL,
        params![encrypt_job_id, zp_data_json, fetched_at],
    )?;
    Ok(())
}

fn parse_detail_fields(zp_data_json: &str) -> JobFields {
    let zp_data: Value = serde_json::from_str(zp_data_json).unwrap_or(Value::Null);
    extract_job_fields_from_detail(&zp_data)
}

fn load_job_detail_rows(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT encrypt_job_id, zp_data_json FROM job_detail_raw")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

fn upsert_company_score_for_fields(
    conn: &Connection,
    fields: &JobFields,
    source_text: &str,
) -> Result<()> {
    let Some(company_name) = fields.brand_name.as_deref() else {
        return Ok(());
    };
    let combined_source = format!(
        "{} {} {} {} {} {} {} {}",
        fields.position_name.as_deref().unwrap_or(""),
        fields.boss_name.as_deref().unwrap_or(""),
        fields.brand_name.as_deref().unwrap_or(""),
        fields.city_name.as_deref().unwrap_or(""),
        fields.salary_desc.as_deref().unwrap_or(""),
        fields.experience_name.as_deref().unwrap_or(""),
        fields.degree_name.as_deref().unwrap_or(""),
        source_text,
    );
    upsert_company_score_from_source(conn, company_name, &combined_source)
}

fn upsert_job_record(
    conn: &Connection,
    sql: &str,
    encrypt_job_id: &str,
    fields: &JobFields,
    source: &NormalizedJobSource,
    last_seen_at: &str,
) -> Result<()> {
    conn.execute(
        sql,
        params![
            encrypt_job_id,
            &source.source_platform,
            &source.source_url,
            &source.dedup_key,
            &fields.position_name,
            &fields.boss_name,
            &fields.brand_name,
            &fields.city_name,
            &fields.salary_desc,
            &fields.experience_name,
            &fields.degree_name,
            &source.jd_text,
            &source.raw_payload_json,
            last_seen_at,
        ],
    )?;
    Ok(())
}
