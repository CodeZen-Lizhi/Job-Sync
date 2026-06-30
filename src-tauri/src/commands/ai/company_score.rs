use std::collections::{HashMap, HashSet};

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    commands::filter_profile,
    db,
    ipc::protocol::{AiCompanyScoreBatchPayload, AiCompanyScoreCompanyPayload, CommandIn},
    paths, settings,
};

use super::{
    config::{resolve_openai_request, OpenAiOverrides},
    worker::run_worker_command,
};

const AI_COMPANY_SCORE_PANIC_PREFIX: &str = "AI 公司评分任务异常退出：";
const DEFAULT_COMPANY_SCORE_LIMIT: u32 = 20;
const MAX_COMPANY_SCORE_LIMIT: u32 = 50;
const MAX_COMPANY_SOURCE_CHARS: usize = 6000;
const MAX_JOB_SOURCE_CHARS: usize = 1200;
const MAX_JOBS_PER_COMPANY: usize = 5;

#[derive(Debug)]
struct CompanyScoreInput {
    company_name: String,
    jobs_count: u32,
    source_text: String,
    jobs: Vec<Value>,
}

#[derive(Debug)]
struct CandidateCompanyJob {
    encrypt_job_id: String,
    source_platform: String,
    source_url: Option<String>,
    dedup_key: Option<String>,
    position_name: Option<String>,
    brand_name: String,
    city_name: Option<String>,
    salary_desc: Option<String>,
    experience_name: Option<String>,
    degree_name: Option<String>,
    jd_text: Option<String>,
    search_text: Option<String>,
    last_seen_at: Option<String>,
}

#[derive(Debug)]
struct CompanyAggregate {
    company_name: String,
    jobs_count: u32,
    source_text: String,
    jobs: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct WorkerCompanyScoreBatchResult {
    companies: Vec<WorkerCompanyScore>,
}

#[derive(Debug, Deserialize)]
struct WorkerCompanyScore {
    company_name: String,
    company_score: f64,
    risk_flags: Vec<String>,
    evidence: Vec<String>,
    confidence: f64,
}

pub async fn generate_ai_company_scores(
    app: AppHandle,
    limit: Option<u32>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_generate_ai_company_scores(
            app,
            limit,
            api_key,
            base_url,
            model,
            api_mode,
            debug == Some(true),
        )
    })
    .await
    .map_err(|e| format!("{AI_COMPANY_SCORE_PANIC_PREFIX}{e}"))?
}

fn run_generate_ai_company_scores(
    app: AppHandle,
    limit: Option<u32>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: bool,
) -> Result<Value, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let saved_settings = settings::read_settings(&app_data_dir).ok();
    let config = resolve_openai_request(
        saved_settings.as_ref(),
        OpenAiOverrides {
            api_key,
            base_url,
            model,
            api_mode,
            temperature: None,
        },
    );
    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    let company_limit = normalize_limit(limit);
    let companies = load_company_score_inputs(&conn, company_limit)?;
    if companies.is_empty() {
        return Err("暂无可生成 AI 公司评分的候选公司。请先采集岗位并重算筛选画像。".to_string());
    }

    let payload = AiCompanyScoreBatchPayload {
        companies: companies
            .iter()
            .map(|company| AiCompanyScoreCompanyPayload {
                company_name: company.company_name.clone(),
                jobs_count: company.jobs_count,
                source_text: company.source_text.clone(),
                jobs: company.jobs.clone(),
            })
            .collect(),
    };
    let raw_result = run_worker_command(
        &app,
        &app_data_dir,
        CommandIn::AiCompanyScoreBatch(payload),
        &config,
        debug,
    )?;
    let parsed: WorkerCompanyScoreBatchResult =
        serde_json::from_value(raw_result).map_err(|e| format!("AI 公司评分结果解析失败：{e}"))?;
    persist_company_scores(&conn, &companies, parsed)
}

fn normalize_limit(limit: Option<u32>) -> u32 {
    let value = limit.unwrap_or(DEFAULT_COMPANY_SCORE_LIMIT);
    value.clamp(1, MAX_COMPANY_SCORE_LIMIT)
}

fn load_company_score_inputs(
    conn: &Connection,
    limit: u32,
) -> Result<Vec<CompanyScoreInput>, String> {
    let _ = filter_profile::recompute_missing_default_filter_profile_on_conn(conn)?;
    let rows = load_candidate_company_jobs(conn)?;
    let mut order: Vec<String> = Vec::new();
    let mut aggregates: HashMap<String, CompanyAggregate> = HashMap::new();

    for row in rows {
        let company_name = row.brand_name.trim().to_string();
        if company_name.is_empty() {
            continue;
        }
        let key = company_key(&company_name);
        if !aggregates.contains_key(&key) {
            if order.len() >= limit as usize {
                continue;
            }
            order.push(key.clone());
            aggregates.insert(
                key.clone(),
                CompanyAggregate {
                    company_name,
                    jobs_count: 0,
                    source_text: String::new(),
                    jobs: Vec::new(),
                },
            );
        }

        if let Some(aggregate) = aggregates.get_mut(&key) {
            aggregate.jobs_count = aggregate.jobs_count.saturating_add(1);
            push_source_part(&mut aggregate.source_text, &build_source_part(&row));
            if aggregate.jobs.len() < MAX_JOBS_PER_COMPANY {
                aggregate.jobs.push(build_job_summary(&row));
            }
        }
    }

    Ok(order
        .into_iter()
        .filter_map(|key| aggregates.remove(&key))
        .map(|aggregate| CompanyScoreInput {
            company_name: aggregate.company_name,
            jobs_count: aggregate.jobs_count,
            source_text: aggregate.source_text,
            jobs: aggregate.jobs,
        })
        .collect())
}

fn load_candidate_company_jobs(conn: &Connection) -> Result<Vec<CandidateCompanyJob>, String> {
    let mut stmt = conn
        .prepare(
            r#"
      SELECT
        j.encrypt_job_id,
        COALESCE(NULLIF(j.source_platform, ''), 'boss'),
        j.source_url,
        j.dedup_key,
        j.position_name,
        j.brand_name,
        j.city_name,
        j.salary_desc,
        j.experience_name,
        j.degree_name,
        j.jd_text,
        sp.search_text,
        j.last_seen_at
      FROM job j
      LEFT JOIN job_search_projection sp ON sp.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      LEFT JOIN job_blacklist jb ON jb.kind = 'job' AND jb.value = j.encrypt_job_id
      LEFT JOIN job_blacklist cb ON cb.kind = 'company' AND cb.value = j.brand_name
      WHERE j.brand_name IS NOT NULL
        AND trim(j.brand_name) != ''
        AND r.eligible = 1
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
              COALESCE(j.brand_name, '') || ' ' ||
              COALESCE(j.city_name, '') || ' ' ||
              COALESCE(j.salary_desc, '') || ' ' ||
              COALESCE(j.experience_name, '') || ' ' ||
              COALESCE(j.degree_name, '') || ' ' ||
              COALESCE(j.jd_text, '') || ' ' ||
              COALESCE(sp.search_text, '')
            ) LIKE '%' || lower(kb.value) || '%'
        )
        AND COALESCE(rs.review_status, 'pending') NOT IN ('favorited', 'ready_to_apply', 'ignored', 'applied')
        AND COALESCE(rs.communication_status, 'not_contacted') NOT IN ('read_no_reply', 'rejected', 'manual_not_fit')
      ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
      "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(CandidateCompanyJob {
                encrypt_job_id: row.get(0)?,
                source_platform: row.get(1)?,
                source_url: row.get(2)?,
                dedup_key: row.get(3)?,
                position_name: row.get(4)?,
                brand_name: row.get(5)?,
                city_name: row.get(6)?,
                salary_desc: row.get(7)?,
                experience_name: row.get(8)?,
                degree_name: row.get(9)?,
                jd_text: row.get(10)?,
                search_text: row.get(11)?,
                last_seen_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn persist_company_scores(
    conn: &Connection,
    requested: &[CompanyScoreInput],
    result: WorkerCompanyScoreBatchResult,
) -> Result<Value, String> {
    let requested_by_key: HashMap<String, &CompanyScoreInput> = requested
        .iter()
        .map(|company| (company_key(&company.company_name), company))
        .collect();
    let mut seen = HashSet::new();
    let mut updated = 0_u64;

    for company in result.companies {
        validate_worker_company_score(&company)?;
        let key = company_key(&company.company_name);
        if !seen.insert(key.clone()) {
            continue;
        }
        let Some(input) = requested_by_key.get(&key) else {
            continue;
        };
        db::models::upsert_company_score(
            conn,
            &input.company_name,
            company.company_score,
            &company.risk_flags,
            &company.evidence,
            company.confidence,
            input.source_text.len() as i64,
        )
        .map_err(|e| e.to_string())?;
        updated += 1;
    }

    let companies = requested.len() as u64;
    let jobs = requested
        .iter()
        .map(|company| u64::from(company.jobs_count))
        .sum::<u64>();
    Ok(json!({
      "companies": companies,
      "jobs": jobs,
      "updated": updated,
      "failed": companies.saturating_sub(updated),
    }))
}

fn validate_worker_company_score(company: &WorkerCompanyScore) -> Result<(), String> {
    if company.company_name.trim().is_empty() {
        return Err("AI 公司评分结果缺少公司名称。".to_string());
    }
    if company.evidence.iter().all(|item| item.trim().is_empty()) {
        return Err(format!(
            "AI 公司评分结果缺少证据：{}",
            company.company_name.trim()
        ));
    }
    Ok(())
}

fn company_key(company_name: &str) -> String {
    company_name.trim().to_lowercase()
}

fn build_source_part(row: &CandidateCompanyJob) -> String {
    let mut parts = Vec::new();
    push_labeled(&mut parts, "职位", row.position_name.as_deref());
    push_labeled(&mut parts, "公司", Some(&row.brand_name));
    push_labeled(&mut parts, "城市", row.city_name.as_deref());
    push_labeled(&mut parts, "薪资", row.salary_desc.as_deref());
    push_labeled(&mut parts, "经验", row.experience_name.as_deref());
    push_labeled(&mut parts, "学历", row.degree_name.as_deref());
    push_labeled(&mut parts, "JD", row.jd_text.as_deref());
    push_labeled(&mut parts, "搜索摘要", row.search_text.as_deref());
    truncate_chars(&parts.join(" / "), MAX_JOB_SOURCE_CHARS)
}

fn build_job_summary(row: &CandidateCompanyJob) -> Value {
    json!({
      "encrypt_job_id": &row.encrypt_job_id,
      "source_platform": &row.source_platform,
      "source_url": &row.source_url,
      "dedup_key": &row.dedup_key,
      "position_name": &row.position_name,
      "brand_name": &row.brand_name,
      "city_name": &row.city_name,
      "salary_desc": &row.salary_desc,
      "experience_name": &row.experience_name,
      "degree_name": &row.degree_name,
      "last_seen_at": &row.last_seen_at,
      "jd_text": row.jd_text.as_deref().map(|value| truncate_chars(value, MAX_JOB_SOURCE_CHARS)),
    })
}

fn push_labeled(parts: &mut Vec<String>, label: &str, value: Option<&str>) {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    parts.push(format!("{label}: {value}"));
}

fn push_source_part(source_text: &mut String, part: &str) {
    let part = part.trim();
    if part.is_empty() || source_text.chars().count() >= MAX_COMPANY_SOURCE_CHARS {
        return;
    }
    let separator = if source_text.is_empty() {
        ""
    } else {
        "\n---\n"
    };
    let next = format!("{separator}{part}");
    let remaining = MAX_COMPANY_SOURCE_CHARS.saturating_sub(source_text.chars().count());
    if next.chars().count() <= remaining {
        source_text.push_str(&next);
        return;
    }
    source_text.push_str(&truncate_chars(&next, remaining));
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let mut out = String::new();
    for (index, ch) in input.chars().enumerate() {
        if index >= max_chars {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}
