use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::Digest;
use time::format_description::well_known::Rfc3339;

#[derive(Debug, Clone, Serialize)]
pub(super) struct JobAiContext {
    pub filter_reason: Option<Value>,
    pub score_reason: Option<Value>,
    pub source_context: Option<Value>,
    pub review_context: Option<Value>,
}

pub(super) fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc().format(&Rfc3339).unwrap()
}

pub(super) fn sha256_hex(input: &str) -> String {
    let mut hasher = sha2::Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

pub(super) fn build_group_encrypt_job_id(sorted_job_ids: &[String]) -> String {
    let mut hasher = sha2::Sha256::new();
    for id in sorted_job_ids {
        hasher.update(id.as_bytes());
        hasher.update(b"\n");
    }
    format!("group:{}", hex::encode(hasher.finalize()))
}

pub(super) fn serialize_job_ai_context(context: &JobAiContext) -> Result<String, String> {
    serde_json::to_string(context).map_err(|e| e.to_string())
}

pub(super) fn attach_job_ai_context(target: &mut Value, context: &JobAiContext) {
    let Some(object) = target.as_object_mut() else {
        return;
    };

    if let Some(value) = context.filter_reason.clone() {
        object.insert("filter_reason".to_string(), value);
    }
    if let Some(value) = context.score_reason.clone() {
        object.insert("score_reason".to_string(), value);
    }
    if let Some(value) = context.source_context.clone() {
        object.insert("source_context".to_string(), value);
    }
    if let Some(value) = context.review_context.clone() {
        object.insert("review_context".to_string(), value);
    }
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

fn json_get_str<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_str()
}

fn json_get_str_array(value: &Value, path: &[&str]) -> Vec<String> {
    let mut cursor = value;
    for key in path {
        match cursor.get(*key) {
            Some(next) => cursor = next,
            None => return Vec::new(),
        }
    }

    match cursor.as_array() {
        None => Vec::new(),
        Some(items) => items
            .iter()
            .filter_map(|item| item.as_str())
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect(),
    }
}

fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ => {
                if !in_tag {
                    out.push(ch);
                }
            }
        }
    }
    out
}

fn collapse_whitespace(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_space = false;
    for ch in input.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
            continue;
        }
        prev_space = false;
        out.push(ch);
    }
    out.trim().to_string()
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }

    let mut out = String::with_capacity(input.len().min(max_chars + 1));
    for (index, ch) in input.chars().enumerate() {
        if index >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn html_to_text_truncated(input: &str, max_chars: usize) -> String {
    let stripped = strip_html_tags(input);
    let collapsed = collapse_whitespace(&stripped);
    truncate_chars(&collapsed, max_chars)
}

pub(super) fn build_job_outline(encrypt_job_id: &str, zp_data: &Value) -> Value {
    let position_name = json_get_str(zp_data, &["jobInfo", "jobName"])
        .or_else(|| json_get_str(zp_data, &["jobName"]))
        .or_else(|| json_get_str(zp_data, &["jobInfo", "positionName"]))
        .or_else(|| json_get_str(zp_data, &["positionName"]))
        .map(|value| value.to_string());
    let brand_name = json_get_str(zp_data, &["brandComInfo", "brandName"])
        .or_else(|| json_get_str(zp_data, &["brandInfo", "brandName"]))
        .or_else(|| json_get_str(zp_data, &["brandName"]))
        .map(|value| value.to_string());
    let city_name = json_get_str(zp_data, &["jobInfo", "locationName"])
        .or_else(|| json_get_str(zp_data, &["jobInfo", "cityName"]))
        .or_else(|| json_get_str(zp_data, &["locationName"]))
        .or_else(|| json_get_str(zp_data, &["cityName"]))
        .map(|value| value.to_string());
    let salary_desc = json_get_str(zp_data, &["jobInfo", "salaryDesc"])
        .or_else(|| json_get_str(zp_data, &["salaryDesc"]))
        .map(|value| value.to_string());
    let experience_name = json_get_str(zp_data, &["jobInfo", "experienceName"])
        .or_else(|| json_get_str(zp_data, &["experienceName"]))
        .or_else(|| json_get_str(zp_data, &["jobExperience"]))
        .map(|value| value.to_string());
    let degree_name = json_get_str(zp_data, &["jobInfo", "degreeName"])
        .or_else(|| json_get_str(zp_data, &["degreeName"]))
        .or_else(|| json_get_str(zp_data, &["jobDegree"]))
        .map(|value| value.to_string());

    let mut skills = json_get_str_array(zp_data, &["jobInfo", "skills"]);
    if skills.is_empty() {
        skills = json_get_str_array(zp_data, &["jobInfo", "showSkills"]);
    }
    if skills.is_empty() {
        skills = json_get_str_array(zp_data, &["skills"]);
    }

    let mut job_labels = json_get_str_array(zp_data, &["jobInfo", "jobLabels"]);
    if job_labels.is_empty() {
        job_labels = json_get_str_array(zp_data, &["jobLabels"]);
    }

    let post_desc_raw = json_get_str(zp_data, &["jobInfo", "postDescription"])
        .or_else(|| json_get_str(zp_data, &["postDescription"]))
        .unwrap_or("");
    let post_description = if post_desc_raw.trim().is_empty() {
        None
    } else {
        Some(html_to_text_truncated(post_desc_raw, 2000))
    };

    serde_json::json!({
      "encrypt_job_id": encrypt_job_id,
      "position_name": position_name,
      "brand_name": brand_name,
      "city_name": city_name,
      "salary_desc": salary_desc,
      "experience_name": experience_name,
      "degree_name": degree_name,
      "skills": skills,
      "job_labels": job_labels,
      "post_description": post_description,
    })
}

pub(super) fn describe_job_brief(
    conn: &rusqlite::Connection,
    encrypt_job_id: &str,
) -> Option<String> {
    let row: Option<(Option<String>, Option<String>, Option<String>, Option<String>)> = conn
    .query_row(
      "SELECT position_name, brand_name, city_name, salary_desc FROM job WHERE encrypt_job_id = ?1",
      [encrypt_job_id],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .optional()
    .ok()
    .flatten();

    let Some((position_name, brand_name, city_name, salary_desc)) = row else {
        return None;
    };

    let title = position_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(encrypt_job_id);

    let mut parts: Vec<&str> = Vec::new();
    if let Some(value) = brand_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(value);
    }
    if let Some(value) = city_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(value);
    }
    if let Some(value) = salary_desc
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(value);
    }

    if parts.is_empty() {
        return Some(title.to_string());
    }

    Some(format!("{title}（{}）", parts.join(" · ")))
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
