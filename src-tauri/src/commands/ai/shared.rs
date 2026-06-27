use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize)]
pub(super) struct JobAiContext {
    pub filter_reason: Option<Value>,
    pub score_reason: Option<Value>,
    pub source_context: Option<Value>,
    pub review_context: Option<Value>,
}

pub(super) fn load_job_ai_context(
    conn: &rusqlite::Connection,
    encrypt_job_id: &str,
) -> Result<JobAiContext, String> {
    let filter_reason: Option<String> = conn
        .query_row(
            "SELECT reason_json FROM job_filter_result WHERE encrypt_job_id = ?1 LIMIT 1",
            [encrypt_job_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let score_reason: Option<String> = conn
        .query_row(
            r#"
      SELECT
        json_object(
          'weights', json_object(
            'resume', COALESCE(json_extract(p.profile_json, '$.scoreWeights.resume'), 0.6),
            'preference', COALESCE(json_extract(p.profile_json, '$.scoreWeights.preference'), 0.25),
            'company', COALESCE(json_extract(p.profile_json, '$.scoreWeights.company'), 0.15)
          ),
          'resume_match_score', (
            SELECT ar.match_score
            FROM ai_report ar
            WHERE ar.encrypt_job_id = j.encrypt_job_id
              AND (ar.kind = 'resume' OR ar.kind IS NULL)
            ORDER BY ar.created_at DESC, ar.id DESC
            LIMIT 1
          ),
          'preference', json_object(
            'matched', COALESCE(json_extract(r.reason_json, '$.matched_preferences'), json('[]')),
            'missing', COALESCE(json_extract(r.reason_json, '$.missing_preferences'), json('[]'))
          ),
          'company', json_object(
            'company_score', cs.company_score,
            'risk_flags', COALESCE(json_extract(cs.risk_flags_json, '$'), json('[]')),
            'evidence', COALESCE(json_extract(cs.evidence_json, '$'), json('[]'))
          )
        )
      FROM job j
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_score cs ON cs.company_name = j.brand_name
      LEFT JOIN filter_profile p ON p.is_default = 1
      WHERE j.encrypt_job_id = ?1
      LIMIT 1
      "#,
            [encrypt_job_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let source_context: Option<String> = conn
        .query_row(
            r#"
      SELECT
        json_object(
          'source_platform', COALESCE(NULLIF(j.source_platform, ''), 'boss'),
          'source_url', j.source_url,
          'dedup_key', j.dedup_key,
          'last_seen_at', j.last_seen_at,
          'default_profile', json_object(
            'id', p.id,
            'name', p.name,
            'allowed_source_platforms', COALESCE(json_extract(p.profile_json, '$.sourcePlatforms'), json('[]'))
          )
        )
      FROM job j
      LEFT JOIN filter_profile p ON p.is_default = 1
      WHERE j.encrypt_job_id = ?1
      LIMIT 1
      "#,
            [encrypt_job_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let review_context: Option<String> = conn
        .query_row(
            r#"
      SELECT
        json_object(
          'review_status', COALESCE(rs.review_status, 'pending'),
          'communication_status', COALESCE(rs.communication_status, 'not_contacted'),
          'last_greeted_at', rs.last_greeted_at,
          'notes', rs.notes,
          'updated_at', rs.updated_at
        )
      FROM job j
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      WHERE j.encrypt_job_id = ?1
      LIMIT 1
      "#,
            [encrypt_job_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let mut score_reason = parse_optional_json(score_reason)?;
    attach_latest_resume_score_reason(conn, encrypt_job_id, score_reason.as_mut())?;

    Ok(JobAiContext {
        filter_reason: parse_optional_json(filter_reason)?,
        score_reason,
        source_context: parse_optional_json(source_context)?,
        review_context: parse_optional_json(review_context)?,
    })
}

fn attach_latest_resume_score_reason(
    conn: &rusqlite::Connection,
    encrypt_job_id: &str,
    score_reason: Option<&mut Value>,
) -> Result<(), String> {
    let Some(score_reason) = score_reason else {
        return Ok(());
    };
    let latest_resume: Option<(Option<f64>, Option<String>)> = conn
        .query_row(
            r#"
      SELECT match_score, result_json
      FROM ai_report
      WHERE encrypt_job_id = ?1
        AND (kind = 'resume' OR kind IS NULL)
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      "#,
            [encrypt_job_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((match_score, result_json)) = latest_resume else {
        return Ok(());
    };
    let report = result_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
    let (resume_match_score, resume_reason) =
        build_resume_score_reason(match_score, report.as_ref());

    if let Some(object) = score_reason.as_object_mut() {
        if let Some(score) = resume_match_score {
            object.insert("resume_match_score".to_string(), json!(score));
        }
        object.insert("resume".to_string(), resume_reason);
    }
    Ok(())
}

fn build_resume_score_reason(
    match_score: Option<f64>,
    report: Option<&Value>,
) -> (Option<f64>, Value) {
    let resume_match_score =
        json_number_from_keys(report, &["resume_match_score", "matchScore", "match_score"])
            .or(match_score);
    (
        resume_match_score,
        json!({
          "resume_match_score": resume_match_score,
          "matched_stack": json_string_array_from_keys(report, &["matched_stack", "matchedStack"]),
          "matched_direction": json_string_array_from_keys(report, &["matched_direction", "matchedDirection"]),
          "matched_resume_evidence": json_string_array_from_keys(report, &["matched_resume_evidence", "matchedResumeEvidence", "resume_evidence"]),
          "experience_fit": json_string_from_keys(report, &["experience_fit", "experienceFit"]),
          "missing_points": json_string_array_from_keys(report, &["missing_points", "missingPoints"]),
          "confidence": json_number_from_keys(report, &["confidence", "confidence_score", "confidenceScore"]),
          "strengths": json_string_array_from_keys(report, &["strengths", "pros", "advantages", "highlights"]),
          "gaps": json_string_array_from_keys(report, &["gaps", "cons", "weaknesses", "missing"])
        }),
    )
}

fn json_number_from_keys(value: Option<&Value>, keys: &[&str]) -> Option<f64> {
    let value = value?;
    for key in keys {
        match value.get(*key) {
            Some(Value::Number(number)) => return number.as_f64(),
            Some(Value::String(text)) => {
                if let Ok(number) = text.trim().parse::<f64>() {
                    return Some(number);
                }
            }
            _ => {}
        }
    }
    None
}

fn json_string_from_keys(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let value = value?;
    for key in keys {
        if let Some(text) = value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return Some(text.to_string());
        }
    }
    None
}

fn json_string_array_from_keys(value: Option<&Value>, keys: &[&str]) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    for key in keys {
        let items = json_string_array_value(value.get(*key));
        if !items.is_empty() {
            return items;
        }
    }
    Vec::new()
}

fn json_string_array_value(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect(),
        Some(Value::String(text)) => text
            .split(['\n', ',', '，', ';', '；'])
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn parse_optional_json(raw: Option<String>) -> Result<Option<Value>, String> {
    raw.as_deref()
        .map(|value| serde_json::from_str(value).map_err(|e| e.to_string()))
        .transpose()
}

pub(super) fn load_job_detail_raw(
    conn: &rusqlite::Connection,
    encrypt_job_id: &str,
) -> Result<String, String> {
    conn
    .query_row(
      "SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = ?1",
      [encrypt_job_id],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| {
      "未找到该职位的详情数据，请先采集该职位详情（在职位库展开该职位或运行自动采集）后再进行 AI 分析。".to_string()
    })
}
