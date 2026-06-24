use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::{commands::filter_profile, db, paths};

use super::{models::CompanyScoreRebuildResult, shared::open_conn};

const REVIEW_STATUSES: &[&str] = &[
    "pending",
    "favorited",
    "ready_to_apply",
    "applied",
    "ignored",
];
const COMPANY_REVIEW_STATUSES: &[&str] = &["pending", "manual_not_fit"];
const COMMUNICATION_STATUSES: &[&str] = &[
    "not_contacted",
    "greeted_unread",
    "read_no_reply",
    "replied",
    "rejected",
    "manual_not_fit",
];

fn cascade_delete_job(tx: &Transaction, encrypt_job_id: &str) -> Result<(), String> {
    let company_name = tx
        .query_row(
            "SELECT brand_name FROM job WHERE encrypt_job_id = ?1",
            params![encrypt_job_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .unwrap_or(None);
    tx.execute(
        "DELETE FROM ai_report WHERE encrypt_job_id = ?1",
        params![encrypt_job_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM job_filter_result WHERE encrypt_job_id = ?1",
        params![encrypt_job_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM job_review_state WHERE encrypt_job_id = ?1",
        params![encrypt_job_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM job_blacklist WHERE kind = 'job' AND value = ?1",
        params![encrypt_job_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM job_source_link WHERE encrypt_job_id = ?1",
        params![encrypt_job_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM job_detail_raw WHERE encrypt_job_id = ?1",
        params![encrypt_job_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM job WHERE encrypt_job_id = ?1",
        params![encrypt_job_id],
    )
    .map_err(|e| e.to_string())?;
    prune_company_score_if_unused(tx, company_name.as_deref())?;
    Ok(())
}

fn prune_company_score_if_unused(
    tx: &Transaction,
    company_name: Option<&str>,
) -> Result<(), String> {
    let Some(company_name) = company_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let remaining: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM job WHERE brand_name = ?1",
            params![company_name],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if remaining == 0 {
        tx.execute(
            "DELETE FROM company_score WHERE company_name = ?1",
            params![company_name],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn delete_job(app: tauri::AppHandle, encrypt_job_id: String) -> Result<(), String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let mut conn = open_conn(&app_data_dir)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    cascade_delete_job(&tx, &encrypt_job_id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_all_jobs(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let mut conn = open_conn(&app_data_dir)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute_batch(
        "DELETE FROM ai_report;
     DELETE FROM job_filter_result;
     DELETE FROM job_review_state;
     DELETE FROM job_blacklist WHERE kind = 'job';
     DELETE FROM job_source_link;
     DELETE FROM job_detail_raw;
     DELETE FROM company_score;
     DELETE FROM job;",
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn rebuild_job_fields(app: tauri::AppHandle) -> Result<u64, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    db::models::rebuild_all_job_fields(&conn).map_err(|e| e.to_string())
}

pub fn rebuild_company_scores(app: tauri::AppHandle) -> Result<CompanyScoreRebuildResult, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let summary = db::models::rebuild_company_scores(&conn).map_err(|e| e.to_string())?;
    Ok(CompanyScoreRebuildResult {
        companies: summary.companies,
        jobs: summary.jobs,
    })
}

pub(super) fn set_job_source_enabled_on_conn(
    conn: &Connection,
    platform: &str,
    enabled: bool,
) -> Result<(), String> {
    let platform = platform.trim().to_ascii_lowercase();
    if platform.is_empty() {
        return Err("平台不能为空".to_string());
    }
    let updated = conn
        .execute(
            r#"
            UPDATE job_sources
            SET enabled = ?2,
                updated_at = datetime('now')
            WHERE platform = ?1
            "#,
            params![platform, if enabled { 1 } else { 0 }],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err(format!("未知平台: {platform}"));
    }
    Ok(())
}

pub fn set_job_source_enabled(
    app: tauri::AppHandle,
    platform: String,
    enabled: bool,
) -> Result<Vec<super::JobSourceEntry>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    set_job_source_enabled_on_conn(&conn, &platform, enabled)?;
    super::queries::list_job_sources_on_conn(&conn)
}

fn normalize_optional_value(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

#[derive(Debug, Clone)]
struct BlacklistScope {
    kind: String,
    value: String,
}

fn recompute_after_blacklist_change(
    conn: &Connection,
    scope: &BlacklistScope,
) -> Result<(), String> {
    match scope.kind.as_str() {
        db::models::BLACKLIST_KIND_COMPANY => {
            let _ = filter_profile::recompute_default_filter_profile_for_company_on_conn(
                conn,
                &scope.value,
            )?;
        }
        db::models::BLACKLIST_KIND_JOB => {
            let _ = filter_profile::recompute_default_filter_profile_for_job_on_conn(
                conn,
                &scope.value,
            )?;
        }
        db::models::BLACKLIST_KIND_KEYWORD => {
            let _ = filter_profile::recompute_default_filter_profile_on_conn(conn)?;
        }
        _ => {}
    }
    Ok(())
}

fn upsert_blacklist_on_conn(
    conn: &Connection,
    kind: &str,
    value: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    db::models::upsert_job_blacklist(conn, kind, value, reason).map_err(|e| e.to_string())?;
    recompute_after_blacklist_change(
        conn,
        &BlacklistScope {
            kind: kind.to_string(),
            value: value.to_string(),
        },
    )
}

fn validate_status(
    value: Option<String>,
    allowed: &[&str],
    field: &str,
) -> Result<Option<String>, String> {
    let normalized = normalize_optional_value(value);
    if let Some(status) = normalized.as_deref() {
        if !allowed.contains(&status) {
            return Err(format!("{field} 不支持的值: {status}"));
        }
    }
    Ok(normalized)
}

fn set_job_review_state_on_conn(
    conn: &Connection,
    encrypt_job_id: &str,
    review_status: Option<String>,
    communication_status: Option<String>,
    last_greeted_at: Option<String>,
    notes: Option<String>,
) -> Result<(), String> {
    let encrypt_job_id = encrypt_job_id.trim().to_string();
    if encrypt_job_id.is_empty() {
        return Err("encrypt_job_id 不能为空".to_string());
    }

    let review_status = validate_status(review_status, REVIEW_STATUSES, "review_status")?;
    let communication_status = validate_status(
        communication_status,
        COMMUNICATION_STATUSES,
        "communication_status",
    )?;
    let last_greeted_at = normalize_optional_value(last_greeted_at);
    let notes = normalize_optional_value(notes);
    let should_recompute_filter = review_status.is_some() || communication_status.is_some();

    db::models::upsert_job_review_state(
        conn,
        &encrypt_job_id,
        review_status.as_deref(),
        communication_status.as_deref(),
        last_greeted_at.as_deref(),
        notes.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    if should_recompute_filter {
        let _ = filter_profile::recompute_default_filter_profile_for_job_on_conn(
            conn,
            &encrypt_job_id,
        )?;
    }
    Ok(())
}

pub fn set_job_review_state(
    app: tauri::AppHandle,
    encrypt_job_id: String,
    review_status: Option<String>,
    communication_status: Option<String>,
    last_greeted_at: Option<String>,
    notes: Option<String>,
) -> Result<(), String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    set_job_review_state_on_conn(
        &conn,
        &encrypt_job_id,
        review_status,
        communication_status,
        last_greeted_at,
        notes,
    )
}

pub fn set_job_review_notes(
    app: tauri::AppHandle,
    encrypt_job_id: String,
    notes: Option<String>,
) -> Result<(), String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let encrypt_job_id = encrypt_job_id.trim().to_string();
    if encrypt_job_id.is_empty() {
        return Err("encrypt_job_id 不能为空".to_string());
    }

    let notes = normalize_optional_value(notes);
    db::models::set_job_review_notes(&conn, &encrypt_job_id, notes.as_deref())
        .map_err(|e| e.to_string())
}

pub fn set_company_review_state(
    app: tauri::AppHandle,
    company_name: String,
    review_status: String,
    notes: Option<String>,
) -> Result<(), String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let company_name = company_name.trim().to_string();
    if company_name.is_empty() {
        return Err("公司名称不能为空".to_string());
    }

    let review_status = validate_status(
        Some(review_status),
        COMPANY_REVIEW_STATUSES,
        "review_status",
    )?
    .ok_or_else(|| "review_status 不能为空".to_string())?;
    let notes = normalize_optional_value(notes);

    db::models::upsert_company_review_state(&conn, &company_name, &review_status, notes.as_deref())
        .map_err(|e| e.to_string())?;
    let _ =
        filter_profile::recompute_default_filter_profile_for_company_on_conn(&conn, &company_name)?;
    Ok(())
}

pub fn add_company_blacklist(
    app: tauri::AppHandle,
    company_name: String,
    reason: Option<String>,
) -> Result<(), String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let company_name = company_name.trim().to_string();
    if company_name.is_empty() {
        return Err("公司名称不能为空".to_string());
    }
    let reason = normalize_optional_value(reason);
    upsert_blacklist_on_conn(
        &conn,
        db::models::BLACKLIST_KIND_COMPANY,
        &company_name,
        reason.as_deref(),
    )
}

pub fn add_job_blacklist(
    app: tauri::AppHandle,
    encrypt_job_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let encrypt_job_id = encrypt_job_id.trim().to_string();
    if encrypt_job_id.is_empty() {
        return Err("encrypt_job_id 不能为空".to_string());
    }
    let reason = normalize_optional_value(reason);
    upsert_blacklist_on_conn(
        &conn,
        db::models::BLACKLIST_KIND_JOB,
        &encrypt_job_id,
        reason.as_deref(),
    )
}

pub fn add_keyword_blacklist(
    app: tauri::AppHandle,
    keyword: String,
    reason: Option<String>,
) -> Result<(), String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let keyword = keyword.trim().to_string();
    if keyword.is_empty() {
        return Err("关键词不能为空".to_string());
    }
    let reason = normalize_optional_value(reason);
    upsert_blacklist_on_conn(
        &conn,
        db::models::BLACKLIST_KIND_KEYWORD,
        &keyword,
        reason.as_deref(),
    )
}

fn delete_job_blacklist_on_conn(
    conn: &Connection,
    blacklist_id: i64,
) -> Result<BlacklistScope, String> {
    if blacklist_id <= 0 {
        return Err("blacklist_id 必须大于 0".to_string());
    }
    let scope = conn
        .query_row(
            "SELECT kind, value FROM job_blacklist WHERE id = ?1",
            params![blacklist_id],
            |row| {
                Ok(BlacklistScope {
                    kind: row.get(0)?,
                    value: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "黑名单记录不存在".to_string())?;
    let affected = conn
        .execute(
            "DELETE FROM job_blacklist WHERE id = ?1",
            params![blacklist_id],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("黑名单记录不存在".to_string());
    }
    Ok(scope)
}

pub fn delete_job_blacklist(app: tauri::AppHandle, blacklist_id: i64) -> Result<(), String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = open_conn(&app_data_dir)?;
    let scope = delete_job_blacklist_on_conn(&conn, blacklist_id)?;
    recompute_after_blacklist_change(&conn, &scope)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::jobs::queries;
    use crate::db::{self, models};
    use serde_json::Value;

    fn seed_job(conn: &Connection, encrypt_job_id: &str, position_name: &str, company_name: &str) {
        conn
      .execute(
        r#"
        INSERT INTO job (
          encrypt_job_id,
          source_platform,
          position_name,
          boss_name,
          brand_name,
          city_name,
          salary_desc,
          experience_name,
          degree_name,
          last_seen_at
        )
        VALUES (?1, 'boss', ?2, 'Boss', ?3, '北京', '25-45K', '3-5年', '本科', '2026-06-13T00:00:00Z')
        "#,
        params![encrypt_job_id, position_name, company_name],
      )
      .expect("seed job");
    }

    fn filter_reason(conn: &Connection, encrypt_job_id: &str) -> Value {
        let raw: String = conn
            .query_row(
                "SELECT reason_json FROM job_filter_result WHERE encrypt_job_id = ?1",
                params![encrypt_job_id],
                |row| row.get(0),
            )
            .expect("load filter reason");
        serde_json::from_str(&raw).expect("parse filter reason")
    }

    fn filter_eligible(conn: &Connection, encrypt_job_id: &str) -> i64 {
        conn.query_row(
            "SELECT eligible FROM job_filter_result WHERE encrypt_job_id = ?1",
            params![encrypt_job_id],
            |row| row.get(0),
        )
        .expect("load filter eligible")
    }

    #[test]
    fn delete_job_blacklist_removes_existing_entry() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        models::upsert_job_blacklist(
            &conn,
            models::BLACKLIST_KIND_KEYWORD,
            "外包",
            Some("排除外包岗位"),
        )
        .expect("seed keyword blacklist");
        let blacklist_id: i64 = conn
            .query_row(
                "SELECT id FROM job_blacklist WHERE kind = 'keyword' AND value = '外包'",
                [],
                |row| row.get(0),
            )
            .expect("load blacklist id");

        delete_job_blacklist_on_conn(&conn, blacklist_id).expect("delete blacklist");
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM job_blacklist", [], |row| row.get(0))
            .expect("count blacklist");
        assert_eq!(remaining, 0);
        assert!(delete_job_blacklist_on_conn(&conn, blacklist_id).is_err());
    }

    #[test]
    fn add_and_delete_keyword_blacklist_recomputes_filter_result() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job(
            &conn,
            "job_keyword_recompute",
            "Go LegacyVendorX 平台工程师",
            "Keyword Co",
        );
        filter_profile::recompute_default_filter_profile_for_job_on_conn(
            &conn,
            "job_keyword_recompute",
        )
        .expect("initial recompute");
        assert_eq!(filter_eligible(&conn, "job_keyword_recompute"), 1);

        upsert_blacklist_on_conn(
            &conn,
            models::BLACKLIST_KIND_KEYWORD,
            "LegacyVendorX",
            Some("自定义关键词排除"),
        )
        .expect("add keyword blacklist");
        assert_eq!(filter_eligible(&conn, "job_keyword_recompute"), 0);
        let blocked_reason = filter_reason(&conn, "job_keyword_recompute");
        assert!(
            blocked_reason["blocked_by"]
                .as_array()
                .expect("blocked rules")
                .iter()
                .any(|item| item.get("rule_type").and_then(Value::as_str)
                    == Some("keyword_blacklist"))
        );

        let blacklist_id: i64 = conn
            .query_row(
                "SELECT id FROM job_blacklist WHERE kind = 'keyword' AND value = 'LegacyVendorX'",
                [],
                |row| row.get(0),
            )
            .expect("load blacklist id");
        let scope =
            delete_job_blacklist_on_conn(&conn, blacklist_id).expect("delete keyword blacklist");
        recompute_after_blacklist_change(&conn, &scope).expect("recompute after delete");

        assert_eq!(filter_eligible(&conn, "job_keyword_recompute"), 1);
        let restored_reason = filter_reason(&conn, "job_keyword_recompute");
        assert!(
            !restored_reason["blocked_by"]
                .as_array()
                .expect("blocked rules")
                .iter()
                .any(|item| item.get("rule_type").and_then(Value::as_str)
                    == Some("keyword_blacklist"))
        );
    }

    #[test]
    fn restore_review_candidate_recomputes_filter_and_reenters_candidates() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job(
            &conn,
            "job_restore_candidate",
            "Go 平台工程师",
            "Restore Co",
        );

        set_job_review_state_on_conn(
            &conn,
            "job_restore_candidate",
            Some("ignored".to_string()),
            Some("read_no_reply".to_string()),
            Some("2026-06-12T00:00:00Z".to_string()),
            Some("用户曾经忽略该岗位".to_string()),
        )
        .expect("mark terminal state");

        assert_eq!(filter_eligible(&conn, "job_restore_candidate"), 1);
        let blocked_reason = filter_reason(&conn, "job_restore_candidate");
        assert!(blocked_reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());
        assert_eq!(blocked_reason["dimensions"]["review_status"], "ignored");
        assert_eq!(
            blocked_reason["dimensions"]["communication_status"],
            "read_no_reply"
        );
        assert!(queries::list_review_candidates_on_conn(&conn, Some(20))
            .expect("list blocked candidates")
            .iter()
            .all(|job| job.encrypt_job_id != "job_restore_candidate"));

        set_job_review_state_on_conn(
            &conn,
            "job_restore_candidate",
            Some("pending".to_string()),
            Some("not_contacted".to_string()),
            None,
            None,
        )
        .expect("restore candidate state");

        assert_eq!(filter_eligible(&conn, "job_restore_candidate"), 1);
        let restored_reason = filter_reason(&conn, "job_restore_candidate");
        assert_eq!(restored_reason["dimensions"]["review_status"], "pending");
        assert_eq!(
            restored_reason["dimensions"]["communication_status"],
            "not_contacted"
        );
        assert!(restored_reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());

        let restored = queries::list_review_candidates_on_conn(&conn, Some(20))
            .expect("list restored candidates")
            .into_iter()
            .find(|job| job.encrypt_job_id == "job_restore_candidate")
            .expect("restored candidate");
        assert_eq!(restored.review_status.as_deref(), Some("pending"));
        assert_eq!(
            restored.communication_status.as_deref(),
            Some("not_contacted")
        );
        assert_eq!(restored.last_greeted_at.as_deref(), None);
    }

    #[test]
    fn restore_review_candidate_keeps_hard_filters_and_blacklists_excluded() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        seed_job(
            &conn,
            "job_profile_blocked_restore",
            "驻场 Go 平台工程师",
            "Profile Block Co",
        );
        seed_job(
            &conn,
            "job_blacklisted_restore",
            "Go 平台工程师",
            "Blacklist Restore Co",
        );
        seed_job(
            &conn,
            "job_company_not_fit_restore",
            "Go SRE 工程师",
            "Company Not Fit Co",
        );

        upsert_blacklist_on_conn(
            &conn,
            models::BLACKLIST_KIND_JOB,
            "job_blacklisted_restore",
            Some("用户从过滤解释加入职位黑名单"),
        )
        .expect("seed job blacklist");
        models::upsert_company_review_state(
            &conn,
            "Company Not Fit Co",
            "manual_not_fit",
            Some("同公司历史判断不合适"),
        )
        .expect("seed company not fit");
        filter_profile::recompute_default_filter_profile_for_company_on_conn(
            &conn,
            "Company Not Fit Co",
        )
        .expect("recompute company state");

        for job_id in [
            "job_profile_blocked_restore",
            "job_blacklisted_restore",
            "job_company_not_fit_restore",
        ] {
            set_job_review_state_on_conn(
                &conn,
                job_id,
                Some("ignored".to_string()),
                Some("read_no_reply".to_string()),
                Some("2026-06-12T00:00:00Z".to_string()),
                Some("恢复前的终态记录".to_string()),
            )
            .expect("mark terminal state");
            set_job_review_state_on_conn(
                &conn,
                job_id,
                Some("pending".to_string()),
                Some("not_contacted".to_string()),
                None,
                None,
            )
            .expect("restore candidate state");
        }

        assert_eq!(filter_eligible(&conn, "job_profile_blocked_restore"), 1);
        assert_eq!(filter_eligible(&conn, "job_blacklisted_restore"), 0);
        assert_eq!(filter_eligible(&conn, "job_company_not_fit_restore"), 1);

        let candidates =
            queries::list_review_candidates_on_conn(&conn, Some(20)).expect("list candidates");
        let candidate_ids = candidates
            .iter()
            .map(|job| job.encrypt_job_id.as_str())
            .collect::<Vec<_>>();
        assert!(candidate_ids.contains(&"job_profile_blocked_restore"));
        assert!(!candidate_ids.contains(&"job_blacklisted_restore"));
        assert!(!candidate_ids.contains(&"job_company_not_fit_restore"));

        let hard_filter_reason = filter_reason(&conn, "job_profile_blocked_restore");
        assert!(hard_filter_reason["blocked_by"]
            .as_array()
            .expect("hard filter rules")
            .is_empty());
        assert_eq!(hard_filter_reason["dimensions"]["review_status"], "pending");

        let blacklist_reason = filter_reason(&conn, "job_blacklisted_restore");
        assert!(blacklist_reason["blocked_by"]
            .as_array()
            .expect("blacklist rules")
            .iter()
            .any(|item| item.get("rule_type").and_then(Value::as_str) == Some("job_blacklist")));

        let company_reason = filter_reason(&conn, "job_company_not_fit_restore");
        assert!(company_reason["blocked_by"]
            .as_array()
            .expect("company state rules")
            .is_empty());
        assert_eq!(
            company_reason["dimensions"]["company_review_status"],
            "manual_not_fit"
        );
    }
}
