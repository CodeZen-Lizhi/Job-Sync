use std::collections::HashSet;
use std::fmt::Write as _;

use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    commands::filter_profile,
    commands::settings::send_telegram_message_from_settings_with_format,
    db, ipc,
    ipc::protocol::{AiPostCollectionJudgePayload, CommandIn, EventOut, LogPayload},
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
const AI_STATUS_PASSED: &str = "passed";
const AI_STATUS_REJECTED: &str = "rejected";
const AI_STATUS_PENDING_CONFIRMATION: &str = "pending_confirmation";
const AI_STATUS_FAILED: &str = "failed";

#[derive(Debug)]
struct JobJudgeInput {
    encrypt_job_id: String,
    job: Value,
    filter_reason: Value,
    hard_blocked: bool,
}

#[derive(Debug, Clone)]
struct TelegramJobSummary {
    title: String,
    url: String,
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
    let mut telegram_jobs = Vec::<TelegramJobSummary>::new();

    for input in inputs {
        let job_label = format_job_label(&input);
        if input.hard_blocked {
            hard_skipped += 1;
            emit_ai_judge_log(
                &app,
                "info",
                format!("AI 审核跳过：{job_label}，命中硬规则，保留现有结果"),
            );
            continue;
        }

        emit_ai_judge_log(&app, "info", format!("AI 审核开始：{job_label}"));
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
            Err(err) => {
                persist_ai_failed_fallback(&conn, &profile.id, &input, &err)?;
                emit_ai_judge_log(&app, "error", format!("AI 审核失败：{job_label}：{err}"));
                failed += 1;
                updated += 1;
                continue;
            }
        };
        let parsed: WorkerPostCollectionJudgeResult = match serde_json::from_value(raw_result) {
            Ok(value) => value,
            Err(err) => {
                let message = format!("AI 采后判断输出不符合结构：{err}");
                persist_ai_failed_fallback(&conn, &profile.id, &input, &message)?;
                emit_ai_judge_log(
                    &app,
                    "error",
                    format!("AI 审核失败：{job_label}：{message}"),
                );
                failed += 1;
                updated += 1;
                continue;
            }
        };
        let reason = merge_ai_judgement(&input.filter_reason, parsed)?;
        let bucket = reason_bucket(&reason);
        let eligible = bucket == "recommended";
        db::models::upsert_job_filter_result(
            &conn,
            &input.encrypt_job_id,
            &profile.id,
            eligible,
            &reason,
        )
        .map_err(|e| e.to_string())?;
        emit_ai_judge_log(
            &app,
            "info",
            format!(
                "AI 审核完成：{job_label}：{}{}",
                ai_status_label(reason_ai_status(&reason), bucket),
                reason
                    .get("ai_judgement")
                    .and_then(|judgement| judgement.get("summary"))
                    .and_then(Value::as_str)
                    .map(|summary| format!("，{summary}"))
                    .unwrap_or_default()
            ),
        );
        updated += 1;
        ai_judged += 1;

        if ai_status_for_bucket(bucket) == AI_STATUS_PASSED {
            if let Some(job) = build_telegram_job_summary(&input.job, &input.encrypt_job_id) {
                telegram_jobs.push(job);
            }
        }
    }

    let counts = filter_profile::count_filter_buckets_on_conn(&conn)?;
    let mut telegram_sent = false;
    let mut telegram_error = None::<String>;
    if ai_judged > 0 {
        let telegram_messages = build_telegram_summary_messages(
            &counts,
            updated,
            ai_judged,
            hard_skipped,
            failed,
            &telegram_jobs,
        );
        match saved_settings.as_ref() {
            Some(settings) => {
                for message in telegram_messages {
                    match send_telegram_message_from_settings_with_format(settings, &message, Some("HTML")) {
                        Ok(()) => telegram_sent = true,
                        Err(err) => {
                            telegram_error = Some(err);
                            break;
                        }
                    }
                }
            }
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

fn emit_ai_judge_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let _ = ipc::emit_event_all(
        app,
        &EventOut::Log(LogPayload {
            level: level.to_string(),
            message: message.into(),
            ts: None,
        }),
    );
}

fn format_job_label(input: &JobJudgeInput) -> String {
    let title = input
        .job
        .get("position_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名岗位");
    format!("{title} ({})", input.encrypt_job_id)
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

fn load_job_judge_input(
    conn: &Connection,
    encrypt_job_id: &str,
) -> Result<Option<JobJudgeInput>, String> {
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
    if worker.summary.trim().is_empty() || worker.evidence.iter().all(|item| item.trim().is_empty())
    {
        return Ok(build_pending_reason(
            deterministic_reason,
            "AI 采后判断缺少可解释原因或证据",
        ));
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
          "status": ai_status_for_bucket(bucket),
          "bucket": bucket,
          "confidence": worker.confidence.clamp(0.0, 1.0),
          "summary": worker.summary.trim(),
          "evidence": clean_string_vec(worker.evidence),
          "risks": clean_string_vec(worker.risks),
        }),
    );
    Ok(reason)
}

fn persist_ai_failed_fallback(
    conn: &Connection,
    profile_id: &str,
    input: &JobJudgeInput,
    error: &str,
) -> Result<(), String> {
    let reason = build_failed_reason(&input.filter_reason, error);
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
              "status": AI_STATUS_PENDING_CONFIRMATION,
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

fn build_failed_reason(deterministic_reason: &Value, error: &str) -> Value {
    let mut reason = deterministic_reason.clone();
    if let Some(object) = reason.as_object_mut() {
        object.insert("eligible".to_string(), json!(false));
        object.insert("bucket".to_string(), json!("pending_confirmation"));
        object.insert(
            "ai_judgement".to_string(),
            json!({
              "status": AI_STATUS_FAILED,
              "bucket": "pending_confirmation",
              "confidence": 0.0,
              "summary": "AI 采后判断失败",
              "evidence": ["AI 调用或输出解析失败"],
              "risks": [error.trim()],
            }),
        );
    }
    reason
}

fn ai_status_for_bucket(bucket: &str) -> &'static str {
    match bucket {
        "recommended" => AI_STATUS_PASSED,
        "filtered" => AI_STATUS_REJECTED,
        _ => AI_STATUS_PENDING_CONFIRMATION,
    }
}

fn reason_ai_status(reason: &Value) -> &str {
    reason
        .get("ai_judgement")
        .and_then(|judgement| judgement.get("status"))
        .and_then(Value::as_str)
        .unwrap_or_else(|| ai_status_for_bucket(reason_bucket(reason)))
}

fn ai_status_label(status: &str, bucket: &str) -> &'static str {
    match status {
        AI_STATUS_PASSED => "通过",
        AI_STATUS_REJECTED => "不通过",
        AI_STATUS_PENDING_CONFIRMATION => "待确认",
        AI_STATUS_FAILED => "审核失败",
        _ => match bucket {
            "recommended" => "通过",
            "filtered" => "不通过",
            _ => "待确认",
        },
    }
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

fn build_telegram_summary_messages(
    counts: &crate::db::models::BucketCounts,
    updated: u64,
    ai_judged: u64,
    hard_skipped: u64,
    failed: u64,
    telegram_jobs: &[TelegramJobSummary],
) -> Vec<String> {
    let mut messages = vec![build_telegram_overview_message(
        counts,
        updated,
        ai_judged,
        hard_skipped,
        failed,
        telegram_jobs.len() as u64,
    )];

    for (index, chunk) in telegram_jobs.chunks(20).enumerate() {
        let mut body = String::new();
        let _ = writeln!(
            &mut body,
            "{}",
            if index == 0 {
                "成功岗位"
            } else {
                "成功岗位（续）"
            }
        );
        for (i, job) in chunk.iter().enumerate() {
            let _ = writeln!(
                &mut body,
                "{}. <a href=\"{}\">{}</a>",
                index * 20 + i + 1,
                escape_html(&job.url),
                escape_html(&job.title)
            );
        }
        messages.push(body.trim_end().to_string());
    }

    messages
}

fn build_telegram_overview_message(
    counts: &crate::db::models::BucketCounts,
    updated: u64,
    ai_judged: u64,
    hard_skipped: u64,
    failed: u64,
    passed_jobs: u64,
) -> String {
    vec![
        "【Job Sync AI 采后判断】".to_string(),
        format!("更新：{updated} 个岗位，AI 判断：{ai_judged} 个，硬规则跳过：{hard_skipped} 个，失败：{failed} 个"),
        format!(
            "通过：{passed_jobs} 个；推荐 {} / 待确认 {} / 已过滤 {} / 已处理 {} / 全部 {}",
            counts.recommended, counts.pending, counts.filtered, counts.processed, counts.all
        ),
        "成功岗位分批发送，标题可点击。".to_string(),
    ]
    .join("\n")
}

fn build_telegram_job_summary(job: &Value, encrypt_job_id: &str) -> Option<TelegramJobSummary> {
    let title = job
        .get("position_name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名岗位")
        .to_string();
    let source_url = job
        .get("source_url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            job.get("detail_json")
                .and_then(Value::as_object)
                .and_then(|detail| detail.get("jobInfo"))
                .and_then(Value::as_object)
                .and_then(|job_info| job_info.get("jobUrl"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        });
    source_url.map(|url| TelegramJobSummary {
        title: format!("{title}"),
        url: if url.contains("http") {
            url
        } else {
            format!("https://www.zhipin.com/job_detail/?query={encrypt_job_id}")
        },
    })
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
fn telegram_messages_for_test(
    counts: &crate::db::models::BucketCounts,
    updated: u64,
    ai_judged: u64,
    hard_skipped: u64,
    failed: u64,
    telegram_jobs: &[TelegramJobSummary],
) -> Vec<String> {
    build_telegram_summary_messages(counts, updated, ai_judged, hard_skipped, failed, telegram_jobs)
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
        assert_eq!(
            normalize_worker_bucket("recommended", 0.64),
            "pending_confirmation"
        );
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
        assert_eq!(reason["ai_judgement"]["status"], json!("passed"));
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
        assert_eq!(
            reason["ai_judgement"]["status"],
            json!("pending_confirmation")
        );
        assert_eq!(
            reason["ai_judgement"]["bucket"],
            json!("pending_confirmation")
        );
    }

    #[test]
    fn failed_ai_judgement_keeps_failure_status() {
        let reason = build_failed_reason(
            &json!({
              "eligible": true,
              "bucket": "recommended"
            }),
            "provider returned 503",
        );

        assert_eq!(reason["eligible"], json!(false));
        assert_eq!(reason["bucket"], json!("pending_confirmation"));
        assert_eq!(reason["ai_judgement"]["status"], json!("failed"));
        assert_eq!(
            reason["ai_judgement"]["risks"][0],
            json!("provider returned 503")
        );
    }

    #[test]
    fn telegram_summary_messages_split_job_links() {
        let counts = crate::db::models::BucketCounts {
            recommended: 21,
            pending: 2,
            filtered: 3,
            processed: 26,
            all: 26,
        };
        let jobs = (0..21)
            .map(|i| TelegramJobSummary {
                title: format!("岗位{i}"),
                url: format!("https://example.com/{i}"),
            })
            .collect::<Vec<_>>();

        let messages = telegram_messages_for_test(&counts, 26, 21, 0, 0, &jobs);
        assert_eq!(messages.len(), 3);
        assert!(messages[0].contains("通过：21 个"));
        assert!(messages[1].contains("成功岗位"));
        assert!(messages[1].contains("<a href=\"https://example.com/0\">岗位0</a>"));
        assert!(messages[2].contains("成功岗位（续）"));
        assert!(messages[2].contains("<a href=\"https://example.com/20\">岗位20</a>"));
    }
}
