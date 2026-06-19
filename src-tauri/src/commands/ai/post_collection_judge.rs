use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    commands::filter_profile,
    commands::settings::send_telegram_message_from_settings,
    db,
    ipc::protocol::{AiPostCollectionJudgePayload, CommandIn},
    paths, settings,
};

use super::{
    config::{resolve_openai_request, OpenAiOverrides},
    worker::run_worker_command,
};

const AI_POST_COLLECTION_JUDGE_PANIC_PREFIX: &str = "AI 采后判断任务异常退出：";
const DEFAULT_POST_COLLECTION_JUDGE_LIMIT: u32 = 20;
const MAX_POST_COLLECTION_JUDGE_LIMIT: u32 = 50;
const LOW_CONFIDENCE_THRESHOLD: f64 = 0.65;

#[derive(Debug)]
struct JobJudgeInput {
    encrypt_job_id: String,
    job: Value,
    filter_reason: Value,
    hard_blocked: bool,
}

#[derive(Debug, Deserialize)]
struct WorkerPostCollectionJudgeResult {
    bucket: String,
    confidence: f64,
    summary: String,
    evidence: Vec<String>,
    #[serde(default)]
    risks: Vec<String>,
}

pub async fn recompute_ai_post_collection_judgement(
    app: AppHandle,
    job_ids: Option<Vec<String>>,
    limit: Option<u32>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_recompute_ai_post_collection_judgement(
            app,
            job_ids,
            limit,
            api_key,
            base_url,
            model,
            api_mode,
            debug == Some(true),
        )
    })
    .await
    .map_err(|e| format!("{AI_POST_COLLECTION_JUDGE_PANIC_PREFIX}{e}"))?
}

fn run_recompute_ai_post_collection_judgement(
    app: AppHandle,
    job_ids: Option<Vec<String>>,
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
    let profile = db::models::load_default_filter_profile(&conn).map_err(|e| e.to_string())?;
    let requested_ids = normalize_job_ids(job_ids);
    let limit = normalize_limit(limit, requested_ids.is_some());
    let inputs = load_job_judge_inputs(&conn, requested_ids.as_deref(), limit)?;
    if inputs.is_empty() {
        return Err("暂无可进行 AI 采后判断的岗位。请先采集岗位或切换职位库分区。".to_string());
    }

    let mut updated = 0_u64;
    let mut ai_judged = 0_u64;
    let mut hard_skipped = 0_u64;
    let mut failed = 0_u64;

    for input in inputs {
        if input.hard_blocked {
            hard_skipped += 1;
            continue;
        }

        let payload = AiPostCollectionJudgePayload {
            profile: Some(profile.profile_json.clone()),
            job: input.job.clone(),
            filter_reason: Some(input.filter_reason.clone()),
        };
        let raw_result = match run_worker_command(
            &app,
            &app_data_dir,
            CommandIn::AiPostCollectionJudge(payload),
            &config,
            debug,
        ) {
            Ok(value) => value,
            Err(_) => {
                persist_ai_pending_fallback(&conn, &profile.id, &input)?;
                failed += 1;
                updated += 1;
                continue;
            }
        };
        let parsed: WorkerPostCollectionJudgeResult = match serde_json::from_value(raw_result) {
            Ok(value) => value,
            Err(_) => {
                persist_ai_pending_fallback(&conn, &profile.id, &input)?;
                failed += 1;
                updated += 1;
                continue;
            }
        };
        let reason = merge_ai_judgement(&input.filter_reason, parsed)?;
        let bucket = reason_bucket(&reason);
        let eligible = bucket == "recommended";
        db::models::upsert_job_filter_result(&conn, &input.encrypt_job_id, &profile.id, eligible, &reason)
            .map_err(|e| e.to_string())?;
        updated += 1;
        ai_judged += 1;
    }

    let counts = filter_profile::count_filter_buckets_on_conn(&conn)?;
    let mut telegram_sent = false;
    let mut telegram_error = None::<String>;
    if ai_judged > 0 {
        let telegram_message = build_telegram_summary(&counts, updated, ai_judged, hard_skipped, failed);
        match saved_settings.as_ref() {
            Some(settings) => match send_telegram_message_from_settings(settings, &telegram_message) {
                Ok(()) => telegram_sent = true,
                Err(err) => telegram_error = Some(err),
            },
            None => telegram_error = Some("未找到已保存设置，无法发送 Telegram 通知。".to_string()),
        }
    }

    Ok(json!({
      "updated": updated,
      "ai_judged": ai_judged,
      "hard_skipped": hard_skipped,
      "failed": failed,
      "counts": counts,
      "telegram_sent": telegram_sent,
      "telegram_error": telegram_error,
    }))
}

fn normalize_limit(limit: Option<u32>, has_explicit_ids: bool) -> u32 {
    if has_explicit_ids {
        return MAX_POST_COLLECTION_JUDGE_LIMIT;
    }
    limit
        .unwrap_or(DEFAULT_POST_COLLECTION_JUDGE_LIMIT)
        .clamp(1, MAX_POST_COLLECTION_JUDGE_LIMIT)
}

fn normalize_job_ids(job_ids: Option<Vec<String>>) -> Option<Vec<String>> {
    let mut seen = HashSet::new();
    let ids: Vec<String> = job_ids
        .unwrap_or_default()
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .filter(|id| seen.insert(id.clone()))
        .take(MAX_POST_COLLECTION_JUDGE_LIMIT as usize)
        .collect();
    if ids.is_empty() {
        None
    } else {
        Some(ids)
    }
}

fn load_job_judge_inputs(
    conn: &Connection,
    job_ids: Option<&[String]>,
    limit: u32,
) -> Result<Vec<JobJudgeInput>, String> {
    if let Some(job_ids) = job_ids {
        let mut inputs = Vec::new();
        for id in job_ids {
            let _ = filter_profile::recompute_default_filter_profile_for_job_on_conn(conn, id)?;
            let Some(input) = load_job_judge_input(conn, id)? else {
                continue;
            };
            inputs.push(input);
        }
        return Ok(inputs);
    }

    let _ = filter_profile::recompute_default_filter_profile_on_conn(conn)?;
    let mut stmt = conn
        .prepare(
            r#"
      SELECT j.encrypt_job_id
      FROM job j
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      WHERE COALESCE(json_extract(r.reason_json, '$.bucket'), 'recommended') IN ('recommended', 'pending_confirmation')
      ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
      LIMIT ?
      "#,
        )
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map([limit], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut inputs = Vec::new();
    for id in ids {
        if let Some(input) = load_job_judge_input(conn, &id)? {
            inputs.push(input);
        }
    }
    Ok(inputs)
}

fn load_job_judge_input(conn: &Connection, encrypt_job_id: &str) -> Result<Option<JobJudgeInput>, String> {
    let row = conn
        .query_row(
            r#"
      SELECT
        json_object(
          'encrypt_job_id', j.encrypt_job_id,
          'source_platform', COALESCE(NULLIF(j.source_platform, ''), 'boss'),
          'source_url', j.source_url,
          'dedup_key', j.dedup_key,
          'position_name', j.position_name,
          'boss_name', j.boss_name,
          'boss_active_status', j.boss_active_status,
          'brand_name', j.brand_name,
          'city_name', j.city_name,
          'salary_desc', j.salary_desc,
          'experience_name', j.experience_name,
          'degree_name', j.degree_name,
          'jd_text', j.jd_text,
          'raw_payload_json', j.raw_payload_json,
          'detail_json', d.zp_data_json,
          'last_seen_at', j.last_seen_at,
          'review_status', COALESCE(rs.review_status, 'pending'),
          'communication_status', COALESCE(rs.communication_status, 'not_contacted'),
          'company_review_status', COALESCE(crs.review_status, 'pending')
        ),
        r.reason_json
      FROM job j
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      WHERE j.encrypt_job_id = ?1
      LIMIT 1
      "#,
            [encrypt_job_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((job_json, reason_json)) = row else {
        return Ok(None);
    };
    let job = serde_json::from_str::<Value>(&job_json).map_err(|e| e.to_string())?;
    let filter_reason = reason_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .unwrap_or_else(|| json!({ "eligible": true, "bucket": "recommended" }));
    Ok(Some(JobJudgeInput {
        encrypt_job_id: encrypt_job_id.to_string(),
        job,
        hard_blocked: has_hard_block(&filter_reason),
        filter_reason,
    }))
}

fn merge_ai_judgement(
    deterministic_reason: &Value,
    worker: WorkerPostCollectionJudgeResult,
) -> Result<Value, String> {
    let bucket = normalize_worker_bucket(&worker.bucket, worker.confidence);
    if worker.summary.trim().is_empty() || worker.evidence.iter().all(|item| item.trim().is_empty()) {
        return Ok(build_pending_reason(deterministic_reason, "AI 采后判断缺少可解释原因或证据"));
    }
    let mut reason = deterministic_reason.clone();
    let Some(object) = reason.as_object_mut() else {
        return Err("采后判断 reason_json 不是 JSON 对象。".to_string());
    };
    object.insert("eligible".to_string(), json!(bucket == "recommended"));
    object.insert("bucket".to_string(), json!(bucket));
    object.insert(
        "ai_judgement".to_string(),
        json!({
          "bucket": bucket,
          "confidence": worker.confidence.clamp(0.0, 1.0),
          "summary": worker.summary.trim(),
          "evidence": clean_string_vec(worker.evidence),
          "risks": clean_string_vec(worker.risks),
        }),
    );
    Ok(reason)
}

fn persist_ai_pending_fallback(
    conn: &Connection,
    profile_id: &str,
    input: &JobJudgeInput,
) -> Result<(), String> {
    let reason = build_pending_reason(&input.filter_reason, "AI 采后判断失败，先进入待确认");
    db::models::upsert_job_filter_result(conn, &input.encrypt_job_id, profile_id, false, &reason)
        .map_err(|e| e.to_string())
}

fn build_pending_reason(deterministic_reason: &Value, summary: &str) -> Value {
    let mut reason = deterministic_reason.clone();
    if let Some(object) = reason.as_object_mut() {
        object.insert("eligible".to_string(), json!(false));
        object.insert("bucket".to_string(), json!("pending_confirmation"));
        object.insert(
            "ai_judgement".to_string(),
            json!({
              "bucket": "pending_confirmation",
              "confidence": 0.0,
              "summary": summary,
              "evidence": ["AI 判断未产生稳定结构化证据"],
              "risks": ["需要人工确认"],
            }),
        );
    }
    reason
}

fn normalize_worker_bucket(bucket: &str, confidence: f64) -> &'static str {
    if confidence < LOW_CONFIDENCE_THRESHOLD {
        return "pending_confirmation";
    }
    match bucket {
        "recommended" => "recommended",
        "filtered" => "filtered",
        _ => "pending_confirmation",
    }
}

fn reason_bucket(reason: &Value) -> &str {
    reason
        .get("bucket")
        .and_then(Value::as_str)
        .unwrap_or("pending_confirmation")
}

fn has_hard_block(reason: &Value) -> bool {
    reason
        .get("blocked_by")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().any(|item| {
                item.get("rule_type")
                    .and_then(Value::as_str)
                    .is_some_and(is_hard_rule_type)
            })
        })
}

fn is_hard_rule_type(rule_type: &str) -> bool {
    matches!(
        rule_type,
        "company_blacklist"
            | "job_blacklist"
            | "keyword_blacklist"
            | "review_status"
            | "communication_status"
            | "company_review_status"
            | "source_platform"
            | "boss_active_status"
    )
}

fn clean_string_vec(items: Vec<String>) -> Vec<String> {
    items
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn build_telegram_summary(
    counts: &crate::db::models::BucketCounts,
    updated: u64,
    ai_judged: u64,
    hard_skipped: u64,
    failed: u64,
) -> String {
    vec![
        "【Job Sync AI 采后判断】".to_string(),
        format!("更新：{updated} 个岗位，AI 判断：{ai_judged} 个，硬规则跳过：{hard_skipped} 个，失败：{failed} 个"),
        format!(
            "分区：推荐 {} / 待确认 {} / 已过滤 {} / 已处理 {} / 全部 {}",
            counts.recommended, counts.pending, counts.filtered, counts.processed, counts.all
        ),
        "入口：打开 Job Sync 查看职位库和 AI 采后结果；不会自动投递。".to_string(),
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hard_rule_blocks_skip_ai() {
        let reason = json!({
          "blocked_by": [{ "rule_type": "company_blacklist", "field": "brand_name", "value": "x", "reason": "黑名单" }]
        });

        assert!(has_hard_block(&reason));
    }

    #[test]
    fn soft_rule_can_use_ai() {
        let reason = json!({
          "blocked_by": [{ "rule_type": "required_direction", "field": "jd_text", "value": "Rust", "reason": "缺少方向" }]
        });

        assert!(!has_hard_block(&reason));
    }

    #[test]
    fn low_confidence_maps_to_pending() {
        assert_eq!(normalize_worker_bucket("recommended", 0.64), "pending_confirmation");
        assert_eq!(normalize_worker_bucket("recommended", 0.65), "recommended");
    }

    #[test]
    fn merge_ai_recommended_sets_candidate_bucket() {
        let reason = merge_ai_judgement(
            &json!({
              "eligible": true,
              "bucket": "recommended",
              "matched_preferences": ["tech:Go"]
            }),
            WorkerPostCollectionJudgeResult {
                bucket: "recommended".to_string(),
                confidence: 0.82,
                summary: "方向和技术栈匹配".to_string(),
                evidence: vec!["JD 提到 Go 后端开发".to_string()],
                risks: Vec::new(),
            },
        )
        .expect("merge reason");

        assert_eq!(reason["eligible"], json!(true));
        assert_eq!(reason["bucket"], json!("recommended"));
        assert_eq!(reason["ai_judgement"]["summary"], json!("方向和技术栈匹配"));
    }

    #[test]
    fn merge_invalid_ai_explanation_falls_back_to_pending() {
        let reason = merge_ai_judgement(
            &json!({
              "eligible": true,
              "bucket": "recommended"
            }),
            WorkerPostCollectionJudgeResult {
                bucket: "recommended".to_string(),
                confidence: 0.9,
                summary: "".to_string(),
                evidence: vec!["".to_string()],
                risks: Vec::new(),
            },
        )
        .expect("merge fallback");

        assert_eq!(reason["eligible"], json!(false));
        assert_eq!(reason["bucket"], json!("pending_confirmation"));
        assert_eq!(reason["ai_judgement"]["bucket"], json!("pending_confirmation"));
    }
}
