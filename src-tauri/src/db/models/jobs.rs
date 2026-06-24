use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::db::Result;

use super::{
    collection::JobUpsertOutcome,
    common::now_rfc3339,
    company_score::upsert_company_score_from_source,
    job_fields::{extract_job_fields_from_detail, extract_job_fields_from_list_item, JobFields},
    source_adapter::{normalize_boss_detail, normalize_boss_list_item, NormalizedJobSource},
};

#[derive(Debug, Clone, PartialEq, Eq)]
struct JobPersistenceSnapshot {
    source_platform: String,
    source_url: Option<String>,
    dedup_key: Option<String>,
    position_name: Option<String>,
    boss_name: Option<String>,
    boss_active_status: Option<String>,
    brand_name: Option<String>,
    city_name: Option<String>,
    salary_desc: Option<String>,
    experience_name: Option<String>,
    degree_name: Option<String>,
    jd_text: Option<String>,
    raw_payload_json: Option<String>,
    detail_raw_json: Option<String>,
}

#[derive(Debug)]
pub(crate) struct NormalizedJobInput {
    pub encrypt_job_id: String,
    pub source_platform: String,
    pub source_url: Option<String>,
    pub dedup_key: String,
    pub position_name: Option<String>,
    pub boss_name: Option<String>,
    pub brand_name: Option<String>,
    pub city_name: Option<String>,
    pub salary_desc: Option<String>,
    pub experience_name: Option<String>,
    pub degree_name: Option<String>,
    pub jd_text: Option<String>,
    pub raw_payload: Value,
}

const UPSERT_JOB_DETAIL_RAW_SQL: &str = r#"
  INSERT INTO job_detail_raw (encrypt_job_id, zp_data_json, fetched_at)
  VALUES (?1, ?2, ?3)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    zp_data_json = excluded.zp_data_json,
    fetched_at = excluded.fetched_at
"#;

const INSERT_JOB_DETAIL_RAW_IF_MISSING_SQL: &str = r#"
  INSERT INTO job_detail_raw (encrypt_job_id, zp_data_json, fetched_at)
  VALUES (?1, ?2, ?3)
  ON CONFLICT(encrypt_job_id) DO NOTHING
"#;

const UPSERT_JOB_FROM_DETAIL_SQL: &str = r#"
  INSERT INTO job (
    encrypt_job_id,
    source_platform,
    source_url,
    dedup_key,
    position_name,
    boss_name,
    boss_active_status,
    brand_name,
    city_name,
    salary_desc,
    experience_name,
    degree_name,
    jd_text,
    raw_payload_json,
    last_seen_at
  )
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    source_platform = excluded.source_platform,
    source_url = COALESCE(excluded.source_url, job.source_url),
    dedup_key = COALESCE(excluded.dedup_key, job.dedup_key),
    position_name = COALESCE(job.position_name, excluded.position_name),
    boss_name = COALESCE(excluded.boss_name, job.boss_name),
    boss_active_status = COALESCE(excluded.boss_active_status, job.boss_active_status),
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
    boss_active_status,
    brand_name,
    city_name,
    salary_desc,
    experience_name,
    degree_name,
    jd_text,
    raw_payload_json,
    last_seen_at
  )
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    source_platform = excluded.source_platform,
    source_url = COALESCE(excluded.source_url, job.source_url),
    dedup_key = COALESCE(excluded.dedup_key, job.dedup_key),
    position_name = COALESCE(excluded.position_name, job.position_name),
    boss_name = COALESCE(excluded.boss_name, job.boss_name),
    boss_active_status = COALESCE(excluded.boss_active_status, job.boss_active_status),
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
    boss_active_status = COALESCE(boss_active_status, ?4),
    brand_name = COALESCE(brand_name, ?5),
    city_name = COALESCE(city_name, ?6),
    salary_desc = COALESCE(salary_desc, ?7),
    experience_name = COALESCE(experience_name, ?8),
    degree_name = COALESCE(degree_name, ?9)
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

pub(crate) fn upsert_job_from_detail_with_outcome(
    conn: &Connection,
    encrypt_job_id: &str,
    zp_data_json: &str,
) -> Result<JobUpsertOutcome> {
    upsert_with_outcome(conn, encrypt_job_id, |conn| {
        upsert_job_from_detail(conn, encrypt_job_id, zp_data_json)
    })
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
    if let Some(detail_json) = build_boss_list_item_detail_json(item, &fields, &source) {
        insert_job_detail_raw_if_missing(conn, encrypt_job_id, &detail_json)?;
    }
    upsert_company_score_for_fields(conn, &fields, &item.to_string())?;
    Ok(())
}

pub(crate) fn upsert_job_from_list_item_with_outcome(
    conn: &Connection,
    encrypt_job_id: &str,
    item: &Value,
) -> Result<JobUpsertOutcome> {
    upsert_with_outcome(conn, encrypt_job_id, |conn| {
        upsert_job_from_list_item(conn, encrypt_job_id, item)
    })
}

pub(crate) fn upsert_job_from_normalized(
    conn: &Connection,
    input: &NormalizedJobInput,
) -> Result<()> {
    let fields = JobFields {
        position_name: input.position_name.clone(),
        boss_name: input.boss_name.clone(),
        boss_active_status: None,
        brand_name: input.brand_name.clone(),
        city_name: input.city_name.clone(),
        salary_desc: input.salary_desc.clone(),
        experience_name: input.experience_name.clone(),
        degree_name: input.degree_name.clone(),
    };
    let source = NormalizedJobSource {
        source_platform: input.source_platform.trim().to_string(),
        source_url: input.source_url.clone(),
        dedup_key: input.dedup_key.trim().to_string(),
        jd_text: input.jd_text.clone(),
        raw_payload_json: serde_json::to_string(&input.raw_payload)
            .unwrap_or_else(|_| "{}".to_string()),
    };
    let last_seen_at = now_rfc3339();
    upsert_job_record(
        conn,
        UPSERT_JOB_FROM_LIST_SQL,
        &input.encrypt_job_id,
        &fields,
        &source,
        &last_seen_at,
    )?;
    if let Some(detail_json) = build_normalized_job_detail_json(input, &fields, &source) {
        upsert_job_detail_raw(conn, &input.encrypt_job_id, &detail_json)?;
    }
    let score_source = source
        .jd_text
        .as_deref()
        .unwrap_or(source.raw_payload_json.as_str());
    upsert_company_score_for_fields(conn, &fields, score_source)?;
    Ok(())
}

fn build_normalized_job_detail_json(
    input: &NormalizedJobInput,
    fields: &JobFields,
    source: &NormalizedJobSource,
) -> Option<String> {
    let post_description = normalized_post_description(input, source)?;
    serde_json::to_string(&json!({
        "sourcePlatform": source.source_platform,
        "sourceUrl": source.source_url,
        "dedupKey": source.dedup_key,
        "jobInfo": {
            "positionName": fields.position_name,
            "postDescription": post_description,
            "cityName": fields.city_name,
            "salaryDesc": fields.salary_desc,
            "experienceName": fields.experience_name,
            "degreeName": fields.degree_name,
        },
        "bossInfo": {
            "name": fields.boss_name,
        },
        "brandInfo": {
            "brandName": fields.brand_name,
        },
        "rawPayload": input.raw_payload,
    }))
    .ok()
}

fn build_boss_list_item_detail_json(
    item: &Value,
    fields: &JobFields,
    source: &NormalizedJobSource,
) -> Option<String> {
    let post_description = source
        .jd_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("列表仅含基础岗位信息，完整 JD 需补充岗位证据。");
    serde_json::to_string(&json!({
        "detailStatus": "list_only",
        "sourcePlatform": source.source_platform,
        "sourceUrl": source.source_url,
        "dedupKey": source.dedup_key,
        "jobInfo": {
            "jobName": fields.position_name,
            "positionName": fields.position_name,
            "postDescription": post_description,
            "cityName": fields.city_name,
            "salaryDesc": fields.salary_desc,
            "experienceName": fields.experience_name,
            "degreeName": fields.degree_name,
            "skills": boss_list_array_field(item, "skills"),
            "showSkills": boss_list_array_field(item, "skills"),
            "jobLabels": boss_list_array_field(item, "jobLabels"),
        },
        "bossInfo": {
            "name": fields.boss_name,
            "activeTimeDesc": fields.boss_active_status,
        },
        "brandInfo": {
            "brandName": fields.brand_name,
        },
        "rawPayload": item,
    }))
    .ok()
}

fn boss_list_array_field(item: &Value, key: &str) -> Option<Value> {
    item.get(key)
        .filter(|value| value.is_array())
        .cloned()
        .or_else(|| {
            item.get("jobInfo")
                .and_then(|job_info| job_info.get(key))
                .filter(|value| value.is_array())
                .cloned()
        })
}

fn normalized_post_description(
    input: &NormalizedJobInput,
    source: &NormalizedJobSource,
) -> Option<String> {
    input
        .raw_payload
        .get("contentHtml")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            source
                .jd_text
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .or_else(|| {
            input
                .raw_payload
                .get("contentText")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
}

pub(crate) fn upsert_job_from_normalized_with_outcome(
    conn: &Connection,
    input: &NormalizedJobInput,
) -> Result<JobUpsertOutcome> {
    upsert_with_outcome(conn, &input.encrypt_job_id, |conn| {
        upsert_job_from_normalized(conn, input)
    })
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
                &fields.boss_active_status,
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

fn load_job_persistence_snapshot(
    conn: &Connection,
    encrypt_job_id: &str,
) -> Result<Option<JobPersistenceSnapshot>> {
    conn.query_row(
        r#"
        SELECT j.source_platform, j.source_url, j.dedup_key,
               j.position_name, j.boss_name, j.boss_active_status, j.brand_name,
               j.city_name, j.salary_desc, j.experience_name, j.degree_name,
               j.jd_text, j.raw_payload_json, d.zp_data_json
        FROM job j
        LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
        WHERE j.encrypt_job_id = ?1
        "#,
        [encrypt_job_id],
        |row| {
            Ok(JobPersistenceSnapshot {
                source_platform: row.get(0)?,
                source_url: row.get(1)?,
                dedup_key: row.get(2)?,
                position_name: row.get(3)?,
                boss_name: row.get(4)?,
                boss_active_status: row.get(5)?,
                brand_name: row.get(6)?,
                city_name: row.get(7)?,
                salary_desc: row.get(8)?,
                experience_name: row.get(9)?,
                degree_name: row.get(10)?,
                jd_text: row.get(11)?,
                raw_payload_json: row.get(12)?,
                detail_raw_json: row.get(13)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn upsert_with_outcome<F>(
    conn: &Connection,
    encrypt_job_id: &str,
    upsert: F,
) -> Result<JobUpsertOutcome>
where
    F: FnOnce(&Connection) -> Result<()>,
{
    let before = load_job_persistence_snapshot(conn, encrypt_job_id)?;
    upsert(conn)?;
    let after = load_job_persistence_snapshot(conn, encrypt_job_id)?;
    Ok(match (before, after) {
        (None, Some(_)) => JobUpsertOutcome::Inserted,
        (Some(before), Some(after)) if before == after => JobUpsertOutcome::Duplicate,
        (Some(_), Some(_)) => JobUpsertOutcome::Updated,
        _ => JobUpsertOutcome::Duplicate,
    })
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

fn insert_job_detail_raw_if_missing(
    conn: &Connection,
    encrypt_job_id: &str,
    zp_data_json: &str,
) -> Result<()> {
    let fetched_at = now_rfc3339();
    conn.execute(
        INSERT_JOB_DETAIL_RAW_IF_MISSING_SQL,
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
        "{} {} {} {} {} {} {} {} {}",
        fields.position_name.as_deref().unwrap_or(""),
        fields.boss_name.as_deref().unwrap_or(""),
        fields.boss_active_status.as_deref().unwrap_or(""),
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
            &fields.boss_active_status,
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
