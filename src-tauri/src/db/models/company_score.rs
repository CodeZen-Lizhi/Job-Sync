use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::Result;

use super::common::now_rfc3339;

const COMPANY_RISK_TERMS: &[(&str, &str, &str, f64)] = &[
    ("外包", "outsourcing_risk", "职位信息出现外包相关描述", 25.0),
    (
        "人力外包",
        "outsourcing_risk",
        "职位信息出现人力外包相关描述",
        25.0,
    ),
    ("驻场", "onsite_risk", "职位信息出现驻场要求", 15.0),
    (
        "培训",
        "training_risk",
        "职位信息出现培训机构或培训相关描述",
        25.0,
    ),
    (
        "招聘中介",
        "agency_risk",
        "职位信息出现招聘中介相关描述",
        20.0,
    ),
    (
        "猎头",
        "agency_risk",
        "职位信息出现猎头或招聘中介相关描述",
        20.0,
    ),
    (
        "人力资源服务",
        "agency_risk",
        "职位信息出现人力资源服务相关描述",
        20.0,
    ),
    (
        "劳务派遣",
        "agency_risk",
        "职位信息出现劳务派遣相关描述",
        25.0,
    ),
    (
        "电话销售",
        "sales_like_risk",
        "职位信息出现电话销售相关描述",
        15.0,
    ),
    ("销售", "sales_like_risk", "职位信息出现销售导向描述", 15.0),
];
const LOW_INFO_MIN_TEXT_LEN: usize = 80;
const LOW_INFO_PENALTY: f64 = 10.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CompanyScore {
    pub company_score: f64,
    pub risk_flags: Vec<String>,
    pub evidence: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct CompanyScoreRebuildSummary {
    pub companies: u64,
    pub jobs: u64,
}

pub(crate) fn compute_company_score(source: &str) -> CompanyScore {
    let normalized_source = source.to_lowercase();
    let mut score = 80.0;
    let mut risk_flags: Vec<String> = Vec::new();
    let mut evidence: Vec<String> = Vec::new();

    for &(keyword, flag, reason, penalty) in COMPANY_RISK_TERMS {
        if !normalized_source.contains(&keyword.to_lowercase()) {
            continue;
        }
        score -= penalty;
        if !risk_flags.iter().any(|item| item == flag) {
            risk_flags.push((*flag).to_string());
        }
        let evidence_text = format!("{reason}: {keyword}");
        if !evidence.iter().any(|item| item == &evidence_text) {
            evidence.push(evidence_text);
        }
    }

    let source_len = normalized_source.trim().chars().count();
    if source_len < LOW_INFO_MIN_TEXT_LEN {
        score -= LOW_INFO_PENALTY;
        risk_flags.push("low_info_risk".to_string());
        evidence.push(format!(
            "职位和公司信息过少，难以判断公司质量：有效文本约 {source_len} 字"
        ));
    }

    CompanyScore {
        company_score: round_score(clamp_score(score)),
        confidence: compute_confidence(&risk_flags),
        risk_flags,
        evidence,
    }
}

fn compute_confidence(risk_flags: &[String]) -> f64 {
    if risk_flags.iter().any(|flag| flag != "low_info_risk") {
        return 0.82;
    }
    if risk_flags.iter().any(|flag| flag == "low_info_risk") {
        return 0.55;
    }
    0.72
}

pub(crate) fn upsert_company_score_from_source(
    conn: &Connection,
    company_name: &str,
    source_text: &str,
) -> Result<()> {
    let company_name = company_name.trim();
    if company_name.is_empty() {
        return Ok(());
    }

    let computed = compute_company_score(source_text);
    let risk_flags_json = serde_json::to_string(&computed.risk_flags)?;
    let evidence_json = serde_json::to_string(&computed.evidence)?;
    let updated_at = now_rfc3339();
    conn.execute(
        r#"
    INSERT INTO company_score (
      company_name,
      company_score,
      risk_flags_json,
      evidence_json,
      confidence,
      source_text_len,
      updated_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(company_name) DO UPDATE SET
      company_score = CASE
        WHEN excluded.company_score < company_score THEN excluded.company_score
        ELSE company_score
      END,
      risk_flags_json = CASE
        WHEN excluded.company_score <= company_score THEN excluded.risk_flags_json
        ELSE risk_flags_json
      END,
      evidence_json = CASE
        WHEN excluded.company_score <= company_score THEN excluded.evidence_json
        ELSE evidence_json
      END,
      confidence = CASE
        WHEN excluded.company_score <= company_score THEN excluded.confidence
        ELSE confidence
      END,
      source_text_len = CASE
        WHEN excluded.source_text_len > source_text_len THEN excluded.source_text_len
        ELSE source_text_len
      END,
      updated_at = excluded.updated_at
    "#,
        params![
            company_name,
            computed.company_score,
            risk_flags_json,
            evidence_json,
            computed.confidence,
            source_text.len() as i64,
            updated_at,
        ],
    )?;
    Ok(())
}

pub(crate) fn upsert_company_score(
    conn: &Connection,
    company_name: &str,
    company_score: f64,
    risk_flags: &[String],
    evidence: &[String],
    confidence: f64,
    source_text_len: i64,
) -> Result<()> {
    let company_name = company_name.trim();
    if company_name.is_empty() {
        return Ok(());
    }

    let risk_flags_json = serde_json::to_string(&unique_trimmed_items(risk_flags))?;
    let evidence_json = serde_json::to_string(&unique_trimmed_items(evidence))?;
    let updated_at = now_rfc3339();
    conn.execute(
        r#"
    INSERT INTO company_score (
      company_name,
      company_score,
      risk_flags_json,
      evidence_json,
      confidence,
      source_text_len,
      updated_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(company_name) DO UPDATE SET
      company_score = excluded.company_score,
      risk_flags_json = excluded.risk_flags_json,
      evidence_json = excluded.evidence_json,
      confidence = excluded.confidence,
      source_text_len = excluded.source_text_len,
      updated_at = excluded.updated_at
    "#,
        params![
            company_name,
            round_score(clamp_score(company_score)),
            risk_flags_json,
            evidence_json,
            clamp_confidence(confidence),
            source_text_len.max(0),
            updated_at,
        ],
    )?;
    Ok(())
}

pub(crate) fn rebuild_company_scores(conn: &Connection) -> Result<CompanyScoreRebuildSummary> {
    let mut stmt = conn.prepare(
        r#"
    SELECT
      j.brand_name,
      COUNT(*) AS jobs_count,
      GROUP_CONCAT(
        COALESCE(j.position_name, '') || ' ' ||
        COALESCE(j.boss_name, '') || ' ' ||
        COALESCE(j.brand_name, '') || ' ' ||
        COALESCE(j.city_name, '') || ' ' ||
        COALESCE(j.salary_desc, '') || ' ' ||
        COALESCE(j.experience_name, '') || ' ' ||
        COALESCE(j.degree_name, '') || ' ' ||
        COALESCE(j.jd_text, '') || ' ' ||
        COALESCE(j.raw_payload_json, '') || ' ' ||
        COALESCE(d.zp_data_json, ''),
        ' '
      ) AS source_text
    FROM job j
    LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
    WHERE j.brand_name IS NOT NULL AND trim(j.brand_name) != ''
    GROUP BY j.brand_name
    ORDER BY j.brand_name ASC
    "#,
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let rows: Vec<(String, i64, Option<String>)> = rows.collect::<std::result::Result<_, _>>()?;
    drop(stmt);

    conn.execute("DELETE FROM company_score", [])?;
    let mut jobs = 0_u64;
    for (company_name, jobs_count, source_text) in rows {
        upsert_company_score_from_source(
            conn,
            &company_name,
            source_text.as_deref().unwrap_or(""),
        )?;
        jobs += jobs_count.max(0) as u64;
    }

    let companies = conn.query_row("SELECT COUNT(*) FROM company_score", [], |row| {
        row.get::<_, i64>(0)
    })?;
    Ok(CompanyScoreRebuildSummary {
        companies: companies.max(0) as u64,
        jobs,
    })
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

fn round_score(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn unique_trimmed_items(items: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() || out.iter().any(|existing: &String| existing == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn company_score_detects_risk_terms() {
        let score = compute_company_score("某外包驻场岗位，电话销售勿扰");

        assert!(score.company_score < 80.0);
        assert!(score
            .risk_flags
            .iter()
            .any(|flag| flag == "outsourcing_risk"));
        assert!(score
            .risk_flags
            .iter()
            .any(|flag| flag == "sales_like_risk"));
        assert!(!score.evidence.is_empty());
        assert_eq!(score.confidence, 0.82);
    }

    #[test]
    fn company_score_detects_low_info_risk() {
        let score = compute_company_score("Go 工程师");

        assert_eq!(score.company_score, 70.0);
        assert!(score.risk_flags.iter().any(|flag| flag == "low_info_risk"));
        assert!(score.evidence.iter().any(|item| item.contains("信息过少")));
        assert_eq!(score.confidence, 0.55);
    }

    #[test]
    fn company_score_detects_agency_risk_terms() {
        let score = compute_company_score(
            "某人力资源服务公司招聘 Go 工程师，岗位由猎头顾问代招，存在劳务派遣安排。",
        );

        assert!(score.company_score < 80.0);
        assert!(score.risk_flags.iter().any(|flag| flag == "agency_risk"));
        assert!(score
            .evidence
            .iter()
            .any(|item| item.contains("猎头") || item.contains("劳务派遣")));
        assert_eq!(score.confidence, 0.82);
    }

    #[test]
    fn company_score_keeps_normal_score_for_enough_information() {
        let score = compute_company_score(
      "Go 平台工程师 负责 Kubernetes 集群平台建设、Prometheus 可观测性、CI/CD 流水线和云原生基础设施交付。公司为自研 SaaS 产品团队，岗位描述清晰，强调平台稳定性、自动化和工程质量。",
    );

        assert!(!score.risk_flags.iter().any(|flag| flag == "low_info_risk"));
        assert_eq!(score.company_score, 80.0);
        assert_eq!(score.confidence, 0.72);
    }
}
