use std::collections::BTreeSet;

use rusqlite::{params, Connection};
use serde_json::Value;

use crate::db::Result;

use super::{common::now_rfc3339, job_fields::extract_job_fields_from_detail};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct JobDetailProjection {
    pub encrypt_job_id: String,
    pub detail_status: Option<String>,
    pub description_text: Option<String>,
    pub skills_text: Option<String>,
    pub benefits_text: Option<String>,
    pub company_scale: Option<String>,
    pub financing_stage: Option<String>,
    pub industry: Option<String>,
    pub search_text: String,
    pub source_hash: String,
}

const UPSERT_JOB_DETAIL_PROJECTION_SQL: &str = r#"
  INSERT INTO job_detail_projection (
    encrypt_job_id,
    detail_status,
    description_text,
    skills_text,
    benefits_text,
    company_scale,
    financing_stage,
    industry,
    search_text,
    source_hash,
    updated_at
  )
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    detail_status = excluded.detail_status,
    description_text = excluded.description_text,
    skills_text = excluded.skills_text,
    benefits_text = excluded.benefits_text,
    company_scale = excluded.company_scale,
    financing_stage = excluded.financing_stage,
    industry = excluded.industry,
    search_text = excluded.search_text,
    source_hash = excluded.source_hash,
    updated_at = excluded.updated_at
"#;

pub(crate) fn source_hash(raw_detail_json: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in raw_detail_json.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

pub(crate) fn build_job_detail_projection(
    encrypt_job_id: &str,
    raw_detail_json: &str,
) -> JobDetailProjection {
    let raw = serde_json::from_str::<Value>(raw_detail_json).unwrap_or(Value::Null);
    let fields = extract_job_fields_from_detail(&raw);
    let detail_status = text_from_paths(
        &raw,
        &[
            &["detailStatus"],
            &["jobInfo", "detailStatus"],
            &["status"],
            &["rawPayload", "detailStatus"],
        ],
    );
    let description_text = first_text_from_paths(
        &raw,
        &[
            &["jobInfo", "postDescription"],
            &["jobInfo", "description"],
            &["jobInfo", "jobDescription"],
            &["jobInfo", "jobDesc"],
            &["jobInfo", "content"],
            &["postDescription"],
            &["description"],
            &["contentHtml"],
            &["contentText"],
            &["rawPayload", "contentHtml"],
            &["rawPayload", "contentText"],
            &["rawPayload", "description"],
        ],
    );
    let skills_text = array_text_from_paths(
        &raw,
        &[
            &["jobInfo", "skills"],
            &["jobInfo", "showSkills"],
            &["jobInfo", "jobLabels"],
            &["jobInfo", "labels"],
            &["skills"],
            &["showSkills"],
            &["jobLabels"],
            &["labels"],
            &["rawPayload", "skills"],
            &["rawPayload", "tags"],
        ],
    );
    let benefits_text = array_text_from_paths(
        &raw,
        &[
            &["jobInfo", "welfareList"],
            &["jobInfo", "welfare"],
            &["jobInfo", "benefits"],
            &["welfareList"],
            &["welfare"],
            &["benefits"],
            &["rawPayload", "welfare"],
            &["rawPayload", "benefits"],
        ],
    )
    .or_else(|| {
        first_text_from_paths(
            &raw,
            &[
                &["jobInfo", "welfareDesc"],
                &["jobInfo", "benefitDesc"],
                &["welfareDesc"],
                &["benefitDesc"],
            ],
        )
    });
    let company_scale = text_from_paths(
        &raw,
        &[
            &["brandInfo", "brandScaleName"],
            &["brandInfo", "scaleName"],
            &["brandComInfo", "brandScaleName"],
            &["brandComInfo", "scaleName"],
            &["companyInfo", "scaleName"],
            &["rawPayload", "companyScale"],
        ],
    );
    let financing_stage = text_from_paths(
        &raw,
        &[
            &["brandInfo", "brandStageName"],
            &["brandInfo", "stageName"],
            &["brandComInfo", "brandStageName"],
            &["brandComInfo", "stageName"],
            &["companyInfo", "financingStage"],
            &["rawPayload", "financingStage"],
        ],
    );
    let industry = text_from_paths(
        &raw,
        &[
            &["brandInfo", "brandIndustry"],
            &["brandInfo", "industry"],
            &["brandComInfo", "brandIndustry"],
            &["brandComInfo", "industry"],
            &["companyInfo", "industry"],
            &["rawPayload", "industry"],
        ],
    );

    let search_text = compact_unique_text([
        fields.position_name,
        fields.boss_name,
        fields.boss_active_status,
        fields.brand_name,
        fields.city_name,
        fields.salary_desc,
        fields.experience_name,
        fields.degree_name,
        detail_status.clone(),
        description_text.clone(),
        skills_text.clone(),
        benefits_text.clone(),
        company_scale.clone(),
        financing_stage.clone(),
        industry.clone(),
    ]);

    JobDetailProjection {
        encrypt_job_id: encrypt_job_id.to_string(),
        detail_status,
        description_text,
        skills_text,
        benefits_text,
        company_scale,
        financing_stage,
        industry,
        search_text,
        source_hash: source_hash(raw_detail_json),
    }
}

pub(crate) fn upsert_job_detail_projection(
    conn: &Connection,
    encrypt_job_id: &str,
    raw_detail_json: &str,
) -> Result<()> {
    let projection = build_job_detail_projection(encrypt_job_id, raw_detail_json);
    let now = now_rfc3339();
    conn.execute(
        UPSERT_JOB_DETAIL_PROJECTION_SQL,
        params![
            projection.encrypt_job_id,
            projection.detail_status,
            projection.description_text,
            projection.skills_text,
            projection.benefits_text,
            projection.company_scale,
            projection.financing_stage,
            projection.industry,
            projection.search_text,
            projection.source_hash,
            now,
        ],
    )?;
    Ok(())
}

pub(crate) fn backfill_job_detail_projections(conn: &Connection) -> Result<u64> {
    let mut stmt = conn.prepare(
        r#"
        SELECT d.encrypt_job_id, d.zp_data_json, p.source_hash
        FROM job_detail_raw d
        LEFT JOIN job_detail_projection p ON p.encrypt_job_id = d.encrypt_job_id
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
    for (encrypt_job_id, raw_detail_json, current_hash) in rows {
        let next_hash = source_hash(&raw_detail_json);
        if current_hash.as_deref() == Some(next_hash.as_str()) {
            continue;
        }
        upsert_job_detail_projection(conn, &encrypt_job_id, &raw_detail_json)?;
        changed += 1;
    }
    Ok(changed)
}

fn text_from_paths(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| text_at_path(value, path))
}

fn first_text_from_paths(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths
        .iter()
        .filter_map(|path| value_at_path(value, path))
        .flat_map(text_values)
        .find(|text| !text.is_empty())
}

fn array_text_from_paths(value: &Value, paths: &[&[&str]]) -> Option<String> {
    let items = paths
        .iter()
        .filter_map(|path| value_at_path(value, path))
        .flat_map(text_values)
        .collect::<Vec<_>>();
    let text = compact_unique_text(items.into_iter().map(Some));
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    Some(cursor)
}

fn text_at_path(value: &Value, path: &[&str]) -> Option<String> {
    value_at_path(value, path)
        .into_iter()
        .flat_map(text_values)
        .find(|text| !text.is_empty())
}

fn text_values(value: &Value) -> Vec<String> {
    match value {
        Value::String(text) => clean_text(text).into_iter().collect(),
        Value::Number(number) => clean_text(&number.to_string()).into_iter().collect(),
        Value::Bool(true) => vec!["是".to_string()],
        Value::Bool(false) => vec!["否".to_string()],
        Value::Array(items) => items.iter().flat_map(text_values).collect(),
        Value::Object(object) => object
            .values()
            .filter_map(|item| match item {
                Value::String(text) => clean_text(text),
                Value::Number(number) => clean_text(&number.to_string()),
                Value::Bool(true) => Some("是".to_string()),
                Value::Bool(false) => Some("否".to_string()),
                _ => None,
            })
            .collect(),
        Value::Null => Vec::new(),
    }
}

fn clean_text(value: &str) -> Option<String> {
    let normalized = value
        .replace('\r', "\n")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn compact_unique_text<I>(items: I) -> String
where
    I: IntoIterator<Item = Option<String>>,
{
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for item in items.into_iter().flatten() {
        for part in item.split(['\n', '\t']) {
            let Some(text) = clean_text(part) else {
                continue;
            };
            let key = text.to_lowercase();
            if seen.insert(key) {
                out.push(text);
            }
        }
    }
    out.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_projection_from_boss_detail_json() {
        let raw = json!({
            "detailStatus": "detail",
            "jobInfo": {
                "positionName": "Rust 平台工程师",
                "postDescription": "负责高并发平台和搜索服务",
                "skills": ["Rust", "SQLite"],
                "welfareList": ["双休", "远程"]
            },
            "brandInfo": {
                "brandName": "Projection Co",
                "brandScaleName": "100-499人",
                "brandStageName": "B轮",
                "brandIndustry": "企业服务"
            }
        })
        .to_string();

        let projection = build_job_detail_projection("job_projection", &raw);

        assert_eq!(projection.detail_status.as_deref(), Some("detail"));
        assert_eq!(projection.company_scale.as_deref(), Some("100-499人"));
        assert_eq!(projection.financing_stage.as_deref(), Some("B轮"));
        assert_eq!(projection.industry.as_deref(), Some("企业服务"));
        assert!(projection.search_text.contains("Rust 平台工程师"));
        assert!(projection.search_text.contains("高并发平台"));
        assert!(projection.search_text.contains("SQLite"));
    }

    #[test]
    fn builds_projection_from_imported_source_payload() {
        let raw = json!({
            "sourcePlatform": "v2ex",
            "jobInfo": {
                "positionName": "远程后端",
                "postDescription": "LinuxDoOnlyNeedle"
            },
            "rawPayload": {
                "contentText": "论坛正文",
                "tags": ["Go", "Remote"]
            }
        })
        .to_string();

        let projection = build_job_detail_projection("job_imported", &raw);

        assert!(projection.search_text.contains("LinuxDoOnlyNeedle"));
        assert!(projection.search_text.contains("Go"));
        assert_eq!(projection.source_hash, source_hash(&raw));
    }
}
