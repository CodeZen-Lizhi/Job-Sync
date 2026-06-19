use std::cmp::Ordering;

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection};
use serde_json::Value;

use crate::{commands::filter_profile, db, paths};

use super::{
    models::{
        map_job_row_with_score_weights, JobBlacklistEntry, JobCandidatePage, JobDailyIntelligence,
        JobDailyIntelligenceCandidate, JobRow, JobSourceEntry, KeywordGroup, ScoreWeights,
    },
    shared::{build_fts_phrase_query, open_conn, should_use_fts},
};

const HIGH_MATCH_THRESHOLD: f64 = 80.0;
const RECOMMENDATION_THRESHOLD: f64 = 70.0;
const DAILY_INTELLIGENCE_RECOMMENDED_PREVIEW_LIMIT: usize = 5;

fn load_score_weights(conn: &Connection) -> ScoreWeights {
    db::models::load_default_filter_profile(conn)
        .map(|profile| ScoreWeights::from_profile_json(&profile.profile_json))
        .unwrap_or_default()
}

const LIST_JOBS_LIKE_SQL: &str = r#"
      SELECT
        j.encrypt_job_id,
        COALESCE(NULLIF(j.source_platform, ''), 'boss'),
        j.source_url,
        j.dedup_key,
        j.position_name, j.boss_name, j.brand_name, j.city_name,
        j.salary_desc, j.experience_name, j.degree_name, j.last_seen_at,
        r.eligible, r.reason_json, r.updated_at,
        COALESCE(rs.review_status, 'pending'),
        COALESCE(rs.communication_status, 'not_contacted'),
        rs.last_greeted_at,
        rs.notes,
        rs.updated_at,
        COALESCE(crs.review_status, 'pending'),
        crs.notes,
        CASE WHEN cb.id IS NOT NULL THEN 1 ELSE 0 END,
        CASE WHEN jb.id IS NOT NULL THEN 1 ELSE 0 END,
        COALESCE(jb.reason, cb.reason),
        CASE WHEN EXISTS (
          SELECT 1
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
        ) THEN 1 ELSE 0 END,
        (
          SELECT COALESCE(kb.reason, '命中关键词黑名单：' || kb.value)
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
          ORDER BY kb.id DESC
          LIMIT 1
        ),
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
        COALESCE(j.position_name, '') || ' ' ||
        COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
        COALESCE(j.city_name, '') || ' ' ||
        COALESCE(j.salary_desc, '') || ' ' ||
        COALESCE(j.experience_name, '') || ' ' ||
        COALESCE(j.degree_name, '') || ' ' ||
        COALESCE(j.jd_text, '') || ' ' ||
        COALESCE(j.raw_payload_json, '') || ' ' ||
        COALESCE(d.zp_data_json, ''),
        cs.company_score,
        cs.risk_flags_json,
        cs.evidence_json,
        cs.confidence,
        (
          SELECT COUNT(*)
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
        ),
        (
          SELECT company_rs.communication_status
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
        ),
        (
          SELECT company_rs.updated_at
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
	        ),
	        j.boss_active_status
	      FROM job j
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      LEFT JOIN job_blacklist jb ON jb.kind = 'job' AND jb.value = j.encrypt_job_id
      LEFT JOIN job_blacklist cb ON cb.kind = 'company' AND cb.value = j.brand_name
      LEFT JOIN company_score cs ON cs.company_name = j.brand_name
      WHERE (?1 IS NULL
        OR j.encrypt_job_id LIKE ?1
        OR j.source_platform LIKE ?1
        OR j.source_url LIKE ?1
        OR j.dedup_key LIKE ?1
	        OR j.position_name LIKE ?1
	        OR j.boss_name LIKE ?1
	        OR j.boss_active_status LIKE ?1
	        OR j.brand_name LIKE ?1
        OR j.city_name LIKE ?1
        OR j.salary_desc LIKE ?1
        OR j.experience_name LIKE ?1
        OR j.degree_name LIKE ?1
        OR j.jd_text LIKE ?1
        OR j.raw_payload_json LIKE ?1
        OR d.zp_data_json LIKE ?1
      )
        AND (?2 IS NULL OR j.city_name = ?2)
      ORDER BY
        COALESCE((j.position_name LIKE ?1), 0) DESC,
        CASE WHEN j.position_name LIKE ?1 THEN LENGTH(j.position_name) END ASC,
        COALESCE((j.source_platform LIKE ?1), 0) DESC,
        COALESCE((j.source_url LIKE ?1), 0) DESC,
        COALESCE((j.dedup_key LIKE ?1), 0) DESC,
        COALESCE((j.brand_name LIKE ?1), 0) DESC,
        COALESCE((j.boss_name LIKE ?1), 0) DESC,
        COALESCE((j.encrypt_job_id LIKE ?1), 0) DESC,
        COALESCE((j.city_name LIKE ?1), 0) DESC,
        COALESCE((j.salary_desc LIKE ?1), 0) DESC,
        COALESCE((j.experience_name LIKE ?1), 0) DESC,
        COALESCE((j.degree_name LIKE ?1), 0) DESC,
        COALESCE((j.jd_text LIKE ?1), 0) DESC,
        COALESCE((j.raw_payload_json LIKE ?1), 0) DESC,
        COALESCE((d.zp_data_json LIKE ?1), 0) DESC,
        j.last_seen_at DESC
      LIMIT ?3 OFFSET ?4
"#;

const LIST_JOBS_FTS_SQL: &str = r#"
      SELECT
        j.encrypt_job_id,
        COALESCE(NULLIF(j.source_platform, ''), 'boss'),
        j.source_url,
        j.dedup_key,
        j.position_name, j.boss_name, j.brand_name, j.city_name,
        j.salary_desc, j.experience_name, j.degree_name, j.last_seen_at,
        r.eligible, r.reason_json, r.updated_at,
        COALESCE(rs.review_status, 'pending'),
        COALESCE(rs.communication_status, 'not_contacted'),
        rs.last_greeted_at,
        rs.notes,
        rs.updated_at,
        COALESCE(crs.review_status, 'pending'),
        crs.notes,
        CASE WHEN cb.id IS NOT NULL THEN 1 ELSE 0 END,
        CASE WHEN jb.id IS NOT NULL THEN 1 ELSE 0 END,
        COALESCE(jb.reason, cb.reason),
        CASE WHEN EXISTS (
          SELECT 1
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
	        COALESCE(j.boss_name, '') || ' ' ||
	        COALESCE(j.boss_active_status, '') || ' ' ||
	        COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
        ) THEN 1 ELSE 0 END,
        (
          SELECT COALESCE(kb.reason, '命中关键词黑名单：' || kb.value)
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
          ORDER BY kb.id DESC
          LIMIT 1
        ),
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
        COALESCE(j.position_name, '') || ' ' ||
        COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
        COALESCE(j.city_name, '') || ' ' ||
        COALESCE(j.salary_desc, '') || ' ' ||
        COALESCE(j.experience_name, '') || ' ' ||
        COALESCE(j.degree_name, '') || ' ' ||
        COALESCE(j.jd_text, '') || ' ' ||
        COALESCE(j.raw_payload_json, '') || ' ' ||
        COALESCE(d.zp_data_json, ''),
        cs.company_score,
        cs.risk_flags_json,
        cs.evidence_json,
        cs.confidence,
        (
          SELECT COUNT(*)
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
        ),
        (
          SELECT company_rs.communication_status
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
        ),
        (
          SELECT company_rs.updated_at
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
	        ),
	        j.boss_active_status
	      FROM job_fts f
      INNER JOIN job j ON j.encrypt_job_id = f.encrypt_job_id
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      LEFT JOIN job_blacklist jb ON jb.kind = 'job' AND jb.value = j.encrypt_job_id
      LEFT JOIN job_blacklist cb ON cb.kind = 'company' AND cb.value = j.brand_name
      LEFT JOIN company_score cs ON cs.company_name = j.brand_name
      WHERE f MATCH ?1
        AND (?2 IS NULL OR j.city_name = ?2)
      ORDER BY bm25(f) ASC, j.last_seen_at DESC
      LIMIT ?3 OFFSET ?4
"#;

const JOB_COLLECTION_METHOD_SQL: &str = r#"
        CASE WHEN EXISTS (
          SELECT 1
          FROM job_source_link method_link
          WHERE method_link.encrypt_job_id = j.encrypt_job_id
            AND (
              method_link.keyword IS NOT NULL
              OR method_link.filters_json IS NOT NULL
            )
        ) THEN 'automatic' ELSE 'manual' END
"#;

const JOB_CANDIDATE_BASE_SQL: &str = r#"
      SELECT
        j.encrypt_job_id,
        COALESCE(NULLIF(j.source_platform, ''), 'boss'),
        j.source_url,
        j.dedup_key,
        j.position_name, j.boss_name, j.brand_name, j.city_name,
        j.salary_desc, j.experience_name, j.degree_name, j.last_seen_at,
        r.eligible, r.reason_json, r.updated_at,
        COALESCE(rs.review_status, 'pending'),
        COALESCE(rs.communication_status, 'not_contacted'),
        rs.last_greeted_at,
        rs.notes,
        rs.updated_at,
        COALESCE(crs.review_status, 'pending'),
        crs.notes,
        CASE WHEN cb.id IS NOT NULL THEN 1 ELSE 0 END,
        CASE WHEN jb.id IS NOT NULL THEN 1 ELSE 0 END,
        COALESCE(jb.reason, cb.reason),
        CASE WHEN EXISTS (
          SELECT 1
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
        ) THEN 1 ELSE 0 END,
        (
          SELECT COALESCE(kb.reason, '命中关键词黑名单：' || kb.value)
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
          ORDER BY kb.id DESC
          LIMIT 1
        ),
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
        COALESCE(j.position_name, '') || ' ' ||
        COALESCE(j.boss_name, '') || ' ' ||
        COALESCE(j.boss_active_status, '') || ' ' ||
        COALESCE(j.brand_name, '') || ' ' ||
        COALESCE(j.city_name, '') || ' ' ||
        COALESCE(j.salary_desc, '') || ' ' ||
        COALESCE(j.experience_name, '') || ' ' ||
        COALESCE(j.degree_name, '') || ' ' ||
        COALESCE(j.jd_text, '') || ' ' ||
        COALESCE(j.raw_payload_json, '') || ' ' ||
        COALESCE(d.zp_data_json, ''),
        cs.company_score,
        cs.risk_flags_json,
        cs.evidence_json,
        cs.confidence,
        (
          SELECT COUNT(*)
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
        ),
        (
          SELECT company_rs.communication_status
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
        ),
        (
          SELECT company_rs.updated_at
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
        ),
        j.boss_active_status,
"#;

const JOB_CANDIDATE_FROM_SQL: &str = r#"
      FROM job j
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      LEFT JOIN job_blacklist jb ON jb.kind = 'job' AND jb.value = j.encrypt_job_id
      LEFT JOIN job_blacklist cb ON cb.kind = 'company' AND cb.value = j.brand_name
      LEFT JOIN company_score cs ON cs.company_name = j.brand_name
"#;

const JOB_PROCESSED_SQL: &str = r#"
      (
        COALESCE(rs.review_status, 'pending') != 'pending'
        OR COALESCE(rs.communication_status, 'not_contacted') != 'not_contacted'
        OR NULLIF(TRIM(COALESCE(rs.notes, '')), '') IS NOT NULL
        OR COALESCE(crs.review_status, 'pending') != 'pending'
        OR jb.id IS NOT NULL
        OR cb.id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
        )
      )
"#;

fn clean_filter_values(values: Option<Vec<String>>) -> Vec<String> {
    values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn push_text_values(params: &mut Vec<SqlValue>, values: &[String]) {
    params.extend(values.iter().cloned().map(SqlValue::Text));
}

fn placeholders(count: usize) -> String {
    std::iter::repeat("?")
        .take(count)
        .collect::<Vec<_>>()
        .join(", ")
}

fn build_job_candidate_filters(
    bucket: Option<String>,
    query: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    processed: Option<String>,
    status_filters: Option<Vec<String>>,
    ai_audit_filters: Option<Vec<String>>,
    source_platforms: Option<Vec<String>>,
    collection_methods: Option<Vec<String>>,
) -> (String, Vec<SqlValue>) {
    let mut where_parts = vec!["1 = 1".to_string()];
    let mut params = Vec::new();

    match bucket.as_deref().map(str::trim) {
        Some("recommended") => where_parts.push(
            r#"
            r.eligible = 1
            AND COALESCE(json_extract(r.reason_json, '$.bucket'), 'recommended') = 'recommended'
            AND NOT "#
                .to_string()
                + JOB_PROCESSED_SQL,
        ),
        Some("pending_confirmation") | Some("confirm") => where_parts.push(
            "COALESCE(json_extract(r.reason_json, '$.bucket'), '') = 'pending_confirmation'"
                .to_string(),
        ),
        Some("filtered") => where_parts.push(
            r#"
            (
              r.eligible = 0
              OR jb.id IS NOT NULL
              OR cb.id IS NOT NULL
              OR COALESCE(crs.review_status, 'pending') = 'manual_not_fit'
              OR COALESCE(rs.review_status, 'pending') IN ('ignored', 'applied')
              OR COALESCE(rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
            )
            AND COALESCE(json_extract(r.reason_json, '$.bucket'), '') != 'pending_confirmation'
            "#
            .to_string(),
        ),
        Some("processed") => where_parts.push(JOB_PROCESSED_SQL.to_string()),
        _ => {}
    }

    if let Some(query) = query
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        let like = format!("%{query}%");
        where_parts.push(
            r#"(
              j.encrypt_job_id LIKE ?
              OR j.source_platform LIKE ?
              OR j.source_url LIKE ?
              OR j.dedup_key LIKE ?
              OR j.position_name LIKE ?
              OR j.boss_name LIKE ?
              OR j.boss_active_status LIKE ?
              OR j.brand_name LIKE ?
              OR j.city_name LIKE ?
              OR j.salary_desc LIKE ?
              OR j.experience_name LIKE ?
              OR j.degree_name LIKE ?
              OR j.jd_text LIKE ?
              OR j.raw_payload_json LIKE ?
              OR d.zp_data_json LIKE ?
            )"#
            .to_string(),
        );
        for _ in 0..15 {
            params.push(SqlValue::Text(like.clone()));
        }
    }

    if let Some(start_date) = start_date
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        where_parts.push("j.last_seen_at >= ?".to_string());
        params.push(SqlValue::Text(start_date));
    }

    if let Some(end_date) = end_date
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        where_parts.push("j.last_seen_at < ?".to_string());
        params.push(SqlValue::Text(end_date));
    }

    match processed.as_deref().map(str::trim) {
        Some("processed") => where_parts.push(JOB_PROCESSED_SQL.to_string()),
        Some("unprocessed") => where_parts.push(format!("NOT {JOB_PROCESSED_SQL}")),
        _ => {}
    }

    let statuses = clean_filter_values(status_filters);
    if !statuses.is_empty() {
        let mut status_parts = Vec::new();
        for status in statuses {
            match status.as_str() {
                "favorited" | "ready_to_apply" | "applied" | "ignored" => {
                    status_parts.push("COALESCE(rs.review_status, 'pending') = ?".to_string());
                    params.push(SqlValue::Text(status));
                }
                "greeted_unread" | "read_no_reply" | "replied" | "rejected" | "manual_not_fit" => {
                    status_parts
                        .push("COALESCE(rs.communication_status, 'not_contacted') = ?".to_string());
                    params.push(SqlValue::Text(status));
                }
                "has_notes" => status_parts
                    .push("NULLIF(TRIM(COALESCE(rs.notes, '')), '') IS NOT NULL".to_string()),
                "company_not_fit" => status_parts
                    .push("COALESCE(crs.review_status, 'pending') = 'manual_not_fit'".to_string()),
                "blacklisted" => status_parts.push(
                    "(jb.id IS NOT NULL OR cb.id IS NOT NULL OR EXISTS (
                      SELECT 1
                      FROM job_blacklist kb
                      WHERE kb.kind = 'keyword'
                        AND trim(kb.value) != ''
                        AND lower(
                          COALESCE(j.source_platform, '') || ' ' ||
                          COALESCE(j.source_url, '') || ' ' ||
                          COALESCE(j.dedup_key, '') || ' ' ||
                          COALESCE(j.position_name, '') || ' ' ||
                          COALESCE(j.boss_name, '') || ' ' ||
                          COALESCE(j.boss_active_status, '') || ' ' ||
                          COALESCE(j.brand_name, '') || ' ' ||
                          COALESCE(j.city_name, '') || ' ' ||
                          COALESCE(j.salary_desc, '') || ' ' ||
                          COALESCE(j.experience_name, '') || ' ' ||
                          COALESCE(j.degree_name, '') || ' ' ||
                          COALESCE(j.jd_text, '') || ' ' ||
                          COALESCE(j.raw_payload_json, '') || ' ' ||
                          COALESCE(d.zp_data_json, '')
                        ) LIKE '%' || lower(kb.value) || '%'
                    ))"
                    .to_string(),
                ),
                _ => {}
            }
        }
        if !status_parts.is_empty() {
            where_parts.push(format!("({})", status_parts.join(" OR ")));
        }
    }

    let ai_audits = clean_filter_values(ai_audit_filters);
    if !ai_audits.is_empty() {
        let ai_bucket_expr = "COALESCE(json_extract(r.reason_json, '$.bucket'), CASE WHEN r.eligible = 1 THEN 'recommended' WHEN r.eligible = 0 THEN 'filtered' ELSE '' END)";
        let mut audit_parts = Vec::new();
        for audit in ai_audits {
            match audit.as_str() {
                "ai_passed" => audit_parts.push(format!("{ai_bucket_expr} = 'recommended'")),
                "ai_rejected" => audit_parts.push(format!("{ai_bucket_expr} = 'filtered'")),
                "ai_pending" => audit_parts.push(
                    "COALESCE(json_extract(r.reason_json, '$.bucket'), '') = 'pending_confirmation'"
                        .to_string(),
                ),
                _ => {}
            }
        }
        if !audit_parts.is_empty() {
            where_parts.push(format!("({})", audit_parts.join(" OR ")));
        }
    }

    let platforms = clean_filter_values(source_platforms);
    if !platforms.is_empty() {
        where_parts.push(format!(
            "COALESCE(NULLIF(j.source_platform, ''), 'boss') IN ({})",
            placeholders(platforms.len())
        ));
        push_text_values(&mut params, &platforms);
    }

    let methods = clean_filter_values(collection_methods);
    if !methods.is_empty() {
        where_parts.push(format!(
            "{JOB_COLLECTION_METHOD_SQL} IN ({})",
            placeholders(methods.len())
        ));
        push_text_values(&mut params, &methods);
    }

    (where_parts.join(" AND "), params)
}

#[allow(clippy::too_many_arguments)]
pub fn list_job_candidates(
    app: tauri::AppHandle,
    bucket: Option<String>,
    query: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    processed: Option<String>,
    status_filters: Option<Vec<String>>,
    ai_audit_filters: Option<Vec<String>>,
    source_platforms: Option<Vec<String>>,
    collection_methods: Option<Vec<String>>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<JobCandidatePage, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    list_job_candidates_on_conn(
        &conn,
        bucket,
        query,
        start_date,
        end_date,
        processed,
        status_filters,
        ai_audit_filters,
        source_platforms,
        collection_methods,
        limit,
        offset,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn list_job_candidates_on_conn(
    conn: &Connection,
    bucket: Option<String>,
    query: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
    processed: Option<String>,
    status_filters: Option<Vec<String>>,
    ai_audit_filters: Option<Vec<String>>,
    source_platforms: Option<Vec<String>>,
    collection_methods: Option<Vec<String>>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<JobCandidatePage, String> {
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    let score_weights = load_score_weights(conn);
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let offset = offset.unwrap_or(0);
    let (where_sql, params) = build_job_candidate_filters(
        bucket,
        query,
        start_date,
        end_date,
        processed,
        status_filters,
        ai_audit_filters,
        source_platforms,
        collection_methods,
    );

    let count_sql = format!("SELECT COUNT(*) {JOB_CANDIDATE_FROM_SQL} WHERE {where_sql}");
    let total = conn
        .query_row(&count_sql, params_from_iter(params.iter()), |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|e| e.to_string())?;

    let mut row_params = params.clone();
    row_params.push(SqlValue::Integer(limit as i64));
    row_params.push(SqlValue::Integer(offset as i64));
    let rows_sql = format!(
        "{JOB_CANDIDATE_BASE_SQL}
        {JOB_COLLECTION_METHOD_SQL}
        {JOB_CANDIDATE_FROM_SQL}
        WHERE {where_sql}
        ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
        LIMIT ? OFFSET ?"
    );
    let mut stmt = conn.prepare(&rows_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(row_params.iter()), |row| {
            map_job_row_with_score_weights(row, score_weights)
        })
        .map_err(|e| e.to_string())?;
    let mut jobs = Vec::new();
    for row in rows {
        jobs.push(row.map_err(|e| e.to_string())?);
    }

    Ok(JobCandidatePage {
        jobs,
        total,
        limit,
        offset,
    })
}

fn list_jobs_like(
    conn: &Connection,
    keyword_like: Option<&str>,
    city: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<JobRow>, String> {
    let score_weights = load_score_weights(conn);
    let mut stmt = conn
        .prepare(LIST_JOBS_LIKE_SQL)
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![keyword_like, city, limit, offset], |row| {
            map_job_row_with_score_weights(row, score_weights)
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn list_jobs_fts(
    conn: &Connection,
    keyword: &str,
    city: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<JobRow>, String> {
    let score_weights = load_score_weights(conn);
    let match_expr = build_fts_phrase_query(keyword);
    let mut stmt = conn.prepare(LIST_JOBS_FTS_SQL).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![match_expr, city, limit, offset], |row| {
            map_job_row_with_score_weights(row, score_weights)
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn list_jobs(
    app: tauri::AppHandle,
    keyword: Option<String>,
    city: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let limit = limit.unwrap_or(200) as i64;
    let offset = offset.unwrap_or(0) as i64;
    let keyword = keyword
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if keyword.as_deref().map(should_use_fts).unwrap_or(false) {
        return list_jobs_fts(
            &conn,
            keyword.as_deref().unwrap_or(""),
            city.as_deref(),
            limit,
            offset,
        );
    }

    let keyword_like = keyword.as_ref().map(|value| format!("%{value}%"));
    list_jobs_like(
        &conn,
        keyword_like.as_deref(),
        city.as_deref(),
        limit,
        offset,
    )
}

pub(super) fn get_job_on_conn(
    conn: &Connection,
    encrypt_job_id: &str,
) -> Result<Option<JobRow>, String> {
    let trimmed = encrypt_job_id.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let rows = list_jobs_like(conn, Some(trimmed), None, 200, 0)?;
    Ok(rows.into_iter().find(|job| job.encrypt_job_id == trimmed))
}

pub fn get_job(app: tauri::AppHandle, encrypt_job_id: String) -> Result<Option<JobRow>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    get_job_on_conn(&conn, &encrypt_job_id)
}

pub fn list_review_candidates(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    list_review_candidates_on_conn(&conn, limit)
}

pub fn list_favorited_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    list_favorited_jobs_on_conn(&conn, limit)
}

pub fn list_application_ready_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    list_application_ready_jobs_on_conn(&conn, limit)
}

pub fn list_communication_followup_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    list_communication_followup_jobs_on_conn(&conn, limit)
}

pub fn list_filtered_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    list_filtered_jobs_on_conn(&conn, limit)
}

fn normalize_blacklist_kind(kind: Option<String>) -> Result<Option<String>, String> {
    let normalized = kind
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(kind) = normalized.as_deref() {
        if !matches!(kind, "company" | "job" | "keyword") {
            return Err(format!("不支持的黑名单类型: {kind}"));
        }
    }
    Ok(normalized)
}

pub(super) fn list_job_blacklist_on_conn(
    conn: &Connection,
    kind: Option<String>,
) -> Result<Vec<JobBlacklistEntry>, String> {
    let kind = normalize_blacklist_kind(kind)?;
    let mut stmt = conn
        .prepare(
            r#"
      SELECT id, kind, value, reason, created_at
      FROM job_blacklist
      WHERE (?1 IS NULL OR kind = ?1)
      ORDER BY created_at DESC, id DESC
      "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![kind.as_deref()], |row| {
            Ok(JobBlacklistEntry {
                id: row.get(0)?,
                kind: row.get(1)?,
                value: row.get(2)?,
                reason: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn list_job_blacklist(
    app: tauri::AppHandle,
    kind: Option<String>,
) -> Result<Vec<JobBlacklistEntry>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    list_job_blacklist_on_conn(&conn, kind)
}

pub fn list_job_sources(app: tauri::AppHandle) -> Result<Vec<JobSourceEntry>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    list_job_sources_on_conn(&conn)
}

pub fn get_daily_job_intelligence(
    app: tauri::AppHandle,
    report_date: Option<String>,
) -> Result<JobDailyIntelligence, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    get_daily_job_intelligence_on_conn(&conn, report_date)
}

pub fn list_source_keywords(
    app: tauri::AppHandle,
    search: Option<String>,
) -> Result<Vec<KeywordGroup>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let search_like = search.as_ref().map(|value| format!("%{}%", value));

    let mut stmt = conn
        .prepare(
            r#"
      SELECT
        s.keyword,
        COUNT(DISTINCT s.encrypt_job_id) AS job_count
      FROM job_source_link s
      WHERE s.keyword IS NOT NULL
        AND (?1 IS NULL OR s.keyword LIKE ?1)
      GROUP BY s.keyword
      ORDER BY MAX(s.captured_at) DESC
      "#,
        )
        .map_err(|e| e.to_string())?;

    let mut out: Vec<KeywordGroup> = stmt
        .query_map(params![search_like.as_deref()], |row| {
            let keyword: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok(KeywordGroup {
                label: keyword.clone(),
                keyword: Some(keyword),
                job_count: count,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|row| row.ok())
        .collect();

    let show_manual = search
        .as_ref()
        .map(|value| "手动采集".contains(value.as_str()))
        .unwrap_or(true);

    if show_manual {
        let manual_count: i64 = conn
            .query_row(
                r#"
        SELECT COUNT(DISTINCT id) FROM (
          SELECT j.encrypt_job_id AS id
          FROM job j
          INNER JOIN job_source_link s ON s.encrypt_job_id = j.encrypt_job_id
          WHERE s.keyword IS NULL
          UNION
          SELECT j.encrypt_job_id AS id
          FROM job j
          WHERE NOT EXISTS (
            SELECT 1 FROM job_source_link s WHERE s.encrypt_job_id = j.encrypt_job_id
          )
        )
        "#,
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if manual_count > 0 {
            out.push(KeywordGroup {
                keyword: None,
                label: "手动采集".to_string(),
                job_count: manual_count,
            });
        }
    }

    Ok(out)
}

pub(super) fn list_job_sources_on_conn(conn: &Connection) -> Result<Vec<JobSourceEntry>, String> {
    let mut stmt = conn
        .prepare(
            r#"
      SELECT platform, display_name, adapter_kind, enabled, config_json, created_at, updated_at
      FROM job_sources
      ORDER BY CASE platform
        WHEN 'boss' THEN 0
        WHEN 'liepin' THEN 1
        WHEN 'zhilian' THEN 2
        WHEN 'maimai' THEN 3
        WHEN 'v2ex' THEN 4
        WHEN 'linuxdo' THEN 5
        ELSE 999
      END, platform ASC
      "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(JobSourceEntry {
                platform: row.get(0)?,
                display_name: row.get(1)?,
                adapter_kind: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                config_json: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn list_jobs_by_source(
    app: tauri::AppHandle,
    source_keyword: Option<String>,
) -> Result<Vec<JobRow>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;

    let sql = match &source_keyword {
        Some(_) => {
            r#"
      SELECT DISTINCT
        j.encrypt_job_id,
        COALESCE(NULLIF(j.source_platform, ''), 'boss'),
        j.source_url,
        j.dedup_key,
        j.position_name, j.boss_name, j.brand_name, j.city_name,
        j.salary_desc, j.experience_name, j.degree_name, j.last_seen_at,
        f.eligible, f.reason_json, f.updated_at,
        COALESCE(rs.review_status, 'pending'),
        COALESCE(rs.communication_status, 'not_contacted'),
        rs.last_greeted_at,
        rs.notes,
        rs.updated_at,
        COALESCE(crs.review_status, 'pending'),
        crs.notes,
        CASE WHEN cb.id IS NOT NULL THEN 1 ELSE 0 END,
        CASE WHEN jb.id IS NOT NULL THEN 1 ELSE 0 END,
        COALESCE(jb.reason, cb.reason),
        CASE WHEN EXISTS (
          SELECT 1
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
        ) THEN 1 ELSE 0 END,
        (
          SELECT COALESCE(kb.reason, '命中关键词黑名单：' || kb.value)
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
          ORDER BY kb.id DESC
          LIMIT 1
        ),
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
        COALESCE(j.position_name, '') || ' ' ||
        COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
        COALESCE(j.city_name, '') || ' ' ||
        COALESCE(j.salary_desc, '') || ' ' ||
        COALESCE(j.experience_name, '') || ' ' ||
        COALESCE(j.degree_name, '') || ' ' ||
        COALESCE(j.jd_text, '') || ' ' ||
        COALESCE(j.raw_payload_json, '') || ' ' ||
        COALESCE(d.zp_data_json, ''),
        cs.company_score,
        cs.risk_flags_json,
        cs.evidence_json,
        cs.confidence,
        (
          SELECT COUNT(*)
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
        ),
        (
          SELECT company_rs.communication_status
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
        ),
        (
          SELECT company_rs.updated_at
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
	        ),
	        j.boss_active_status
	      FROM job j
      INNER JOIN job_source_link s ON s.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result f ON f.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      LEFT JOIN job_blacklist jb ON jb.kind = 'job' AND jb.value = j.encrypt_job_id
      LEFT JOIN job_blacklist cb ON cb.kind = 'company' AND cb.value = j.brand_name
      LEFT JOIN company_score cs ON cs.company_name = j.brand_name
      WHERE s.keyword = ?1
      ORDER BY j.last_seen_at DESC
      "#
        }
        None => {
            r#"
      SELECT DISTINCT
        j.encrypt_job_id,
        COALESCE(NULLIF(j.source_platform, ''), 'boss'),
        j.source_url,
        j.dedup_key,
        j.position_name, j.boss_name, j.brand_name, j.city_name,
        j.salary_desc, j.experience_name, j.degree_name, j.last_seen_at,
        f.eligible, f.reason_json, f.updated_at,
        COALESCE(rs.review_status, 'pending'),
        COALESCE(rs.communication_status, 'not_contacted'),
        rs.last_greeted_at,
        rs.notes,
        rs.updated_at,
        COALESCE(crs.review_status, 'pending'),
        crs.notes,
        CASE WHEN cb.id IS NOT NULL THEN 1 ELSE 0 END,
        CASE WHEN jb.id IS NOT NULL THEN 1 ELSE 0 END,
        COALESCE(jb.reason, cb.reason),
        CASE WHEN EXISTS (
          SELECT 1
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
        ) THEN 1 ELSE 0 END,
        (
          SELECT COALESCE(kb.reason, '命中关键词黑名单：' || kb.value)
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
          ORDER BY kb.id DESC
          LIMIT 1
        ),
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
        COALESCE(j.position_name, '') || ' ' ||
        COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
        COALESCE(j.city_name, '') || ' ' ||
        COALESCE(j.salary_desc, '') || ' ' ||
        COALESCE(j.experience_name, '') || ' ' ||
        COALESCE(j.degree_name, '') || ' ' ||
        COALESCE(j.jd_text, '') || ' ' ||
        COALESCE(j.raw_payload_json, '') || ' ' ||
        COALESCE(d.zp_data_json, ''),
        cs.company_score,
        cs.risk_flags_json,
        cs.evidence_json,
        cs.confidence,
        (
          SELECT COUNT(*)
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
        ),
        (
          SELECT company_rs.communication_status
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
        ),
        (
          SELECT company_rs.updated_at
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
	        ),
	        j.boss_active_status
	      FROM job j
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result f ON f.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      LEFT JOIN job_blacklist jb ON jb.kind = 'job' AND jb.value = j.encrypt_job_id
      LEFT JOIN job_blacklist cb ON cb.kind = 'company' AND cb.value = j.brand_name
      LEFT JOIN company_score cs ON cs.company_name = j.brand_name
      WHERE NOT EXISTS (
        SELECT 1 FROM job_source_link s
        WHERE s.encrypt_job_id = j.encrypt_job_id AND s.keyword IS NOT NULL
      )
      ORDER BY j.last_seen_at DESC
      "#
        }
    };

    let score_weights = load_score_weights(&conn);
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    match &source_keyword {
        Some(keyword) => {
            let rows = stmt
                .query_map(params![keyword], |row| {
                    map_job_row_with_score_weights(row, score_weights)
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                out.push(row.map_err(|e| e.to_string())?);
            }
        }
        None => {
            let rows = stmt
                .query_map([], |row| map_job_row_with_score_weights(row, score_weights))
                .map_err(|e| e.to_string())?;
            for row in rows {
                out.push(row.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(out)
}

fn compare_review_candidates(a: &JobRow, b: &JobRow) -> Ordering {
    b.final_score
        .partial_cmp(&a.final_score)
        .unwrap_or(Ordering::Equal)
        .then_with(|| b.last_seen_at.cmp(&a.last_seen_at))
        .then_with(|| a.encrypt_job_id.cmp(&b.encrypt_job_id))
}

fn query_review_candidates_on_conn(conn: &Connection) -> Result<Vec<JobRow>, String> {
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    let score_weights = load_score_weights(conn);
    let mut stmt = conn
    .prepare(
      r#"
      SELECT
        j.encrypt_job_id,
        COALESCE(NULLIF(j.source_platform, ''), 'boss'),
        j.source_url,
        j.dedup_key,
        j.position_name, j.boss_name, j.brand_name, j.city_name,
        j.salary_desc, j.experience_name, j.degree_name, j.last_seen_at,
        r.eligible, r.reason_json, r.updated_at,
        COALESCE(rs.review_status, 'pending'),
        COALESCE(rs.communication_status, 'not_contacted'),
        rs.last_greeted_at,
        rs.notes,
        rs.updated_at,
        COALESCE(crs.review_status, 'pending'),
        crs.notes,
        CASE WHEN cb.id IS NOT NULL THEN 1 ELSE 0 END,
        CASE WHEN jb.id IS NOT NULL THEN 1 ELSE 0 END,
        COALESCE(jb.reason, cb.reason),
        CASE WHEN EXISTS (
          SELECT 1
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
        ) THEN 1 ELSE 0 END,
        (
          SELECT COALESCE(kb.reason, '命中关键词黑名单：' || kb.value)
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
          ORDER BY kb.id DESC
          LIMIT 1
        ),
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
        COALESCE(j.position_name, '') || ' ' ||
        COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
        COALESCE(j.city_name, '') || ' ' ||
        COALESCE(j.salary_desc, '') || ' ' ||
        COALESCE(j.experience_name, '') || ' ' ||
        COALESCE(j.degree_name, '') || ' ' ||
        COALESCE(j.jd_text, '') || ' ' ||
        COALESCE(j.raw_payload_json, '') || ' ' ||
        COALESCE(d.zp_data_json, ''),
        cs.company_score,
        cs.risk_flags_json,
        cs.evidence_json,
        cs.confidence,
        (
          SELECT COUNT(*)
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
        ),
        (
          SELECT company_rs.communication_status
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
        ),
        (
          SELECT company_rs.updated_at
          FROM job company_job
          INNER JOIN job_review_state company_rs ON company_rs.encrypt_job_id = company_job.encrypt_job_id
          WHERE j.brand_name IS NOT NULL
            AND trim(j.brand_name) != ''
            AND company_job.brand_name = j.brand_name
            AND company_job.encrypt_job_id != j.encrypt_job_id
            AND COALESCE(company_rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
          ORDER BY company_rs.updated_at DESC, company_job.encrypt_job_id ASC
          LIMIT 1
	        ),
	        j.boss_active_status
	      FROM job j
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      LEFT JOIN job_blacklist jb ON jb.kind = 'job' AND jb.value = j.encrypt_job_id
      LEFT JOIN job_blacklist cb ON cb.kind = 'company' AND cb.value = j.brand_name
      LEFT JOIN company_score cs ON cs.company_name = j.brand_name
      WHERE r.eligible = 1
        AND jb.id IS NULL
        AND cb.id IS NULL
        AND COALESCE(crs.review_status, 'pending') != 'manual_not_fit'
        AND NOT EXISTS (
          SELECT 1
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
        )
        AND COALESCE(rs.review_status, 'pending') NOT IN ('favorited', 'ready_to_apply', 'ignored', 'applied')
        AND COALESCE(rs.communication_status, 'not_contacted') NOT IN ('read_no_reply', 'rejected', 'manual_not_fit')
      ORDER BY
        CASE WHEN r.eligible = 1 THEN 0 ELSE 1 END ASC,
        j.last_seen_at DESC,
        j.encrypt_job_id ASC
      "#,
    )
    .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| map_job_row_with_score_weights(row, score_weights))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    out.sort_by(compare_review_candidates);
    Ok(out)
}

pub(super) fn list_review_candidates_on_conn(
    conn: &Connection,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let limit = limit.unwrap_or(20).min(100) as usize;
    let mut out = query_review_candidates_on_conn(conn)?;
    out.truncate(limit);
    Ok(out)
}

fn compare_review_status_jobs(a: &JobRow, b: &JobRow) -> Ordering {
    b.review_updated_at
        .cmp(&a.review_updated_at)
        .then_with(|| compare_review_candidates(a, b))
}

fn list_jobs_by_review_status_on_conn(
    conn: &Connection,
    review_status: &str,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    let limit = limit.unwrap_or(20).min(100) as i64;
    let mut stmt = conn
        .prepare(
            r#"
      SELECT j.encrypt_job_id
      FROM job_review_state rs
      INNER JOIN job j ON j.encrypt_job_id = rs.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      WHERE rs.review_status = ?1
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(COALESCE(json_extract(r.reason_json, '$.blocked_by'), json('[]'))) blocked
          WHERE json_extract(blocked.value, '$.rule_type') = 'source_platform'
        )
      ORDER BY rs.updated_at DESC, j.last_seen_at DESC, j.encrypt_job_id ASC
      LIMIT ?2
      "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![review_status, limit], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let job_id = row.map_err(|e| e.to_string())?;
        if let Some(job) = get_job_on_conn(conn, &job_id)? {
            out.push(job);
        }
    }
    out.sort_by(compare_review_status_jobs);
    Ok(out)
}

pub(super) fn list_favorited_jobs_on_conn(
    conn: &Connection,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    list_jobs_by_review_status_on_conn(conn, "favorited", limit)
}

pub(super) fn list_application_ready_jobs_on_conn(
    conn: &Connection,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    list_jobs_by_review_status_on_conn(conn, "ready_to_apply", limit)
}

pub(super) fn list_communication_followup_jobs_on_conn(
    conn: &Connection,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    let limit = limit.unwrap_or(20).min(100) as i64;
    let mut stmt = conn
        .prepare(
            r#"
      SELECT j.encrypt_job_id
      FROM job_review_state rs
      INNER JOIN job j ON j.encrypt_job_id = rs.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      WHERE (
          rs.review_status = 'applied'
          OR COALESCE(rs.communication_status, 'not_contacted') != 'not_contacted'
          OR NULLIF(TRIM(COALESCE(rs.notes, '')), '') IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(COALESCE(json_extract(r.reason_json, '$.blocked_by'), json('[]'))) blocked
          WHERE json_extract(blocked.value, '$.rule_type') = 'source_platform'
        )
      ORDER BY rs.updated_at DESC, j.last_seen_at DESC, j.encrypt_job_id ASC
      LIMIT ?1
      "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let job_id = row.map_err(|e| e.to_string())?;
        if let Some(job) = get_job_on_conn(conn, &job_id)? {
            out.push(job);
        }
    }
    out.sort_by(compare_review_status_jobs);
    Ok(out)
}

fn is_filtered_out_job(job: &JobRow) -> bool {
    if is_pending_confirmation_job(job) {
        return false;
    }
    job.filter_eligible == Some(false)
        || job.company_blacklisted
        || job.job_blacklisted
        || job.keyword_blacklisted
        || job.company_review_status.as_deref() == Some("manual_not_fit")
        || matches!(job.review_status.as_deref(), Some("ignored" | "applied"))
        || matches!(
            job.communication_status.as_deref(),
            Some("read_no_reply" | "rejected" | "manual_not_fit")
        )
}

fn filter_reason_bucket(job: &JobRow) -> Option<String> {
    let reason = job.filter_reason_json.as_deref()?;
    let reason = serde_json::from_str::<Value>(reason).ok()?;
    reason
        .get("bucket")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn is_pending_confirmation_job(job: &JobRow) -> bool {
    filter_reason_bucket(job).as_deref() == Some("pending_confirmation")
}

pub(super) fn list_filtered_jobs_on_conn(
    conn: &Connection,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let limit = limit.unwrap_or(20).min(100) as usize;
    let scan_limit = ((limit as i64) * 10).max(200).min(1000);
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    let mut out = list_jobs_like(conn, None, None, scan_limit, 0)?
        .into_iter()
        .filter(is_filtered_out_job)
        .collect::<Vec<_>>();
    out.truncate(limit);
    Ok(out)
}

pub(super) fn list_pending_confirmation_jobs_on_conn(
    conn: &Connection,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let limit = limit.unwrap_or(20).min(100) as usize;
    let scan_limit = ((limit as i64) * 10).max(200).min(1000);
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    let mut out = list_jobs_like(conn, None, None, scan_limit, 0)?
        .into_iter()
        .filter(is_pending_confirmation_job)
        .collect::<Vec<_>>();
    out.truncate(limit);
    Ok(out)
}

pub fn list_pending_confirmation_jobs(
    app: tauri::AppHandle,
    limit: Option<u32>,
) -> Result<Vec<JobRow>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    list_pending_confirmation_jobs_on_conn(&conn, limit)
}

fn today_date_string() -> String {
    time::OffsetDateTime::now_utc().date().to_string()
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| today_date_string())
}

fn normalize_report_date(report_date: Option<String>) -> String {
    report_date
        .map(|value| value.trim().to_string())
        .filter(|value| {
            value.len() == 10
                && value.chars().enumerate().all(|(index, ch)| {
                    if index == 4 || index == 7 {
                        ch == '-'
                    } else {
                        ch.is_ascii_digit()
                    }
                })
        })
        .unwrap_or_else(today_date_string)
}

fn count_today_new_jobs(conn: &Connection, report_date: &str) -> Result<i64, String> {
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    conn.query_row(
        r#"
      SELECT COUNT(*)
      FROM job j
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      WHERE substr(COALESCE(j.last_seen_at, ''), 1, 10) = ?1
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(COALESCE(json_extract(r.reason_json, '$.blocked_by'), json('[]'))) blocked
          WHERE json_extract(blocked.value, '$.rule_type') = 'source_platform'
        )
      "#,
        params![report_date],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn count_high_match_jobs(review_candidates: &[JobRow]) -> i64 {
    review_candidates
        .iter()
        .filter(|job| job.resume_match_score.unwrap_or(0.0) >= HIGH_MATCH_THRESHOLD)
        .count() as i64
}

fn count_eligible_jobs(conn: &Connection) -> Result<i64, String> {
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    conn
    .query_row(
      r#"
      SELECT COUNT(*)
      FROM job j
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      LEFT JOIN job_blacklist jb ON jb.kind = 'job' AND jb.value = j.encrypt_job_id
      LEFT JOIN job_blacklist cb ON cb.kind = 'company' AND cb.value = j.brand_name
      WHERE r.eligible = 1
        AND jb.id IS NULL
        AND cb.id IS NULL
        AND COALESCE(crs.review_status, 'pending') != 'manual_not_fit'
        AND NOT EXISTS (
          SELECT 1
          FROM job_blacklist kb
          WHERE kb.kind = 'keyword'
            AND trim(kb.value) != ''
            AND lower(
              COALESCE(j.source_platform, '') || ' ' ||
              COALESCE(j.source_url, '') || ' ' ||
              COALESCE(j.dedup_key, '') || ' ' ||
              COALESCE(j.position_name, '') || ' ' ||
              COALESCE(j.boss_name, '') || ' ' ||
              COALESCE(j.boss_active_status, '') || ' ' ||
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(j.raw_payload_json, '') || ' ' ||
              COALESCE(d.zp_data_json, '')
            ) LIKE '%' || lower(kb.value) || '%'
        )
        AND COALESCE(rs.review_status, 'pending') NOT IN ('ignored', 'applied')
        AND COALESCE(rs.communication_status, 'not_contacted') NOT IN ('read_no_reply', 'rejected', 'manual_not_fit')
      "#,
      [],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn count_jobs_by_review_status(conn: &Connection, review_status: &str) -> Result<i64, String> {
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    conn.query_row(
        r#"
      SELECT COUNT(*)
      FROM job j
      INNER JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      WHERE rs.review_status = ?1
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(COALESCE(json_extract(r.reason_json, '$.blocked_by'), json('[]'))) blocked
          WHERE json_extract(blocked.value, '$.rule_type') = 'source_platform'
        )
      "#,
        params![review_status],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn is_daily_recommended_candidate(job: &JobRow) -> bool {
    job.final_score >= RECOMMENDATION_THRESHOLD
        && !matches!(
            job.review_status.as_deref(),
            Some("favorited" | "ready_to_apply")
        )
}

fn build_recommended_candidate_preview(
    review_candidates: &[JobRow],
) -> Vec<JobDailyIntelligenceCandidate> {
    review_candidates
        .iter()
        .filter(|job| is_daily_recommended_candidate(job))
        .take(DAILY_INTELLIGENCE_RECOMMENDED_PREVIEW_LIMIT)
        .map(|job| JobDailyIntelligenceCandidate {
            encrypt_job_id: job.encrypt_job_id.clone(),
            source_platform: job.source_platform.clone(),
            source_url: job.source_url.clone(),
            dedup_key: job.dedup_key.clone(),
            position_name: job.position_name.clone(),
            brand_name: job.brand_name.clone(),
            city_name: job.city_name.clone(),
            final_score: job.final_score,
            resume_match_score: job.resume_match_score,
            preference_score: job.preference_score,
            company_score: job.company_score,
            recommendation_reason: format_recommended_candidate_reason(job),
            score_reason_json: job.score_reason_json.clone(),
        })
        .collect()
}

fn format_recommended_candidate_reason(job: &JobRow) -> String {
    let score_reason = serde_json::from_str::<Value>(&job.score_reason_json).ok();
    let matched_preferences = score_reason_array(score_reason.as_ref(), "preference", "matched");
    let resume_strengths = score_reason_array(score_reason.as_ref(), "resume", "strengths");
    let matched_stack = score_reason_array(score_reason.as_ref(), "resume", "matched_stack");
    let matched_direction =
        score_reason_array(score_reason.as_ref(), "resume", "matched_direction");
    let resume_evidence =
        score_reason_array(score_reason.as_ref(), "resume", "matched_resume_evidence");
    let missing_points = score_reason_array(score_reason.as_ref(), "resume", "missing_points");
    let experience_fit = score_reason_string(score_reason.as_ref(), "resume", "experience_fit");
    let company_evidence = score_reason_array(score_reason.as_ref(), "company", "evidence");
    let has_structured_resume_evidence = !matched_stack.is_empty()
        || !matched_direction.is_empty()
        || !resume_evidence.is_empty()
        || experience_fit.is_some();

    let mut parts = vec![
        format!(
            "Final {} 达到推荐阈值 {}",
            job.final_score.round() as i64,
            RECOMMENDATION_THRESHOLD as i64
        ),
        job.resume_match_score
            .map(|score| format!("Resume {}", score.round() as i64))
            .unwrap_or_else(|| "Resume 待分析".to_string()),
        format!("Preference {}", job.preference_score.round() as i64),
        format!("Company {}", job.company_score.round() as i64),
    ];

    if !matched_preferences.is_empty() {
        parts.push(format!(
            "偏好命中：{}",
            summarize_string_list(&matched_preferences, 3)
        ));
    }
    if !matched_stack.is_empty() {
        parts.push(format!(
            "匹配技术栈：{}",
            summarize_string_list(&matched_stack, 4)
        ));
    }
    if !matched_direction.is_empty() {
        parts.push(format!(
            "匹配方向：{}",
            summarize_string_list(&matched_direction, 3)
        ));
    }
    if let Some(experience_fit) = experience_fit {
        parts.push(format!("经验匹配：{experience_fit}"));
    }
    if !resume_evidence.is_empty() {
        parts.push(format!(
            "简历证据：{}",
            summarize_string_list(&resume_evidence, 2)
        ));
    }
    if !missing_points.is_empty() {
        parts.push(format!(
            "未覆盖要求：{}",
            summarize_string_list(&missing_points, 2)
        ));
    }
    if !has_structured_resume_evidence && !resume_strengths.is_empty() {
        parts.push(format!(
            "简历依据：{}",
            summarize_string_list(&resume_strengths, 2)
        ));
    }
    if !company_evidence.is_empty() {
        parts.push(format!(
            "公司风险：{}",
            summarize_string_list(&company_evidence, 2)
        ));
    }

    parts.join("；")
}

fn score_reason_array(score_reason: Option<&Value>, section: &str, field: &str) -> Vec<String> {
    score_reason
        .and_then(|value| value.get(section))
        .and_then(|value| value.get(field))
        .map(json_string_array)
        .unwrap_or_default()
}

fn score_reason_string(score_reason: Option<&Value>, section: &str, field: &str) -> Option<String> {
    score_reason
        .and_then(|value| value.get(section))
        .and_then(|value| value.get(field))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn json_string_array(value: &Value) -> Vec<String> {
    value
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

fn summarize_string_list(items: &[String], limit: usize) -> String {
    let mut summary = items
        .iter()
        .take(limit)
        .cloned()
        .collect::<Vec<_>>()
        .join("、");
    if items.len() > limit {
        summary.push_str(&format!(" 等{}项", items.len()));
    }
    summary
}

fn format_daily_recommended_candidate_preview(
    candidates: &[JobDailyIntelligenceCandidate],
) -> String {
    if candidates.is_empty() {
        return "推荐候选预览：暂无达到推荐阈值的候选；可先查看 Top 20 或生成简历匹配报告。"
            .to_string();
    }
    let lines = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| {
            let position_name = candidate.position_name.as_deref().unwrap_or("未知岗位");
            let brand_name = candidate.brand_name.as_deref().unwrap_or("未知公司");
            let city_name = candidate.city_name.as_deref().unwrap_or("未知城市");
            let source_platform = candidate.source_platform.trim();
            let source_platform = if source_platform.is_empty() {
                "boss"
            } else {
                source_platform
            };
            let source_key = candidate
                .dedup_key
                .as_deref()
                .unwrap_or(candidate.encrypt_job_id.as_str());
            let resume_score = candidate
                .resume_match_score
                .map(|score| format!("Resume {}", score.round() as i64))
                .unwrap_or_else(|| "Resume 待分析".to_string());
            format!(
                "{}. {} / {} / {} / {}:{} / {}",
                index + 1,
                position_name,
                brand_name,
                city_name,
                source_platform,
                source_key,
                candidate
                    .recommendation_reason
                    .replace("；", " / ")
                    .replace("Resume 待分析", &resume_score)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("推荐候选预览：\n{lines}")
}

fn format_daily_intelligence_brief(
    report_date: &str,
    today_new_jobs: i64,
    high_match_jobs: i64,
    eligible_jobs: i64,
    recommended_jobs: i64,
    ready_to_apply_jobs: i64,
    applied_jobs: i64,
) -> String {
    format!(
    "每日岗位情报（{report_date}）\n今日新增岗位：{today_new_jobs}\n高匹配：{high_match_jobs} 个\n满足关键限制：{eligible_jobs} 个\n推荐投递候选：{recommended_jobs} 个\n已确认准备投递：{ready_to_apply_jobs} 个\n已投递记录：{applied_jobs} 个\n入口：打开 Job Sync 查看 Top 20 人工审核队列；不会自动投递。"
  )
}

pub(super) fn get_daily_job_intelligence_on_conn(
    conn: &Connection,
    report_date: Option<String>,
) -> Result<JobDailyIntelligence, String> {
    let report_date = normalize_report_date(report_date);
    let today_new_jobs = count_today_new_jobs(conn, &report_date)?;
    let review_candidates = query_review_candidates_on_conn(conn)?;
    let high_match_jobs = count_high_match_jobs(&review_candidates);
    let eligible_jobs = count_eligible_jobs(conn)?;
    let recommended_jobs = review_candidates
        .iter()
        .filter(|job| is_daily_recommended_candidate(job))
        .count() as i64;
    let recommended_candidates = build_recommended_candidate_preview(&review_candidates);
    let ready_to_apply_jobs = count_jobs_by_review_status(conn, "ready_to_apply")?;
    let applied_jobs = count_jobs_by_review_status(conn, "applied")?;
    let recommended_preview_text =
        format_daily_recommended_candidate_preview(&recommended_candidates);
    let notification_brief_text = format_daily_intelligence_brief(
        &report_date,
        today_new_jobs,
        high_match_jobs,
        eligible_jobs,
        recommended_jobs,
        ready_to_apply_jobs,
        applied_jobs,
    );
    let notification_text = format!("{notification_brief_text}\n{recommended_preview_text}");

    Ok(JobDailyIntelligence {
        report_date,
        generated_at: now_rfc3339(),
        today_new_jobs,
        high_match_jobs,
        eligible_jobs,
        recommended_jobs,
        ready_to_apply_jobs,
        applied_jobs,
        high_match_threshold: HIGH_MATCH_THRESHOLD,
        recommendation_threshold: RECOMMENDATION_THRESHOLD,
        recommended_candidates,
        notification_text,
        notification_brief_text,
    })
}

pub fn get_job_detail(
    app: tauri::AppHandle,
    encrypt_job_id: String,
) -> Result<Option<Value>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let mut stmt = conn
        .prepare("SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = ?1")
        .map_err(|e| e.to_string())?;
    let result: Option<String> = stmt
        .query_row(params![encrypt_job_id], |row| row.get(0))
        .ok();

    match result {
        Some(json_str) => {
            let value: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
            Ok(Some(value))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, models};
    use rusqlite::{params, Connection};
    use serde_json::json;

    fn seed_job_fixture(
        conn: &Connection,
        encrypt_job_id: &str,
        brand_name: &str,
        position_name: &str,
    ) {
        seed_job_fixture_with_last_seen(
            conn,
            encrypt_job_id,
            brand_name,
            position_name,
            "2026-06-13T00:00:00Z",
        );
    }

    fn seed_job_fixture_with_last_seen(
        conn: &Connection,
        encrypt_job_id: &str,
        brand_name: &str,
        position_name: &str,
        last_seen_at: &str,
    ) {
        conn.execute(
            r#"
        INSERT INTO job (
          encrypt_job_id,
          position_name,
          boss_name,
          brand_name,
          city_name,
          salary_desc,
          experience_name,
          degree_name,
          last_seen_at
        )
        VALUES (?1, ?2, 'Boss', ?3, '北京', '20-40K', '3-5 年', '本科', ?4)
        "#,
            params![encrypt_job_id, position_name, brand_name, last_seen_at],
        )
        .expect("seed job");

        conn
      .execute(
        r#"
        INSERT INTO job_detail_raw (encrypt_job_id, zp_data_json, fetched_at)
        VALUES (?1, ?2, '2026-06-13T00:00:00Z')
        "#,
        params![
          encrypt_job_id,
          r#"{"jobInfo":{"positionName":"Rust 开发","salaryDesc":"20-40K","experienceName":"3-5 年","degreeName":"本科","cityName":"北京"},"brandInfo":{"brandName":"某某科技"}}"#
        ],
      )
      .expect("seed detail");
    }

    fn seed_resume_score(conn: &Connection, encrypt_job_id: &str, score: f64) {
        let result_json = json!({
            "resume_match_score": score,
            "matched_stack": ["Go", "Kubernetes", "Prometheus"],
            "matched_direction": ["Infra", "SRE"],
            "matched_resume_evidence": ["简历项目中包含 Kubernetes 平台建设经历"],
            "experience_fit": "3-5年",
            "missing_points": ["AWS 经验未明确"],
            "confidence": 0.87
        })
        .to_string();
        conn.execute(
            r#"
        INSERT INTO ai_report (
          encrypt_job_id,
          resume_hash,
          job_hash,
          kind,
          title,
          match_score,
          jobs_count,
          result_json,
          created_at
        )
        VALUES (?1, ?2, 'job_hash', 'resume', 'resume', ?3, 1, ?4, '2026-06-13T00:00:00Z')
        "#,
            params![
                encrypt_job_id,
                format!("resume_hash_{encrypt_job_id}"),
                score,
                result_json
            ],
        )
        .expect("seed ai report");
    }

    fn seed_eligible_candidate(conn: &Connection, encrypt_job_id: &str) {
        models::upsert_job_filter_result(
            conn,
            encrypt_job_id,
            models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({
              "eligible": true,
              "matched_preferences": ["Go"],
              "missing_preferences": []
            }),
        )
        .expect("seed candidate filter");
        models::upsert_job_review_state(
            conn,
            encrypt_job_id,
            Some("pending"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed candidate state");
    }

    #[test]
    fn list_job_candidates_pages_all_jobs_by_time_range() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        for (job_id, last_seen_at) in [
            ("job_recent_a", "2026-06-14T10:00:00Z"),
            ("job_recent_b", "2026-06-14T09:00:00Z"),
            ("job_recent_c", "2026-06-13T08:00:00Z"),
            ("job_old", "2026-05-01T08:00:00Z"),
        ] {
            seed_job_fixture_with_last_seen(
                &conn,
                job_id,
                "Candidate Co",
                "Go 平台工程师",
                last_seen_at,
            );
            seed_eligible_candidate(&conn, job_id);
            seed_resume_score(&conn, job_id, 80.0);
        }

        let page = list_job_candidates_on_conn(
            &conn,
            None,
            None,
            Some("2026-06-13T00:00:00Z".to_string()),
            Some("2026-06-15T00:00:00Z".to_string()),
            None,
            None,
            None,
            None,
            None,
            Some(1),
            Some(1),
        )
        .expect("list candidate page");

        assert_eq!(page.total, 3);
        assert_eq!(page.limit, 1);
        assert_eq!(page.offset, 1);
        assert_eq!(page.jobs.len(), 1);
        assert_eq!(page.jobs[0].encrypt_job_id, "job_recent_b");
    }

    #[test]
    fn list_job_candidates_filters_status_source_and_collection_method() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture_with_last_seen(
            &conn,
            "job_manual_unprocessed",
            "Manual Co",
            "Go 手动岗位",
            "2026-06-14T10:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_auto_favorite",
            "Auto Co",
            "Go 自动岗位",
            "2026-06-14T09:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_v2ex_replied",
            "V2EX Co",
            "Rust 远程岗位",
            "2026-06-14T08:00:00Z",
        );
        conn.execute(
            "UPDATE job SET source_platform = 'v2ex' WHERE encrypt_job_id = 'job_v2ex_replied'",
            [],
        )
        .expect("mark v2ex source");

        for job_id in [
            "job_manual_unprocessed",
            "job_auto_favorite",
            "job_v2ex_replied",
        ] {
            seed_eligible_candidate(&conn, job_id);
            seed_resume_score(&conn, job_id, 85.0);
        }
        models::insert_job_source_link(&conn, "job_auto_favorite", Some("Go"), Some("{}"))
            .expect("seed automatic source link");
        models::insert_job_source_link(
            &conn,
            "job_v2ex_replied",
            None,
            Some(r#"{"feed_url":"https://www.v2ex.com/feed/tab/jobs.xml"}"#),
        )
        .expect("seed v2ex automatic source link");
        models::upsert_job_review_state(
            &conn,
            "job_auto_favorite",
            Some("favorited"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("mark favorite");
        models::upsert_job_review_state(
            &conn,
            "job_v2ex_replied",
            Some("pending"),
            Some("replied"),
            None,
            Some("约了沟通"),
        )
        .expect("mark replied");

        let automatic = list_job_candidates_on_conn(
            &conn,
            None,
            None,
            None,
            None,
            Some("processed".to_string()),
            Some(vec!["favorited".to_string(), "replied".to_string()]),
            None,
            None,
            Some(vec!["automatic".to_string()]),
            Some(20),
            Some(0),
        )
        .expect("list automatic processed candidates");

        assert_eq!(automatic.total, 2);
        assert_eq!(
            automatic
                .jobs
                .iter()
                .map(|job| (job.encrypt_job_id.as_str(), job.collection_method.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("job_auto_favorite", "automatic"),
                ("job_v2ex_replied", "automatic")
            ]
        );

        let manual_unprocessed = list_job_candidates_on_conn(
            &conn,
            None,
            None,
            None,
            None,
            Some("unprocessed".to_string()),
            None,
            None,
            None,
            Some(vec!["manual".to_string()]),
            Some(20),
            Some(0),
        )
        .expect("list manual unprocessed candidates");
        assert_eq!(manual_unprocessed.total, 1);
        assert_eq!(
            manual_unprocessed.jobs[0].encrypt_job_id,
            "job_manual_unprocessed"
        );
        assert_eq!(manual_unprocessed.jobs[0].collection_method, "manual");

        let v2ex = list_job_candidates_on_conn(
            &conn,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(vec!["v2ex".to_string()]),
            None,
            Some(20),
            Some(0),
        )
        .expect("list v2ex candidates");
        assert_eq!(v2ex.total, 1);
        assert_eq!(v2ex.jobs[0].encrypt_job_id, "job_v2ex_replied");
    }

    #[test]
    fn list_job_candidates_filters_by_canonical_bucket() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        for (job_id, position) in [
            ("job_recommended", "Go 平台工程师"),
            ("job_pending", "后端工程师"),
            ("job_filtered", "外包驻场工程师"),
            ("job_processed", "Go 已处理岗位"),
        ] {
            seed_job_fixture(&conn, job_id, "Bucket Co", position);
            seed_resume_score(&conn, job_id, 80.0);
        }

        models::upsert_job_filter_result(
            &conn,
            "job_recommended",
            models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({
              "eligible": true,
              "bucket": "recommended",
              "blocked_by": [],
              "matched_preferences": ["Go"],
              "missing_preferences": []
            }),
        )
        .expect("seed recommended");
        models::upsert_job_filter_result(
            &conn,
            "job_pending",
            models::DEFAULT_FILTER_PROFILE_ID,
            false,
            &json!({
              "eligible": false,
              "bucket": "pending_confirmation",
              "pending_by": [{"rule_type": "insufficient_evidence"}],
              "blocked_by": []
            }),
        )
        .expect("seed pending");
        models::upsert_job_filter_result(
            &conn,
            "job_filtered",
            models::DEFAULT_FILTER_PROFILE_ID,
            false,
            &json!({
              "eligible": false,
              "bucket": "filtered",
              "blocked_by": [{"rule_type": "must_not_keyword"}]
            }),
        )
        .expect("seed filtered");
        models::upsert_job_filter_result(
            &conn,
            "job_processed",
            models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({
              "eligible": true,
              "bucket": "recommended",
              "blocked_by": []
            }),
        )
        .expect("seed processed");
        models::upsert_job_review_state(
            &conn,
            "job_processed",
            Some("favorited"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("mark processed");
        conn.execute(
            "UPDATE job_filter_result SET updated_at = '2099-01-01T00:00:00Z'",
            [],
        )
        .expect("pin seeded filter results");

        let recommended = list_job_candidates_on_conn(
            &conn,
            Some("recommended".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(20),
            Some(0),
        )
        .expect("list recommended");
        assert_eq!(
            recommended
                .jobs
                .iter()
                .map(|job| job.encrypt_job_id.as_str())
                .collect::<Vec<_>>(),
            vec!["job_recommended"]
        );

        let pending = list_job_candidates_on_conn(
            &conn,
            Some("pending_confirmation".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(20),
            Some(0),
        )
        .expect("list pending bucket");
        assert_eq!(pending.jobs[0].encrypt_job_id, "job_pending");

        let filtered = list_job_candidates_on_conn(
            &conn,
            Some("filtered".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(20),
            Some(0),
        )
        .expect("list filtered bucket");
        assert_eq!(filtered.jobs[0].encrypt_job_id, "job_filtered");

        let ai_rejected = list_job_candidates_on_conn(
            &conn,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(vec!["ai_rejected".to_string()]),
            None,
            None,
            Some(20),
            Some(0),
        )
        .expect("list rejected ai audit");
        assert_eq!(ai_rejected.jobs[0].encrypt_job_id, "job_filtered");

        let ai_pending = list_job_candidates_on_conn(
            &conn,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(vec!["ai_pending".to_string()]),
            None,
            None,
            Some(20),
            Some(0),
        )
        .expect("list pending ai audit");
        assert_eq!(ai_pending.jobs[0].encrypt_job_id, "job_pending");
    }

    #[test]
    fn list_job_sources_keeps_product_order_after_enablement_changes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        conn.execute(
            "UPDATE job_sources SET enabled = 0 WHERE platform = 'boss'",
            [],
        )
        .expect("disable boss");

        let sources = list_job_sources_on_conn(&conn).expect("list sources");
        let platforms = sources
            .iter()
            .map(|source| source.platform.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            platforms,
            vec!["boss", "liepin", "zhilian", "maimai", "v2ex", "linuxdo"]
        );
        assert_eq!(sources[0].platform, "boss");
        assert!(!sources[0].enabled);
    }

    #[test]
    fn review_candidates_keep_greeted_unread_jobs_with_last_greeted_at() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture(&conn, "job_keep", "Keep Co", "Rust 开发工程师");
        seed_job_fixture(&conn, "job_greeted_unread", "Unread Co", "Go 开发工程师");

        for job_id in ["job_keep", "job_greeted_unread"] {
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed filter");
            seed_resume_score(&conn, job_id, 90.0);
        }

        models::upsert_job_review_state(
            &conn,
            "job_keep",
            Some("pending"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed keep state");
        models::upsert_job_review_state(
            &conn,
            "job_greeted_unread",
            Some("pending"),
            Some("greeted_unread"),
            Some("2026-06-12T00:00:00Z"),
            None,
        )
        .expect("seed greeted unread state");
        conn.execute(
            "UPDATE job_review_state SET updated_at = ?1 WHERE encrypt_job_id = ?2",
            params!["2026-06-12T01:23:45Z", "job_greeted_unread"],
        )
        .expect("pin review updated_at");

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");
        assert_eq!(candidates.len(), 2);
        assert!(candidates
            .iter()
            .any(|job| job.encrypt_job_id == "job_keep"));
        let greeted_unread = candidates
            .iter()
            .find(|job| job.encrypt_job_id == "job_greeted_unread")
            .expect("greeted unread candidate");
        assert_eq!(
            greeted_unread.communication_status.as_deref(),
            Some("greeted_unread")
        );
        assert_eq!(
            greeted_unread.last_greeted_at.as_deref(),
            Some("2026-06-12T00:00:00Z")
        );
        assert_eq!(
            greeted_unread.review_updated_at.as_deref(),
            Some("2026-06-12T01:23:45Z")
        );
    }

    #[test]
    fn review_candidates_mark_company_negative_communication_history() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture(&conn, "job_candidate", "Risk Co", "Go 平台工程师");
        seed_job_fixture(&conn, "job_old_no_reply", "Risk Co", "Go SRE 工程师");

        for job_id in ["job_candidate", "job_old_no_reply"] {
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed filter");
            seed_resume_score(&conn, job_id, 90.0);
        }

        models::upsert_job_review_state(
            &conn,
            "job_candidate",
            Some("pending"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed candidate state");
        models::upsert_job_review_state(
            &conn,
            "job_old_no_reply",
            Some("pending"),
            Some("read_no_reply"),
            None,
            None,
        )
        .expect("seed negative state");
        conn.execute(
            "UPDATE job_review_state SET updated_at = ?1 WHERE encrypt_job_id = ?2",
            params!["2026-06-12T08:00:00Z", "job_old_no_reply"],
        )
        .expect("pin negative updated_at");

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");
        assert!(candidates
            .iter()
            .all(|job| job.encrypt_job_id != "job_old_no_reply"));
        let candidate = candidates
            .iter()
            .find(|job| job.encrypt_job_id == "job_candidate")
            .expect("candidate row");
        assert_eq!(candidate.company_negative_communication_count, 1);
        assert_eq!(
            candidate
                .latest_company_negative_communication_status
                .as_deref(),
            Some("read_no_reply")
        );
        assert_eq!(
            candidate
                .latest_company_negative_communication_at
                .as_deref(),
            Some("2026-06-12T08:00:00Z")
        );
    }

    #[test]
    fn review_candidates_skip_manual_queue_or_negative_status_jobs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture(&conn, "job_keep", "Keep Co", "Rust 开发工程师");
        seed_job_fixture(&conn, "job_favorited", "Favorite Co", "Go 平台工程师");
        seed_job_fixture(&conn, "job_ready", "Ready Co", "Go SRE 工程师");
        seed_job_fixture(&conn, "job_ignored", "Ignored Co", "Go Infra 工程师");
        seed_job_fixture(&conn, "job_applied", "Applied Co", "Go 平台工程师");
        seed_job_fixture(&conn, "job_read_no_reply", "No Reply Co", "Go SRE 工程师");
        seed_job_fixture(&conn, "job_rejected", "Reject Co", "Go 开发工程师");
        seed_job_fixture(&conn, "job_manual_not_fit", "Manual Co", "Go 平台工程师");

        for job_id in [
            "job_keep",
            "job_favorited",
            "job_ready",
            "job_ignored",
            "job_applied",
            "job_read_no_reply",
            "job_rejected",
            "job_manual_not_fit",
        ] {
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed filter");
            seed_resume_score(&conn, job_id, 90.0);
        }

        models::upsert_job_review_state(
            &conn,
            "job_keep",
            Some("pending"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed keep state");
        models::upsert_job_review_state(
            &conn,
            "job_favorited",
            Some("favorited"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed favorited state");
        models::upsert_job_review_state(
            &conn,
            "job_ready",
            Some("ready_to_apply"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed ready state");
        models::upsert_job_review_state(
            &conn,
            "job_ignored",
            Some("ignored"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed ignored state");
        models::upsert_job_review_state(
            &conn,
            "job_applied",
            Some("applied"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed applied state");
        models::upsert_job_review_state(
            &conn,
            "job_read_no_reply",
            Some("pending"),
            Some("read_no_reply"),
            Some("2026-06-12T00:00:00Z"),
            None,
        )
        .expect("seed read no reply state");
        models::upsert_job_review_state(
            &conn,
            "job_rejected",
            Some("pending"),
            Some("rejected"),
            Some("2026-06-12T00:00:00Z"),
            None,
        )
        .expect("seed rejected state");
        models::upsert_job_review_state(
            &conn,
            "job_manual_not_fit",
            Some("pending"),
            Some("manual_not_fit"),
            Some("2026-06-12T00:00:00Z"),
            None,
        )
        .expect("seed manual not fit state");

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].encrypt_job_id, "job_keep");
    }

    #[test]
    fn application_ready_jobs_return_manual_ready_items_without_applied() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture_with_last_seen(
            &conn,
            "job_ready_old",
            "Ready Old Co",
            "Go 平台工程师",
            "2026-06-12T00:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_ready_recent",
            "Ready Recent Co",
            "Go SRE 工程师",
            "2026-06-13T00:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_applied_done",
            "Applied Co",
            "Go Infra 工程师",
            "2026-06-13T01:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_pending",
            "Pending Co",
            "Go DevOps 工程师",
            "2026-06-13T02:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_ready_liepin",
            "Liepin Ready Co",
            "Go SRE 工程师",
            "2026-06-13T03:00:00Z",
        );
        conn.execute(
            "UPDATE job SET source_platform = 'liepin' WHERE encrypt_job_id = 'job_ready_liepin'",
            [],
        )
        .expect("mark liepin ready source");

        for job_id in [
            "job_ready_old",
            "job_ready_recent",
            "job_applied_done",
            "job_pending",
        ] {
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed filter");
            seed_resume_score(&conn, job_id, 88.0);
        }

        models::upsert_job_review_state(
            &conn,
            "job_ready_old",
            Some("ready_to_apply"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed old ready");
        models::upsert_job_review_state(
            &conn,
            "job_ready_recent",
            Some("ready_to_apply"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed recent ready");
        models::upsert_job_review_state(
            &conn,
            "job_applied_done",
            Some("applied"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed applied");
        models::upsert_job_review_state(
            &conn,
            "job_ready_liepin",
            Some("ready_to_apply"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed liepin ready");

        conn.execute(
            "UPDATE job_review_state SET updated_at = ?2 WHERE encrypt_job_id = ?1",
            params!["job_ready_old", "2026-06-12T08:00:00Z"],
        )
        .expect("mark old ready update");
        conn.execute(
            "UPDATE job_review_state SET updated_at = ?2 WHERE encrypt_job_id = ?1",
            params!["job_ready_recent", "2026-06-13T08:00:00Z"],
        )
        .expect("mark recent ready update");
        conn.execute(
            "UPDATE job_review_state SET updated_at = ?2 WHERE encrypt_job_id = ?1",
            params!["job_ready_liepin", "2026-06-13T09:00:00Z"],
        )
        .expect("mark liepin ready update");

        let ready_jobs =
            list_application_ready_jobs_on_conn(&conn, Some(20)).expect("list ready jobs");

        assert_eq!(
            ready_jobs
                .iter()
                .map(|job| job.encrypt_job_id.as_str())
                .collect::<Vec<_>>(),
            vec!["job_ready_recent", "job_ready_old"]
        );
        assert!(ready_jobs
            .iter()
            .all(|job| job.review_status.as_deref() == Some("ready_to_apply")));
        assert!(ready_jobs
            .iter()
            .all(|job| job.encrypt_job_id != "job_applied_done"));
        assert!(ready_jobs
            .iter()
            .all(|job| job.encrypt_job_id != "job_pending"));
        assert!(ready_jobs
            .iter()
            .all(|job| job.encrypt_job_id != "job_ready_liepin"));
    }

    #[test]
    fn favorited_jobs_return_manual_favorites_without_ready_or_applied() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture_with_last_seen(
            &conn,
            "job_favorited_old",
            "Favorite Old Co",
            "Go 平台工程师",
            "2026-06-12T00:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_favorited_recent",
            "Favorite Recent Co",
            "Go SRE 工程师",
            "2026-06-13T00:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_ready",
            "Ready Co",
            "Go Infra 工程师",
            "2026-06-13T01:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_applied",
            "Applied Co",
            "Go DevOps 工程师",
            "2026-06-13T02:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_favorited_liepin",
            "Liepin Favorite Co",
            "Go SRE 工程师",
            "2026-06-13T03:00:00Z",
        );
        conn.execute(
            "UPDATE job SET source_platform = 'liepin' WHERE encrypt_job_id = 'job_favorited_liepin'",
            [],
        )
        .expect("mark liepin favorite source");

        for job_id in [
            "job_favorited_old",
            "job_favorited_recent",
            "job_ready",
            "job_applied",
        ] {
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed filter");
            seed_resume_score(&conn, job_id, 87.0);
        }

        models::upsert_job_review_state(
            &conn,
            "job_favorited_old",
            Some("favorited"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed old favorite");
        models::upsert_job_review_state(
            &conn,
            "job_favorited_recent",
            Some("favorited"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed recent favorite");
        models::upsert_job_review_state(
            &conn,
            "job_ready",
            Some("ready_to_apply"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed ready");
        models::upsert_job_review_state(
            &conn,
            "job_applied",
            Some("applied"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed applied");
        models::upsert_job_review_state(
            &conn,
            "job_favorited_liepin",
            Some("favorited"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed liepin favorite");

        conn.execute(
            "UPDATE job_review_state SET updated_at = ?2 WHERE encrypt_job_id = ?1",
            params!["job_favorited_old", "2026-06-12T08:00:00Z"],
        )
        .expect("mark old favorite update");
        conn.execute(
            "UPDATE job_review_state SET updated_at = ?2 WHERE encrypt_job_id = ?1",
            params!["job_favorited_recent", "2026-06-13T08:00:00Z"],
        )
        .expect("mark recent favorite update");
        conn.execute(
            "UPDATE job_review_state SET updated_at = ?2 WHERE encrypt_job_id = ?1",
            params!["job_favorited_liepin", "2026-06-13T09:00:00Z"],
        )
        .expect("mark liepin favorite update");

        let favorited_jobs =
            list_favorited_jobs_on_conn(&conn, Some(20)).expect("list favorited jobs");

        assert_eq!(
            favorited_jobs
                .iter()
                .map(|job| job.encrypt_job_id.as_str())
                .collect::<Vec<_>>(),
            vec!["job_favorited_recent", "job_favorited_old"]
        );
        assert!(favorited_jobs
            .iter()
            .all(|job| job.review_status.as_deref() == Some("favorited")));
        assert!(favorited_jobs
            .iter()
            .all(|job| job.encrypt_job_id != "job_ready"));
        assert!(favorited_jobs
            .iter()
            .all(|job| job.encrypt_job_id != "job_applied"));
        assert!(favorited_jobs
            .iter()
            .all(|job| job.encrypt_job_id != "job_favorited_liepin"));
    }

    #[test]
    fn communication_followup_jobs_return_contacted_applied_or_noted_items() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture_with_last_seen(
            &conn,
            "job_applied",
            "Applied Co",
            "Go 平台工程师",
            "2026-06-13T00:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_greeted",
            "Unread Co",
            "Go SRE 工程师",
            "2026-06-13T01:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_no_reply",
            "No Reply Co",
            "Go Infra 工程师",
            "2026-06-13T02:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_noted",
            "Noted Co",
            "Go DevOps 工程师",
            "2026-06-13T03:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_pending",
            "Pending Co",
            "Go 后端工程师",
            "2026-06-13T04:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_liepin_followup",
            "Liepin Followup Co",
            "Go SRE 工程师",
            "2026-06-13T05:00:00Z",
        );
        conn.execute(
            "UPDATE job SET source_platform = 'liepin' WHERE encrypt_job_id = 'job_liepin_followup'",
            [],
        )
        .expect("mark liepin followup source");

        for job_id in [
            "job_applied",
            "job_greeted",
            "job_no_reply",
            "job_noted",
            "job_pending",
        ] {
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed filter");
            seed_resume_score(&conn, job_id, 86.0);
        }

        models::upsert_job_review_state(
            &conn,
            "job_applied",
            Some("applied"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed applied");
        models::upsert_job_review_state(
            &conn,
            "job_greeted",
            Some("ready_to_apply"),
            Some("greeted_unread"),
            Some("2026-06-13T00:30:00Z"),
            None,
        )
        .expect("seed greeted");
        models::upsert_job_review_state(
            &conn,
            "job_no_reply",
            Some("pending"),
            Some("read_no_reply"),
            Some("2026-06-13T00:45:00Z"),
            None,
        )
        .expect("seed no reply");
        models::upsert_job_review_state(
            &conn,
            "job_noted",
            Some("pending"),
            Some("not_contacted"),
            None,
            Some("等待补充材料"),
        )
        .expect("seed noted");
        models::upsert_job_review_state(
            &conn,
            "job_pending",
            Some("pending"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed pending");
        models::upsert_job_review_state(
            &conn,
            "job_liepin_followup",
            Some("pending"),
            Some("read_no_reply"),
            Some("2026-06-13T00:55:00Z"),
            None,
        )
        .expect("seed liepin followup");

        for (job_id, updated_at) in [
            ("job_applied", "2026-06-13T08:00:00Z"),
            ("job_greeted", "2026-06-13T09:00:00Z"),
            ("job_no_reply", "2026-06-13T10:00:00Z"),
            ("job_noted", "2026-06-13T11:00:00Z"),
            ("job_pending", "2026-06-13T12:00:00Z"),
            ("job_liepin_followup", "2026-06-13T13:00:00Z"),
        ] {
            conn.execute(
                "UPDATE job_review_state SET updated_at = ?2 WHERE encrypt_job_id = ?1",
                params![job_id, updated_at],
            )
            .expect("mark followup update");
        }

        let followup_jobs =
            list_communication_followup_jobs_on_conn(&conn, Some(20)).expect("list followup jobs");

        assert_eq!(
            followup_jobs
                .iter()
                .map(|job| job.encrypt_job_id.as_str())
                .collect::<Vec<_>>(),
            vec!["job_noted", "job_no_reply", "job_greeted", "job_applied"]
        );
        assert!(followup_jobs
            .iter()
            .all(|job| job.encrypt_job_id != "job_pending"));
        assert!(followup_jobs
            .iter()
            .all(|job| job.encrypt_job_id != "job_liepin_followup"));
        assert_eq!(
            followup_jobs[1].communication_status.as_deref(),
            Some("read_no_reply")
        );
        assert_eq!(
            followup_jobs[2].last_greeted_at.as_deref(),
            Some("2026-06-13T00:30:00Z")
        );
        assert_eq!(followup_jobs[3].review_status.as_deref(), Some("applied"));
    }

    #[test]
    fn filtered_jobs_explain_jobs_removed_from_review_queue() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");
        let _ = models::load_default_filter_profile(&conn).expect("load default filter profile");

        seed_job_fixture(&conn, "job_keep", "Keep Co", "Go 平台工程师");
        seed_job_fixture(&conn, "job_profile_blocked", "Blocked Co", "驻场 Go 工程师");
        seed_job_fixture(&conn, "job_read_no_reply", "No Reply Co", "Go SRE 工程师");
        seed_job_fixture(&conn, "job_applied", "Applied Co", "Go 平台工程师");
        seed_job_fixture(&conn, "job_blacklisted", "Blacklist Co", "Go 平台工程师");
        seed_job_fixture(&conn, "job_pending", "Pending Co", "后端工程师");

        for job_id in [
            "job_keep",
            "job_read_no_reply",
            "job_applied",
            "job_blacklisted",
        ] {
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed eligible filter");
        }
        models::upsert_job_filter_result(
            &conn,
            "job_profile_blocked",
            models::DEFAULT_FILTER_PROFILE_ID,
            false,
            &json!({
              "eligible": false,
              "blocked_by": [{
                "rule_type": "must_not_keyword",
                "field": "job_description",
                "value": "驻场",
                "reason": "JD 明确出现驻场要求"
              }]
            }),
        )
        .expect("seed blocked filter");
        models::upsert_job_filter_result(
            &conn,
            "job_pending",
            models::DEFAULT_FILTER_PROFILE_ID,
            false,
            &json!({
              "eligible": false,
              "bucket": "pending_confirmation",
              "evidence_quality": "weak",
              "pending_by": [{
                "rule_type": "insufficient_evidence",
                "field": "jd_text",
                "value": "missing_jd_or_detail",
                "reason": "缺少 JD 或详情正文"
              }],
              "blocked_by": []
            }),
        )
        .expect("seed pending filter");

        models::upsert_job_review_state(
            &conn,
            "job_keep",
            Some("pending"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed keep state");
        models::upsert_job_review_state(
            &conn,
            "job_read_no_reply",
            Some("pending"),
            Some("read_no_reply"),
            Some("2026-06-12T00:00:00Z"),
            None,
        )
        .expect("seed read no reply state");
        models::upsert_job_review_state(
            &conn,
            "job_applied",
            Some("applied"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed applied state");
        models::upsert_job_blacklist(
            &conn,
            models::BLACKLIST_KIND_JOB,
            "job_blacklisted",
            Some("用户从职位库加入职位黑名单"),
        )
        .expect("seed job blacklist");

        let filtered = list_filtered_jobs_on_conn(&conn, Some(20)).expect("list filtered jobs");
        let pending =
            list_pending_confirmation_jobs_on_conn(&conn, Some(20)).expect("list pending jobs");
        let ids = filtered
            .iter()
            .map(|job| job.encrypt_job_id.as_str())
            .collect::<Vec<_>>();
        let pending_ids = pending
            .iter()
            .map(|job| job.encrypt_job_id.as_str())
            .collect::<Vec<_>>();

        assert!(!ids.contains(&"job_keep"));
        assert!(!ids.contains(&"job_pending"));
        assert!(ids.contains(&"job_profile_blocked"));
        assert!(ids.contains(&"job_read_no_reply"));
        assert!(ids.contains(&"job_applied"));
        assert!(ids.contains(&"job_blacklisted"));
        assert_eq!(pending_ids, vec!["job_pending"]);

        let profile_blocked = filtered
            .iter()
            .find(|job| job.encrypt_job_id == "job_profile_blocked")
            .expect("profile blocked job");
        assert_eq!(profile_blocked.filter_eligible, Some(false));
        assert!(profile_blocked
            .filter_reason_json
            .as_deref()
            .unwrap_or_default()
            .contains("JD 明确出现驻场要求"));

        let read_no_reply = filtered
            .iter()
            .find(|job| job.encrypt_job_id == "job_read_no_reply")
            .expect("read no reply job");
        assert_eq!(
            read_no_reply.communication_status.as_deref(),
            Some("read_no_reply")
        );

        let blacklisted = filtered
            .iter()
            .find(|job| job.encrypt_job_id == "job_blacklisted")
            .expect("blacklisted job");
        assert!(blacklisted.job_blacklisted);
        assert_eq!(
            blacklisted.blacklist_reason.as_deref(),
            Some("用户从职位库加入职位黑名单")
        );
    }

    #[test]
    fn review_candidates_skip_company_manual_not_fit_jobs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture(&conn, "job_keep", "Keep Co", "Rust 开发工程师");
        seed_job_fixture(&conn, "job_skip_a", "Risk Co", "Go 平台工程师");
        seed_job_fixture(&conn, "job_skip_b", "Risk Co", "DevOps 工程师");

        for job_id in ["job_keep", "job_skip_a", "job_skip_b"] {
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed filter");
            models::upsert_job_review_state(
                &conn,
                job_id,
                Some("pending"),
                Some("not_contacted"),
                None,
                None,
            )
            .expect("seed state");
            seed_resume_score(&conn, job_id, 90.0);
        }

        models::upsert_company_review_state(
            &conn,
            "Risk Co",
            "manual_not_fit",
            Some("公司维度不合适"),
        )
        .expect("seed company state");

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].encrypt_job_id, "job_keep");

        let rows = list_jobs_like(&conn, Some("%Risk%"), None, 20, 0).expect("list rows");
        assert_eq!(rows.len(), 2);
        assert!(rows
            .iter()
            .all(|row| row.company_review_status.as_deref() == Some("manual_not_fit")));
        assert!(rows
            .iter()
            .all(|row| row.company_review_notes.as_deref() == Some("公司维度不合适")));
    }

    #[test]
    fn review_candidates_keep_greeted_unread_and_filter_negative_communication() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        let fixtures = [
            ("job_not_contacted", "Keep Co", "not_contacted", None),
            (
                "job_greeted_unread",
                "Unread Co",
                "greeted_unread",
                Some("2026-06-13T08:00:00Z"),
            ),
            (
                "job_read_no_reply",
                "No Reply Co",
                "read_no_reply",
                Some("2026-06-12T08:00:00Z"),
            ),
            (
                "job_rejected",
                "Rejected Co",
                "rejected",
                Some("2026-06-11T08:00:00Z"),
            ),
            (
                "job_manual_not_fit",
                "Manual Skip Co",
                "manual_not_fit",
                Some("2026-06-10T08:00:00Z"),
            ),
        ];

        for (job_id, company_name, communication_status, last_greeted_at) in fixtures {
            seed_job_fixture(&conn, job_id, company_name, "Go 平台工程师");
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed filter");
            models::upsert_job_review_state(
                &conn,
                job_id,
                Some("pending"),
                Some(communication_status),
                last_greeted_at,
                None,
            )
            .expect("seed review state");
            seed_resume_score(&conn, job_id, 90.0);
        }

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");
        let ids = candidates
            .iter()
            .map(|job| job.encrypt_job_id.as_str())
            .collect::<Vec<_>>();

        assert!(ids.contains(&"job_not_contacted"));
        assert!(ids.contains(&"job_greeted_unread"));
        assert!(!ids.contains(&"job_read_no_reply"));
        assert!(!ids.contains(&"job_rejected"));
        assert!(!ids.contains(&"job_manual_not_fit"));

        let greeted_unread = candidates
            .iter()
            .find(|job| job.encrypt_job_id == "job_greeted_unread")
            .expect("greeted unread candidate");
        assert_eq!(
            greeted_unread.communication_status.as_deref(),
            Some("greeted_unread")
        );
        assert_eq!(
            greeted_unread.last_greeted_at.as_deref(),
            Some("2026-06-13T08:00:00Z")
        );
    }

    #[test]
    fn review_candidates_sort_by_final_score_desc_then_last_seen() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture_with_last_seen(
            &conn,
            "job_high",
            "High Co",
            "Go 平台工程师",
            "2026-06-13T03:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_mid",
            "Mid Co",
            "Go 平台工程师",
            "2026-06-13T02:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_low",
            "Low Co",
            "Go 平台工程师",
            "2026-06-13T01:00:00Z",
        );

        for job_id in ["job_high", "job_mid", "job_low"] {
            models::upsert_job_filter_result(
                &conn,
                job_id,
                models::DEFAULT_FILTER_PROFILE_ID,
                true,
                &json!({
                  "eligible": true,
                  "matched_preferences": ["Go"],
                  "missing_preferences": []
                }),
            )
            .expect("seed filter");
            models::upsert_job_review_state(
                &conn,
                job_id,
                Some("pending"),
                Some("not_contacted"),
                None,
                None,
            )
            .expect("seed state");
        }

        seed_resume_score(&conn, "job_high", 95.0);
        seed_resume_score(&conn, "job_mid", 80.0);
        seed_resume_score(&conn, "job_low", 60.0);

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");
        assert_eq!(
            candidates
                .iter()
                .map(|job| job.encrypt_job_id.as_str())
                .collect::<Vec<_>>(),
            vec!["job_high", "job_mid", "job_low"]
        );
        assert!(candidates[0].final_score >= candidates[1].final_score);
        assert!(candidates[1].final_score >= candidates[2].final_score);
    }

    #[test]
    fn review_candidates_reuse_cached_company_score_confidence() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture(&conn, "job_cached_company", "Cached Co", "Go 平台工程师");
        models::upsert_job_filter_result(
            &conn,
            "job_cached_company",
            models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({
              "eligible": true,
              "matched_preferences": ["Go"],
              "missing_preferences": []
            }),
        )
        .expect("seed filter");
        models::upsert_job_review_state(
            &conn,
            "job_cached_company",
            Some("pending"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed state");
        seed_resume_score(&conn, "job_cached_company", 80.0);
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
        "#,
            params![
                "Cached Co",
                42.0,
                r#"["training_risk"]"#,
                r#"["同公司历史岗位出现培训风险"]"#,
                0.61,
                120,
                "2026-06-13T00:00:00Z"
            ],
        )
        .expect("seed company score");

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");
        let candidate = candidates
            .iter()
            .find(|job| job.encrypt_job_id == "job_cached_company")
            .expect("candidate row");
        let reason: Value =
            serde_json::from_str(&candidate.score_reason_json).expect("score reason json");

        assert_eq!(candidate.company_score, 42.0);
        assert_eq!(reason["company"]["risk_flags"][0], json!("training_risk"));
        assert_eq!(reason["company"]["confidence"].as_f64(), Some(0.61));
    }

    #[test]
    fn review_candidates_recompute_missing_filter_results_before_sorting() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture(&conn, "job_boss_missing_filter", "Boss Co", "Go 平台工程师");
        seed_job_fixture(
            &conn,
            "job_liepin_missing_filter",
            "Liepin Co",
            "Go 平台工程师",
        );
        conn
      .execute(
        "UPDATE job SET source_platform = 'liepin' WHERE encrypt_job_id = 'job_liepin_missing_filter'",
        [],
      )
      .expect("mark liepin source");
        seed_resume_score(&conn, "job_boss_missing_filter", 80.0);
        seed_resume_score(&conn, "job_liepin_missing_filter", 99.0);

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].encrypt_job_id, "job_boss_missing_filter");
        let liepin_reason: String = conn
      .query_row(
        "SELECT reason_json FROM job_filter_result WHERE encrypt_job_id = 'job_liepin_missing_filter'",
        [],
        |row| row.get(0),
      )
      .expect("query liepin filter reason");
        let liepin_reason: Value =
            serde_json::from_str(&liepin_reason).expect("parse liepin reason");
        assert_eq!(liepin_reason["eligible"], json!(false));
        assert!(liepin_reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .iter()
            .any(|item| item.get("rule_type").and_then(Value::as_str) == Some("source_platform")));
    }

    #[test]
    fn review_candidates_recompute_stale_filter_results_before_sorting() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture(&conn, "job_boss_current_filter", "Boss Co", "Go 平台工程师");
        seed_job_fixture(
            &conn,
            "job_liepin_stale_filter",
            "Liepin Co",
            "Go 平台工程师",
        );
        conn
            .execute(
                "UPDATE job SET source_platform = 'liepin' WHERE encrypt_job_id = 'job_liepin_stale_filter'",
                [],
            )
            .expect("mark liepin source");
        seed_resume_score(&conn, "job_boss_current_filter", 80.0);
        seed_resume_score(&conn, "job_liepin_stale_filter", 99.0);
        models::upsert_job_filter_result(
            &conn,
            "job_liepin_stale_filter",
            models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({
                "eligible": true,
                "matched_preferences": ["Go"],
                "missing_preferences": []
            }),
        )
        .expect("seed stale filter");
        conn
            .execute(
                "UPDATE job_filter_result SET updated_at = '2020-01-01T00:00:00Z' WHERE encrypt_job_id = 'job_liepin_stale_filter'",
                [],
            )
            .expect("pin stale filter updated_at");

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].encrypt_job_id, "job_boss_current_filter");
        let liepin_reason: String = conn
            .query_row(
                "SELECT reason_json FROM job_filter_result WHERE encrypt_job_id = 'job_liepin_stale_filter'",
                [],
                |row| row.get(0),
            )
            .expect("query stale liepin filter reason");
        let liepin_reason: Value =
            serde_json::from_str(&liepin_reason).expect("parse liepin reason");
        assert_eq!(liepin_reason["eligible"], json!(false));
        assert!(liepin_reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .iter()
            .any(|item| item.get("rule_type").and_then(Value::as_str) == Some("source_platform")));
    }

    #[test]
    fn keyword_blacklist_filters_review_candidates_and_marks_rows() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job_fixture(&conn, "job_keyword_hit", "Keyword Co", "Go 外包 开发工程师");
        models::upsert_job_filter_result(
            &conn,
            "job_keyword_hit",
            models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({
              "eligible": true,
              "matched_preferences": ["Go"],
              "missing_preferences": []
            }),
        )
        .expect("seed filter");
        seed_resume_score(&conn, "job_keyword_hit", 90.0);
        models::upsert_job_review_state(
            &conn,
            "job_keyword_hit",
            Some("pending"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed state");
        models::upsert_job_blacklist(
            &conn,
            models::BLACKLIST_KIND_KEYWORD,
            "外包",
            Some("排除外包岗位"),
        )
        .expect("seed keyword blacklist");

        let candidates = list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");
        assert!(candidates.is_empty());

        let rows = list_jobs_like(&conn, Some("%外包%"), None, 20, 0).expect("list rows");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].keyword_blacklisted);
        assert_eq!(rows[0].blacklist_reason.as_deref(), Some("排除外包岗位"));
    }

    #[test]
    fn list_job_blacklist_filters_by_kind() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        models::upsert_job_blacklist(
            &conn,
            models::BLACKLIST_KIND_COMPANY,
            "风险公司",
            Some("已读未回多次"),
        )
        .expect("seed company blacklist");
        models::upsert_job_blacklist(
            &conn,
            models::BLACKLIST_KIND_KEYWORD,
            "外包",
            Some("排除外包岗位"),
        )
        .expect("seed keyword blacklist");

        let all = list_job_blacklist_on_conn(&conn, None).expect("list all blacklist");
        assert_eq!(all.len(), 2);

        let keywords = list_job_blacklist_on_conn(&conn, Some("keyword".to_string()))
            .expect("list keyword blacklist");
        assert_eq!(keywords.len(), 1);
        assert_eq!(keywords[0].kind, "keyword");
        assert_eq!(keywords[0].value, "外包");
        assert_eq!(keywords[0].reason.as_deref(), Some("排除外包岗位"));

        let invalid = list_job_blacklist_on_conn(&conn, Some("unknown".to_string()));
        assert!(invalid.is_err());
    }

    #[test]
    fn daily_job_intelligence_counts_local_summary() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");
        let _ = models::load_default_filter_profile(&conn).expect("load default filter profile");

        seed_job_fixture_with_last_seen(
            &conn,
            "job_recommended",
            "Good Co",
            "Go SRE 工程师",
            "2026-06-13T01:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_high_match",
            "Match Co",
            "Go 平台工程师",
            "2026-06-13T02:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_blocked",
            "Blocked Co",
            "驻场 Go 工程师",
            "2026-06-13T03:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_read_no_reply",
            "No Reply Co",
            "Go SRE 工程师",
            "2026-06-13T04:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_liepin_missing_filter",
            "Liepin Co",
            "Go SRE 工程师",
            "2026-06-13T05:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_old",
            "Old Co",
            "DevOps 工程师",
            "2026-06-12T03:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_applied_done",
            "Applied Co",
            "Go 平台工程师",
            "2026-06-12T04:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_liepin_ready_done",
            "Liepin Ready Co",
            "Go SRE 工程师",
            "2026-06-13T06:00:00Z",
        );
        seed_job_fixture_with_last_seen(
            &conn,
            "job_liepin_applied_done",
            "Liepin Applied Co",
            "Go SRE 工程师",
            "2026-06-13T07:00:00Z",
        );
        conn
      .execute(
        "UPDATE job SET source_platform = 'liepin' WHERE encrypt_job_id = 'job_liepin_missing_filter'",
        [],
      )
      .expect("mark liepin source");
        conn.execute(
            "UPDATE job SET source_platform = 'liepin' WHERE encrypt_job_id IN ('job_liepin_ready_done', 'job_liepin_applied_done')",
            [],
        )
        .expect("mark liepin completed sources");

        models::upsert_job_filter_result(
      &conn,
      "job_recommended",
      models::DEFAULT_FILTER_PROFILE_ID,
      true,
      &json!({"eligible": true, "matched_preferences": ["Go", "SRE"], "missing_preferences": []}),
    )
    .expect("seed recommended filter");
        models::upsert_job_filter_result(
      &conn,
      "job_high_match",
      models::DEFAULT_FILTER_PROFILE_ID,
      true,
      &json!({"eligible": true, "matched_preferences": ["Go"], "missing_preferences": ["AWS", "AI Infra"]}),
    )
    .expect("seed high match filter");
        models::upsert_job_filter_result(
      &conn,
      "job_blocked",
      models::DEFAULT_FILTER_PROFILE_ID,
      false,
      &json!({"eligible": false, "blocked_by": [{"rule_type": "must_not_keyword", "value": "驻场"}]}),
    )
    .expect("seed blocked filter");
        models::upsert_job_filter_result(
            &conn,
            "job_old",
            models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({"eligible": true, "matched_preferences": [], "missing_preferences": []}),
        )
        .expect("seed old filter");
        models::upsert_job_filter_result(
            &conn,
            "job_read_no_reply",
            models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({"eligible": true, "matched_preferences": ["Go"], "missing_preferences": []}),
        )
        .expect("seed read no reply filter");
        models::upsert_job_review_state(
            &conn,
            "job_read_no_reply",
            Some("pending"),
            Some("read_no_reply"),
            Some("2026-06-12T00:00:00Z"),
            None,
        )
        .expect("seed read no reply state");
        models::upsert_job_review_state(
            &conn,
            "job_old",
            Some("ready_to_apply"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed ready state");
        models::upsert_job_review_state(
            &conn,
            "job_applied_done",
            Some("applied"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed applied state");
        models::upsert_job_review_state(
            &conn,
            "job_liepin_ready_done",
            Some("ready_to_apply"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed liepin ready state");
        models::upsert_job_review_state(
            &conn,
            "job_liepin_applied_done",
            Some("applied"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("seed liepin applied state");

        seed_resume_score(&conn, "job_recommended", 95.0);
        seed_resume_score(&conn, "job_high_match", 82.0);
        seed_resume_score(&conn, "job_blocked", 91.0);
        seed_resume_score(&conn, "job_liepin_missing_filter", 99.0);
        seed_resume_score(&conn, "job_old", 30.0);

        let summary = get_daily_job_intelligence_on_conn(&conn, Some("2026-06-13".to_string()))
            .expect("daily summary");

        assert_eq!(summary.today_new_jobs, 4);
        assert_eq!(summary.high_match_jobs, 2);
        assert_eq!(summary.eligible_jobs, 3);
        assert_eq!(summary.recommended_jobs, 1);
        assert_eq!(summary.ready_to_apply_jobs, 1);
        assert_eq!(summary.applied_jobs, 1);
        assert_eq!(summary.recommended_candidates.len(), 1);
        assert_eq!(
            summary.recommended_candidates[0].encrypt_job_id,
            "job_recommended"
        );
        assert_eq!(
            summary.recommended_candidates[0].position_name.as_deref(),
            Some("Go SRE 工程师")
        );
        assert_eq!(
            summary.recommended_candidates[0].brand_name.as_deref(),
            Some("Good Co")
        );
        assert_eq!(summary.recommended_candidates[0].source_platform, "boss");
        assert!(summary.recommended_candidates[0].dedup_key.is_none());
        assert_eq!(summary.recommended_candidates[0].preference_score, 100.0);
        let recommended_reason_json: Value =
            serde_json::from_str(&summary.recommended_candidates[0].score_reason_json)
                .expect("recommended score reason json");
        assert_eq!(
            recommended_reason_json["resume"]["matched_stack"][0],
            json!("Go")
        );
        assert_eq!(
            recommended_reason_json["resume"]["matched_resume_evidence"][0],
            json!("简历项目中包含 Kubernetes 平台建设经历")
        );
        assert!(summary.recommended_candidates[0]
            .recommendation_reason
            .contains("Final 94 达到推荐阈值 70"));
        assert!(summary.recommended_candidates[0]
            .recommendation_reason
            .contains("偏好命中：Go、SRE"));
        assert!(summary.recommended_candidates[0]
            .recommendation_reason
            .contains("匹配技术栈：Go、Kubernetes、Prometheus"));
        assert!(summary.recommended_candidates[0]
            .recommendation_reason
            .contains("简历证据：简历项目中包含 Kubernetes 平台建设经历"));
        assert!(summary.notification_text.contains("今日新增岗位：4"));
        assert!(summary.notification_text.contains("推荐投递候选：1 个"));
        assert!(summary.notification_text.contains("推荐候选预览"));
        assert!(summary
            .notification_text
            .contains("Go SRE 工程师 / Good Co"));
        assert!(summary.notification_text.contains("boss:job_recommended"));
        assert!(summary
            .notification_text
            .contains("Final 94 达到推荐阈值 70"));
        assert!(summary.notification_text.contains("Preference 100"));
        assert!(summary.notification_text.contains("已确认准备投递：1 个"));
        assert!(summary.notification_text.contains("已投递记录：1 个"));
        assert!(summary
            .notification_text
            .contains("打开 Job Sync 查看 Top 20 人工审核队列"));
        assert!(summary.notification_text.contains("不会自动投递"));
        assert!(summary.notification_brief_text.contains("今日新增岗位：4"));
        assert!(summary
            .notification_brief_text
            .contains("推荐投递候选：1 个"));
        assert!(summary
            .notification_brief_text
            .contains("打开 Job Sync 查看 Top 20 人工审核队列"));
        assert!(summary.notification_brief_text.contains("不会自动投递"));
        assert!(!summary.notification_brief_text.contains("推荐候选预览"));
        assert!(!summary
            .notification_brief_text
            .contains("Go SRE 工程师 / Good Co"));
        assert!(!summary
            .notification_brief_text
            .contains("boss:job_recommended"));
    }
}
