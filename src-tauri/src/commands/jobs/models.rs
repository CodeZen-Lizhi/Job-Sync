use serde::Serialize;
use serde_json::{json, Value};

use crate::db::models::compute_company_score;

const SCORE_WEIGHT_RESUME: f64 = 0.6;
const SCORE_WEIGHT_PREFERENCE: f64 = 0.25;
const SCORE_WEIGHT_COMPANY: f64 = 0.15;

#[derive(Clone, Copy, Debug)]
pub(super) struct ScoreWeights {
    resume: f64,
    preference: f64,
    company: f64,
}

impl Default for ScoreWeights {
    fn default() -> Self {
        Self {
            resume: SCORE_WEIGHT_RESUME,
            preference: SCORE_WEIGHT_PREFERENCE,
            company: SCORE_WEIGHT_COMPANY,
        }
    }
}

impl ScoreWeights {
    pub(super) fn from_profile_json(profile_json: &Value) -> Self {
        let weights = profile_json
            .get("scoreWeights")
            .or_else(|| profile_json.get("score_weights"));
        let Some(Value::Object(map)) = weights else {
            return Self::default();
        };
        let raw = Self {
            resume: json_number(map.get("resume")).unwrap_or(SCORE_WEIGHT_RESUME),
            preference: json_number(map.get("preference")).unwrap_or(SCORE_WEIGHT_PREFERENCE),
            company: json_number(map.get("company")).unwrap_or(SCORE_WEIGHT_COMPANY),
        };
        raw.normalized()
    }

    fn normalized(self) -> Self {
        let resume = positive_weight(self.resume);
        let preference = positive_weight(self.preference);
        let company = positive_weight(self.company);
        let total = resume + preference + company;
        if total <= 0.0 {
            return Self::default();
        }
        Self {
            resume: round_weight(resume / total),
            preference: round_weight(preference / total),
            company: round_weight(company / total),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct JobRow {
    pub encrypt_job_id: String,
    pub source_platform: String,
    pub source_url: Option<String>,
    pub dedup_key: Option<String>,
    pub position_name: Option<String>,
    pub boss_name: Option<String>,
    pub brand_name: Option<String>,
    pub city_name: Option<String>,
    pub salary_desc: Option<String>,
    pub experience_name: Option<String>,
    pub degree_name: Option<String>,
    pub last_seen_at: Option<String>,
    pub filter_eligible: Option<bool>,
    pub filter_reason_json: Option<String>,
    pub filter_updated_at: Option<String>,
    pub review_status: Option<String>,
    pub communication_status: Option<String>,
    pub last_greeted_at: Option<String>,
    pub review_notes: Option<String>,
    pub review_updated_at: Option<String>,
    pub company_review_status: Option<String>,
    pub company_review_notes: Option<String>,
    pub company_blacklisted: bool,
    pub job_blacklisted: bool,
    pub keyword_blacklisted: bool,
    pub blacklist_reason: Option<String>,
    pub company_negative_communication_count: i64,
    pub latest_company_negative_communication_status: Option<String>,
    pub latest_company_negative_communication_at: Option<String>,
    pub resume_match_score: Option<f64>,
    pub preference_score: f64,
    pub company_score: f64,
    pub final_score: f64,
    pub score_reason_json: String,
}

#[derive(Debug, Serialize)]
pub struct KeywordGroup {
    pub keyword: Option<String>,
    pub label: String,
    pub job_count: i64,
}

#[derive(Debug, Serialize)]
pub struct JobBlacklistEntry {
    pub id: i64,
    pub kind: String,
    pub value: String,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct JobDailyIntelligenceCandidate {
    pub encrypt_job_id: String,
    pub source_platform: String,
    pub source_url: Option<String>,
    pub dedup_key: Option<String>,
    pub position_name: Option<String>,
    pub brand_name: Option<String>,
    pub city_name: Option<String>,
    pub final_score: f64,
    pub resume_match_score: Option<f64>,
    pub preference_score: f64,
    pub company_score: f64,
    pub recommendation_reason: String,
    pub score_reason_json: String,
}

#[derive(Debug, Serialize)]
pub struct JobDailyIntelligence {
    pub report_date: String,
    pub generated_at: String,
    pub today_new_jobs: i64,
    pub high_match_jobs: i64,
    pub eligible_jobs: i64,
    pub recommended_jobs: i64,
    pub ready_to_apply_jobs: i64,
    pub applied_jobs: i64,
    pub high_match_threshold: f64,
    pub recommendation_threshold: f64,
    pub recommended_candidates: Vec<JobDailyIntelligenceCandidate>,
    pub notification_text: String,
    pub notification_brief_text: String,
}

#[derive(Debug, Serialize)]
pub struct CompanyScoreRebuildResult {
    pub companies: u64,
    pub jobs: u64,
}

#[derive(Debug, Serialize)]
pub struct JobSourceEntry {
    pub platform: String,
    pub display_name: String,
    pub adapter_kind: String,
    pub enabled: bool,
    pub config_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub(super) fn map_job_row_with_score_weights(
    row: &rusqlite::Row,
    score_weights: ScoreWeights,
) -> rusqlite::Result<JobRow> {
    let filter_reason_json: Option<String> = row.get(13)?;
    let resume_match_score = row.get::<_, Option<f64>>(27)?.map(clamp_score);
    let resume_result_json: Option<String> = row.get(28)?;
    let score_source_text: Option<String> = row.get(29)?;
    let cached_company_score = row.get::<_, Option<f64>>(30)?.map(clamp_score);
    let cached_risk_flags_json: Option<String> = row.get(31)?;
    let cached_evidence_json: Option<String> = row.get(32)?;
    let cached_company_confidence = row.get::<_, Option<f64>>(33)?.map(clamp_confidence);
    let score = compute_score_projection(
        resume_match_score,
        resume_result_json.as_deref(),
        filter_reason_json.as_deref(),
        score_source_text.as_deref().unwrap_or(""),
        cached_company_score,
        cached_risk_flags_json.as_deref(),
        cached_evidence_json.as_deref(),
        cached_company_confidence,
        score_weights,
    );

    Ok(JobRow {
        encrypt_job_id: row.get(0)?,
        source_platform: row.get(1)?,
        source_url: row.get(2)?,
        dedup_key: row.get(3)?,
        position_name: row.get(4)?,
        boss_name: row.get(5)?,
        brand_name: row.get(6)?,
        city_name: row.get(7)?,
        salary_desc: row.get(8)?,
        experience_name: row.get(9)?,
        degree_name: row.get(10)?,
        last_seen_at: row.get(11)?,
        filter_eligible: row.get::<_, Option<i64>>(12)?.map(|value| value != 0),
        filter_reason_json,
        filter_updated_at: row.get(14)?,
        review_status: row.get(15)?,
        communication_status: row.get(16)?,
        last_greeted_at: row.get(17)?,
        review_notes: row.get(18)?,
        review_updated_at: row.get(19)?,
        company_review_status: row.get(20)?,
        company_review_notes: row.get(21)?,
        company_blacklisted: row.get::<_, i64>(22)? != 0,
        job_blacklisted: row.get::<_, i64>(23)? != 0,
        keyword_blacklisted: row.get::<_, i64>(25)? != 0,
        blacklist_reason: row
            .get::<_, Option<String>>(24)?
            .or_else(|| row.get::<_, Option<String>>(26).ok().flatten()),
        company_negative_communication_count: row.get(34)?,
        latest_company_negative_communication_status: row.get(35)?,
        latest_company_negative_communication_at: row.get(36)?,
        resume_match_score,
        preference_score: score.preference_score,
        company_score: score.company_score,
        final_score: score.final_score,
        score_reason_json: score.reason_json,
    })
}

struct ScoreProjection {
    preference_score: f64,
    company_score: f64,
    final_score: f64,
    reason_json: String,
}

fn compute_score_projection(
    resume_match_score: Option<f64>,
    resume_result_json: Option<&str>,
    filter_reason_json: Option<&str>,
    score_source_text: &str,
    cached_company_score: Option<f64>,
    cached_risk_flags_json: Option<&str>,
    cached_evidence_json: Option<&str>,
    cached_company_confidence: Option<f64>,
    score_weights: ScoreWeights,
) -> ScoreProjection {
    let score_weights = score_weights.normalized();
    let resume_reason = parse_resume_reason(resume_result_json);
    let (matched_preferences, missing_preferences) = parse_preference_reasons(filter_reason_json);
    let preference_score =
        compute_preference_score(matched_preferences.len(), missing_preferences.len());
    let fallback_company = compute_company_score(score_source_text);
    let fallback_company_confidence = fallback_company.confidence;
    let company_score = cached_company_score.unwrap_or(fallback_company.company_score);
    let risk_flags = cached_risk_flags_json
        .and_then(parse_string_json_array)
        .unwrap_or(fallback_company.risk_flags);
    let evidence = cached_evidence_json
        .and_then(parse_string_json_array)
        .unwrap_or(fallback_company.evidence);
    let company_confidence = if cached_company_score.is_some() {
        cached_company_confidence.unwrap_or_else(|| {
            estimate_cached_company_confidence(&risk_flags, fallback_company_confidence)
        })
    } else {
        fallback_company_confidence
    };
    let final_score = round_score(
        score_weights.resume * resume_match_score.unwrap_or(0.0)
            + score_weights.preference * preference_score
            + score_weights.company * company_score,
    );
    let reason_json = serde_json::to_string(&json!({
      "weights": {
        "resume": score_weights.resume,
        "preference": score_weights.preference,
        "company": score_weights.company
      },
      "preference": {
        "matched": matched_preferences,
        "missing": missing_preferences
      },
      "resume": resume_reason,
      "company": {
        "company_score": company_score,
        "risk_flags": risk_flags,
        "evidence": evidence,
        "confidence": company_confidence
      }
    }))
    .unwrap_or_else(|_| "{}".to_string());

    ScoreProjection {
        preference_score,
        company_score,
        final_score,
        reason_json,
    }
}

fn parse_resume_reason(resume_result_json: Option<&str>) -> Value {
    let Some(raw) = resume_result_json else {
        return json!({});
    };
    let Ok(parsed) = serde_json::from_str::<Value>(raw) else {
        return json!({});
    };
    json!({
      "resume_match_score": json_number(parsed.get("resume_match_score"))
        .or_else(|| json_number(parsed.get("matchScore")))
        .or_else(|| json_number(parsed.get("match_score")))
        .map(clamp_score),
      "matched_stack": json_string_array_from_keys(&parsed, &["matched_stack", "matchedStack"]),
      "matched_direction": json_string_array_from_keys(&parsed, &["matched_direction", "matchedDirection"]),
      "matched_resume_evidence": json_string_array_from_keys(&parsed, &["matched_resume_evidence", "matchedResumeEvidence", "resume_evidence"]),
      "experience_fit": json_string_from_keys(&parsed, &["experience_fit", "experienceFit"]),
      "missing_points": json_string_array_from_keys(&parsed, &["missing_points", "missingPoints"]),
      "confidence": json_number(parsed.get("confidence"))
        .or_else(|| json_number(parsed.get("confidence_score")))
        .or_else(|| json_number(parsed.get("confidenceScore")))
        .map(clamp_confidence),
      "strengths": resume_strengths(&parsed),
      "gaps": resume_gaps(&parsed),
      "keywordSuggestions": json_string_array_from_keys(&parsed, &["keywordSuggestions", "keyword_suggestions", "keywords", "keyword"]),
      "riskNotes": json_string_array_from_keys(&parsed, &["riskNotes", "risk_notes", "risks", "warnings"])
    })
}

fn resume_strengths(parsed: &Value) -> Vec<String> {
    unique_string_array([
        json_string_array_from_keys(parsed, &["strengths", "pros", "advantages", "highlights"]),
        json_string_array_from_keys(parsed, &["matched_resume_evidence", "resume_evidence"]),
        labeled_json_string_array(parsed, "匹配技术栈", &["matched_stack"]),
        labeled_json_string_array(parsed, "匹配岗位方向", &["matched_direction"]),
        labeled_json_string_array(parsed, "经验匹配", &["experience_fit"]),
    ])
}

fn resume_gaps(parsed: &Value) -> Vec<String> {
    unique_string_array([
        json_string_array_from_keys(parsed, &["gaps", "cons", "weaknesses", "missing"]),
        json_string_array_from_keys(parsed, &["missing_points", "missingPoints"]),
    ])
}

fn json_string_array_from_keys(value: &Value, keys: &[&str]) -> Vec<String> {
    for key in keys {
        let items = json_string_array(value.get(*key));
        if !items.is_empty() {
            return items;
        }
    }
    Vec::new()
}

fn json_string_from_keys(value: &Value, keys: &[&str]) -> Option<String> {
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

fn labeled_json_string_array(value: &Value, label: &str, keys: &[&str]) -> Vec<String> {
    let items = json_string_array_from_keys(value, keys);
    if items.is_empty() {
        Vec::new()
    } else {
        vec![format!("{label}：{}", items.join("、"))]
    }
}

fn unique_string_array<const N: usize>(groups: [Vec<String>; N]) -> Vec<String> {
    let mut out = Vec::new();
    for item in groups.into_iter().flatten() {
        let trimmed = item.trim();
        if trimmed.is_empty()
            || out
                .iter()
                .any(|existing: &String| existing.eq_ignore_ascii_case(trimmed))
        {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

fn parse_preference_reasons(filter_reason_json: Option<&str>) -> (Vec<String>, Vec<String>) {
    let Some(raw) = filter_reason_json else {
        return (Vec::new(), Vec::new());
    };
    let Ok(parsed) = serde_json::from_str::<Value>(raw) else {
        return (Vec::new(), Vec::new());
    };
    (
        json_string_array(parsed.get("matched_preferences")),
        json_string_array(parsed.get("missing_preferences")),
    )
}

fn estimate_cached_company_confidence(risk_flags: &[String], fallback_confidence: f64) -> f64 {
    if risk_flags.iter().any(|flag| flag != "low_info_risk") {
        return 0.82;
    }
    if risk_flags.iter().any(|flag| flag == "low_info_risk") {
        return 0.55;
    }
    fallback_confidence
}

fn json_string_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect(),
        Some(Value::String(text)) => split_string_items(text).collect(),
        _ => Vec::new(),
    }
}

fn split_string_items(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(['\n', ',', '，', ';', '；'])
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
}

fn json_number(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn compute_preference_score(matched: usize, missing: usize) -> f64 {
    let total = matched + missing;
    if total == 0 {
        return 50.0;
    }
    round_score((matched as f64 / total as f64) * 100.0)
}

fn clamp_score(value: f64) -> f64 {
    if value.is_nan() {
        return 0.0;
    }
    value.clamp(0.0, 100.0)
}

fn clamp_confidence(value: f64) -> f64 {
    if value.is_nan() {
        return 0.0;
    }
    value.clamp(0.0, 1.0)
}

fn positive_weight(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        0.0
    }
}

fn parse_string_json_array(raw: &str) -> Option<Vec<String>> {
    serde_json::from_str::<Value>(raw)
        .ok()
        .map(|value| json_string_array(Some(&value)))
}

fn round_score(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn round_weight(value: f64) -> f64 {
    (value * 10000.0).round() / 10000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compute_score_projection_prefers_resume_and_penalizes_risks() {
        let projection = compute_score_projection(
            Some(92.0),
            Some(
                r#"{"strengths":["简历包含 Kubernetes 平台建设"],"gaps":["AWS 经验未明确"],"keywordSuggestions":["Prometheus"]}"#,
            ),
            Some(r#"{"matched_preferences":["Go","Kubernetes"],"missing_preferences":["AWS"]}"#),
            "Go Kubernetes AWS 外包",
            None,
            None,
            None,
            None,
            ScoreWeights::default(),
        );

        assert!((projection.preference_score - 66.67).abs() < 0.01);
        assert!(projection.company_score < 80.0);
        assert!(projection.final_score > 70.0);
        let reason: Value = serde_json::from_str(&projection.reason_json).expect("reason json");
        assert_eq!(reason["preference"]["matched"][0], json!("Go"));
        assert_eq!(
            reason["resume"]["strengths"][0],
            json!("简历包含 Kubernetes 平台建设")
        );
        assert_eq!(reason["resume"]["gaps"][0], json!("AWS 经验未明确"));
        assert_eq!(reason["company"]["confidence"].as_f64(), Some(0.82));
    }

    #[test]
    fn compute_score_projection_reads_requirement_doc_resume_reason_fields() {
        let projection = compute_score_projection(
            Some(91.0),
            Some(
                r#"{
          "resume_match_score": 91,
          "matched_stack": ["Go", "Kubernetes", "Docker", "Prometheus"],
          "matched_direction": ["Infra", "SRE"],
          "matched_resume_evidence": ["简历项目中包含 Kubernetes 平台建设经历"],
          "experience_fit": "3-5年",
          "missing_points": ["AWS 经验未明确"],
          "confidence": 0.87
        }"#,
            ),
            Some(r#"{"matched_preferences":["Go"],"missing_preferences":["AI Infra"]}"#),
            "Go Kubernetes 平台工程",
            Some(80.0),
            None,
            None,
            None,
            ScoreWeights::default(),
        );
        let reason: Value = serde_json::from_str(&projection.reason_json).expect("reason json");
        let strengths = reason["resume"]["strengths"]
            .as_array()
            .expect("strengths array");
        let gaps = reason["resume"]["gaps"].as_array().expect("gaps array");

        assert!(strengths
            .iter()
            .any(|item| item.as_str() == Some("简历项目中包含 Kubernetes 平台建设经历")));
        assert_eq!(reason["resume"]["resume_match_score"].as_f64(), Some(91.0));
        assert_eq!(reason["resume"]["matched_stack"][0], json!("Go"));
        assert_eq!(reason["resume"]["matched_direction"][0], json!("Infra"));
        assert_eq!(
            reason["resume"]["matched_resume_evidence"][0],
            json!("简历项目中包含 Kubernetes 平台建设经历")
        );
        assert_eq!(reason["resume"]["experience_fit"], json!("3-5年"));
        assert_eq!(
            reason["resume"]["missing_points"][0],
            json!("AWS 经验未明确")
        );
        assert_eq!(reason["resume"]["confidence"].as_f64(), Some(0.87));
        assert!(strengths
            .iter()
            .any(|item| item.as_str() == Some("匹配技术栈：Go、Kubernetes、Docker、Prometheus")));
        assert!(strengths
            .iter()
            .any(|item| item.as_str() == Some("匹配岗位方向：Infra、SRE")));
        assert!(strengths
            .iter()
            .any(|item| item.as_str() == Some("经验匹配：3-5年")));
        assert!(gaps
            .iter()
            .any(|item| item.as_str() == Some("AWS 经验未明确")));
    }

    #[test]
    fn compute_score_projection_uses_neutral_preference_when_empty() {
        let projection = compute_score_projection(
      Some(70.0),
      None,
      None,
      "常规岗位，负责 Go 后端平台、Kubernetes 集群运维、Prometheus 监控体系建设、CI/CD 流水线优化、云原生基础设施稳定性治理、Linux 服务排障、容量规划和跨团队技术协作。",
      None,
      None,
      None,
      None,
      ScoreWeights::default(),
    );

        assert_eq!(projection.preference_score, 50.0);
        assert_eq!(projection.company_score, 80.0);
        assert!((projection.final_score - 66.5).abs() < 0.01);
    }

    #[test]
    fn compute_score_projection_reuses_cached_company_score() {
        let projection = compute_score_projection(
            Some(70.0),
            None,
            None,
            "常规岗位",
            Some(40.0),
            Some(r#"["outsourcing_risk"]"#),
            Some(r#"["同公司历史岗位出现外包风险"]"#),
            Some(0.61),
            ScoreWeights::default(),
        );
        let reason: Value = serde_json::from_str(&projection.reason_json).expect("reason json");

        assert_eq!(projection.company_score, 40.0);
        assert_eq!(reason["company"]["company_score"].as_f64(), Some(40.0));
        assert_eq!(
            reason["company"]["risk_flags"][0],
            json!("outsourcing_risk")
        );
        assert_eq!(reason["company"]["confidence"].as_f64(), Some(0.61));
        assert!(projection.final_score < 68.0);
    }

    #[test]
    fn compute_score_projection_uses_profile_weights() {
        let weights = ScoreWeights::from_profile_json(&json!({
          "scoreWeights": {
            "resume": 1,
            "preference": 0,
            "company": 0
          }
        }));
        let projection = compute_score_projection(
            Some(70.0),
            None,
            None,
            "常规岗位",
            Some(20.0),
            None,
            None,
            None,
            weights,
        );
        let reason: Value = serde_json::from_str(&projection.reason_json).expect("reason json");

        assert_eq!(projection.final_score, 70.0);
        assert_eq!(reason["weights"]["resume"].as_f64(), Some(1.0));
        assert_eq!(reason["weights"]["preference"].as_f64(), Some(0.0));
        assert_eq!(reason["weights"]["company"].as_f64(), Some(0.0));
    }
}
