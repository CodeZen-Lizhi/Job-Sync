use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::db::Result;

use super::{common::now_rfc3339, job_projection::source_hash};

const UPSERT_JOB_LIST_SUMMARY_PROJECTION_SQL: &str = r#"
  INSERT INTO job_list_summary_projection (
    encrypt_job_id,
    ai_audit_status,
    ai_audit_summary,
    filter_summary,
    resume_match_score,
    resume_match_summary,
    preference_score,
    company_score,
    company_risk_summary,
    score_reason_json,
    source_hash,
    updated_at
  )
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
  ON CONFLICT(encrypt_job_id) DO UPDATE SET
    ai_audit_status = excluded.ai_audit_status,
    ai_audit_summary = excluded.ai_audit_summary,
    filter_summary = excluded.filter_summary,
    resume_match_score = excluded.resume_match_score,
    resume_match_summary = excluded.resume_match_summary,
    preference_score = excluded.preference_score,
    company_score = excluded.company_score,
    company_risk_summary = excluded.company_risk_summary,
    score_reason_json = excluded.score_reason_json,
    source_hash = excluded.source_hash,
    updated_at = excluded.updated_at
"#;

#[derive(Debug, Clone)]
struct JobListSummaryProjection {
    encrypt_job_id: String,
    ai_audit_status: String,
    ai_audit_summary: String,
    filter_summary: String,
    resume_match_score: Option<f64>,
    resume_match_summary: Option<String>,
    preference_score: f64,
    company_score: f64,
    company_risk_summary: Option<String>,
    score_reason_json: String,
    source_hash: String,
}

pub(crate) fn refresh_job_list_summary_projection(
    conn: &Connection,
    encrypt_job_id: &str,
) -> Result<()> {
    let projection = load_job_list_summary_projection(conn, encrypt_job_id)?;
    let now = now_rfc3339();
    conn.execute(
        UPSERT_JOB_LIST_SUMMARY_PROJECTION_SQL,
        params![
            projection.encrypt_job_id,
            projection.ai_audit_status,
            projection.ai_audit_summary,
            projection.filter_summary,
            projection.resume_match_score,
            projection.resume_match_summary,
            projection.preference_score,
            projection.company_score,
            projection.company_risk_summary,
            projection.score_reason_json,
            projection.source_hash,
            now,
        ],
    )?;
    Ok(())
}

pub(crate) fn refresh_company_job_list_summary_projections(
    conn: &Connection,
    company_name: &str,
) -> Result<u64> {
    let company_name = company_name.trim();
    if company_name.is_empty() {
        return Ok(0);
    }
    let mut stmt = conn.prepare(
        r#"
        SELECT encrypt_job_id
        FROM job
        WHERE brand_name = ?1
        "#,
    )?;
    let rows = stmt.query_map([company_name], |row| row.get::<_, String>(0))?;
    let rows: Vec<String> = rows.collect::<std::result::Result<_, _>>()?;
    drop(stmt);

    for encrypt_job_id in &rows {
        refresh_job_list_summary_projection(conn, encrypt_job_id)?;
    }
    Ok(rows.len() as u64)
}

pub(crate) fn backfill_job_list_summary_projections(conn: &Connection) -> Result<u64> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
          j.encrypt_job_id,
          r.eligible,
          r.reason_json,
          (
            SELECT ar.match_score
            FROM ai_report ar
            WHERE ar.encrypt_job_id = j.encrypt_job_id
              AND ar.match_score IS NOT NULL
              AND (ar.kind = 'resume' OR ar.kind IS NULL)
            ORDER BY ar.created_at DESC, ar.id DESC
            LIMIT 1
          ),
          (
            SELECT ar.result_json
            FROM ai_report ar
            WHERE ar.encrypt_job_id = j.encrypt_job_id
              AND ar.match_score IS NOT NULL
              AND (ar.kind = 'resume' OR ar.kind IS NULL)
            ORDER BY ar.created_at DESC, ar.id DESC
            LIMIT 1
          ),
          COALESCE(cs.company_score, 80),
          cs.risk_flags_json,
          COALESCE(cs.confidence, 0.72),
          lsp.source_hash
        FROM job j
        LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
        LEFT JOIN company_score cs ON cs.company_name = j.brand_name
        LEFT JOIN job_list_summary_projection lsp ON lsp.encrypt_job_id = j.encrypt_job_id
        "#,
    )?;
    let rows = stmt.query_map([], |row| {
        let encrypt_job_id: String = row.get(0)?;
        let filter_eligible = row.get::<_, Option<i64>>(1)?.map(|value| value != 0);
        let filter_reason_json: Option<String> = row.get(2)?;
        let resume_match_score: Option<f64> = row.get(3)?;
        let resume_result_json: Option<String> = row.get(4)?;
        let company_score: f64 = row.get(5)?;
        let risk_flags_json: Option<String> = row.get(6)?;
        let confidence: f64 = row.get(7)?;
        let current_hash: Option<String> = row.get(8)?;
        let next_hash = list_summary_source_hash(
            filter_eligible,
            filter_reason_json.as_deref(),
            resume_match_score,
            resume_result_json.as_deref(),
            company_score,
            risk_flags_json.as_deref(),
            confidence,
        );
        Ok((encrypt_job_id, next_hash, current_hash))
    })?;
    let rows: Vec<_> = rows.collect::<std::result::Result<_, _>>()?;
    drop(stmt);

    let mut changed = 0_u64;
    for (encrypt_job_id, next_hash, current_hash) in rows {
        if current_hash.as_deref() == Some(next_hash.as_str()) {
            continue;
        }
        refresh_job_list_summary_projection(conn, &encrypt_job_id)?;
        changed += 1;
    }
    Ok(changed)
}

fn load_job_list_summary_projection(
    conn: &Connection,
    encrypt_job_id: &str,
) -> Result<JobListSummaryProjection> {
    conn.query_row(
        r#"
        SELECT
          j.encrypt_job_id,
          r.eligible,
          r.reason_json,
          (
            SELECT ar.match_score
            FROM ai_report ar
            WHERE ar.encrypt_job_id = j.encrypt_job_id
              AND ar.match_score IS NOT NULL
              AND (ar.kind = 'resume' OR ar.kind IS NULL)
            ORDER BY ar.created_at DESC, ar.id DESC
            LIMIT 1
          ),
          (
            SELECT ar.result_json
            FROM ai_report ar
            WHERE ar.encrypt_job_id = j.encrypt_job_id
              AND ar.match_score IS NOT NULL
              AND (ar.kind = 'resume' OR ar.kind IS NULL)
            ORDER BY ar.created_at DESC, ar.id DESC
            LIMIT 1
          ),
          cs.company_score,
          cs.risk_flags_json,
          cs.confidence
        FROM job j
        LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
        LEFT JOIN company_score cs ON cs.company_name = j.brand_name
        WHERE j.encrypt_job_id = ?1
        "#,
        [encrypt_job_id],
        |row| {
            let encrypt_job_id: String = row.get(0)?;
            let filter_eligible = row.get::<_, Option<i64>>(1)?.map(|value| value != 0);
            let filter_reason_json: Option<String> = row.get(2)?;
            let resume_match_score = row.get::<_, Option<f64>>(3)?;
            let resume_result_json: Option<String> = row.get(4)?;
            let company_score = row.get::<_, Option<f64>>(5)?.unwrap_or(80.0);
            let risk_flags_json: Option<String> = row.get(6)?;
            let confidence = row.get::<_, Option<f64>>(7)?.unwrap_or(0.72);
            let filter_reason = parse_json(filter_reason_json.as_deref());
            let resume_reason = parse_json(resume_result_json.as_deref());
            let matched_preferences = string_array(filter_reason.get("matched_preferences"));
            let missing_preferences = string_array(filter_reason.get("missing_preferences"));
            let preference_score =
                compute_preference_score(matched_preferences.len(), missing_preferences.len());
            let filter_summary = summarize_filter_reason(&filter_reason, filter_eligible);
            let (ai_audit_status, ai_audit_summary) =
                summarize_ai_audit(&filter_reason, filter_eligible);
            let risk_flags = parse_string_array_json(risk_flags_json.as_deref());
            let company_risk_summary = if risk_flags.is_empty() {
                None
            } else {
                Some(
                    risk_flags
                        .iter()
                        .take(3)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join("；"),
                )
            };
            let resume_match_summary = resume_summary(&resume_reason);
            let resume_reason_projection =
                build_resume_reason_projection(&resume_reason, resume_match_score);
            let score_reason_json = serde_json::to_string(&json!({
                "preference": {
                    "matched": matched_preferences,
                    "missing": missing_preferences
                },
                "resume": resume_reason_projection,
                "company": {
                    "company_score": company_score,
                    "risk_flags": risk_flags,
                    "confidence": confidence
                }
            }))
            .unwrap_or_else(|_| "{}".to_string());
            let source_hash_value = list_summary_source_hash(
                filter_eligible,
                filter_reason_json.as_deref(),
                resume_match_score,
                resume_result_json.as_deref(),
                company_score,
                risk_flags_json.as_deref(),
                confidence,
            );
            Ok(JobListSummaryProjection {
                encrypt_job_id,
                ai_audit_status,
                ai_audit_summary,
                filter_summary,
                resume_match_score,
                resume_match_summary,
                preference_score,
                company_score,
                company_risk_summary,
                score_reason_json,
                source_hash: source_hash_value,
            })
        },
    )
    .map_err(Into::into)
}

fn parse_json(raw: Option<&str>) -> Value {
    raw.and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or(Value::Null)
}

fn list_summary_source_hash(
    filter_eligible: Option<bool>,
    filter_reason_json: Option<&str>,
    resume_match_score: Option<f64>,
    resume_result_json: Option<&str>,
    company_score: f64,
    risk_flags_json: Option<&str>,
    confidence: f64,
) -> String {
    source_hash(&format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
        filter_eligible.unwrap_or(false),
        filter_reason_json.unwrap_or(""),
        resume_match_score.unwrap_or(0.0),
        resume_result_json.unwrap_or(""),
        company_score,
        risk_flags_json.unwrap_or(""),
        confidence
    ))
}

fn parse_string_array_json(raw: Option<&str>) -> Vec<String> {
    parse_json(raw)
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn summarize_ai_audit(parsed: &Value, filter_eligible: Option<bool>) -> (String, String) {
    let judgement = parsed.get("ai_judgement");
    let status = judgement
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            judgement
                .and_then(|value| value.get("bucket"))
                .and_then(Value::as_str)
                .or_else(|| parsed.get("bucket").and_then(Value::as_str))
                .and_then(|bucket| match bucket {
                    "recommended" => Some("passed".to_string()),
                    "pending_confirmation" => Some("pending_confirmation".to_string()),
                    "filtered" => Some("rejected".to_string()),
                    _ => None,
                })
        })
        .or_else(|| {
            if filter_eligible == Some(false) {
                Some("rejected".to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "not_judged".to_string());
    let summary = judgement
        .and_then(|value| value.get("summary"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| match status.as_str() {
            "processing" => "AI 正在审核".to_string(),
            "passed" => "AI 已通过筛选".to_string(),
            "pending_confirmation" => "AI 待确认".to_string(),
            "failed" => "AI 审核失败".to_string(),
            "rejected" => "AI 未通过筛选".to_string(),
            _ => "待 AI 判断".to_string(),
        });
    (status, summary)
}

fn summarize_filter_reason(parsed: &Value, filter_eligible: Option<bool>) -> String {
    if parsed.is_null() {
        return if filter_eligible == Some(true) {
            "通过筛选规则".to_string()
        } else {
            "暂无筛选规则结果".to_string()
        };
    }
    let matched = string_array(parsed.get("matched_preferences"));
    let missing = string_array(parsed.get("missing_preferences"));
    let mut parts = Vec::new();
    if !matched.is_empty() {
        parts.push(format!(
            "偏好命中：{}",
            matched
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    if !missing.is_empty() {
        parts.push(format!(
            "偏好缺失：{}",
            missing
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("、")
        ));
    }
    if parts.is_empty() {
        if filter_eligible == Some(true) {
            "通过筛选规则".to_string()
        } else {
            "不满足筛选规则".to_string()
        }
    } else {
        parts.join("；")
    }
}

fn resume_summary(parsed: &Value) -> Option<String> {
    for key in ["summary", "experience_fit", "experienceFit"] {
        if let Some(text) = parsed
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Some(text.to_string());
        }
    }
    None
}

fn build_resume_reason_projection(
    parsed: &Value,
    resume_match_score: Option<f64>,
) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    if let Some(score) = resume_match_score.or_else(|| {
        json_number_from_keys(parsed, &["resume_match_score", "matchScore", "match_score"])
    }) {
        out.insert("resume_match_score".to_string(), json!(score));
    }
    if let Some(summary) = resume_summary(parsed) {
        out.insert("summary".to_string(), json!(summary));
    }
    insert_string_array(
        &mut out,
        "matched_stack",
        string_array_from_keys(parsed, &["matched_stack", "matchedStack"]),
    );
    insert_string_array(
        &mut out,
        "matched_direction",
        string_array_from_keys(parsed, &["matched_direction", "matchedDirection"]),
    );
    insert_string_array(
        &mut out,
        "matched_resume_evidence",
        string_array_from_keys(
            parsed,
            &[
                "matched_resume_evidence",
                "matchedResumeEvidence",
                "resume_evidence",
            ],
        ),
    );
    insert_string_array(
        &mut out,
        "missing_points",
        string_array_from_keys(parsed, &["missing_points", "missingPoints"]),
    );
    if let Some(value) = string_from_keys(parsed, &["experience_fit", "experienceFit"]) {
        out.insert("experience_fit".to_string(), json!(value));
    }
    if let Some(value) = json_number_from_keys(
        parsed,
        &["confidence", "confidence_score", "confidenceScore"],
    ) {
        out.insert("confidence".to_string(), json!(value));
    }
    out
}

fn insert_string_array(out: &mut serde_json::Map<String, Value>, key: &str, values: Vec<String>) {
    if !values.is_empty() {
        out.insert(key.to_string(), json!(values));
    }
}

fn string_array_from_keys(parsed: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| {
            let values = string_array(parsed.get(*key));
            if values.is_empty() {
                None
            } else {
                Some(values)
            }
        })
        .unwrap_or_default()
}

fn string_from_keys(parsed: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        parsed
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn json_number_from_keys(parsed: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| parsed.get(*key).and_then(json_number))
}

fn json_number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| {
        value
            .as_str()
            .and_then(|text| text.trim().parse::<f64>().ok())
    })
}

fn compute_preference_score(matched_count: usize, missing_count: usize) -> f64 {
    let total = matched_count + missing_count;
    if total == 0 {
        return 80.0;
    }
    (matched_count as f64 / total as f64 * 100.0).round()
}
