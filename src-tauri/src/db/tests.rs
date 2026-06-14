use super::{init_db, models};
use serde_json::{json, Value};

fn json_string_list(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .expect("array field")
        .iter()
        .filter_map(Value::as_str)
        .map(ToString::to_string)
        .collect()
}

#[test]
fn default_filter_profile_includes_common_blacklist_keywords() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let profile = models::load_default_filter_profile(&conn).expect("load default profile");
    let must_not_keywords = profile
        .profile_json
        .get("mustNotKeywords")
        .and_then(serde_json::Value::as_array)
        .expect("mustNotKeywords array");

    let keywords: Vec<String> = must_not_keywords
        .iter()
        .filter_map(serde_json::Value::as_str)
        .map(ToString::to_string)
        .collect();

    assert!(keywords.iter().any(|item| item == "外包"));
    assert!(keywords.iter().any(|item| item == "驻场"));
    assert!(keywords.iter().any(|item| item == "培训"));
    assert!(keywords.iter().any(|item| item == "销售"));
    assert!(keywords.iter().any(|item| item == "电话销售"));

    let source_platforms = profile
        .profile_json
        .get("sourcePlatforms")
        .and_then(serde_json::Value::as_array)
        .expect("sourcePlatforms array");
    assert!(source_platforms
        .iter()
        .any(|item| item.as_str() == Some("boss")));
    assert_eq!(
        profile
            .profile_json
            .get("acceptNegotiableSalary")
            .and_then(serde_json::Value::as_bool),
        Some(false)
    );
    assert_eq!(
        profile
            .profile_json
            .get("acceptUnknownExperience")
            .and_then(serde_json::Value::as_bool),
        Some(true)
    );
    let communication_statuses = profile
        .profile_json
        .get("communicationStatuses")
        .and_then(serde_json::Value::as_array)
        .expect("communicationStatuses array");
    assert!(communication_statuses
        .iter()
        .any(|item| item.as_str() == Some("not_contacted")));
    assert!(communication_statuses
        .iter()
        .any(|item| item.as_str() == Some("greeted_unread")));
    assert!(!communication_statuses
        .iter()
        .any(|item| item.as_str() == Some("read_no_reply")));
    let preference_directions = profile
        .profile_json
        .get("preferenceDirections")
        .and_then(serde_json::Value::as_array)
        .expect("preferenceDirections array");
    for direction in [
        "Go",
        "Infra",
        "DevOps",
        "SRE",
        "平台工程",
        "AI Infra",
        "AI Agent",
        "云原生",
    ] {
        assert!(
            preference_directions
                .iter()
                .any(|item| item.as_str() == Some(direction)),
            "{direction} should be a default preference direction"
        );
    }
    let preference_tech_tags = profile
        .profile_json
        .get("preferenceTechTags")
        .and_then(serde_json::Value::as_array)
        .expect("preferenceTechTags array");
    for tag in [
        "Go",
        "Kubernetes",
        "Docker",
        "AWS",
        "Prometheus",
        "Linux",
        "CI/CD",
        "Terraform",
    ] {
        assert!(
            preference_tech_tags
                .iter()
                .any(|item| item.as_str() == Some(tag)),
            "{tag} should be a default preference tech tag"
        );
    }
    for key in [
        "requiredDirections",
        "requiredTechTags",
        "allowedDegrees",
        "companyMustKeywords",
        "companyMustNotKeywords",
    ] {
        assert!(
            profile
                .profile_json
                .get(key)
                .and_then(serde_json::Value::as_array)
                .is_some(),
            "{key} should be an array"
        );
    }
}

#[test]
fn existing_default_filter_profile_with_missing_or_empty_preferences_is_upgraded() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let old_profile = json!({
      "mustKeywords": [],
      "mustNotKeywords": ["外包"],
      "preferenceTechTags": [],
      "requiredDirections": [],
      "requiredTechTags": []
    });
    conn.execute(
        r#"
      INSERT INTO filter_profile (id, name, profile_json, is_default, updated_at)
      VALUES (?1, ?2, ?3, 1, ?4)
      "#,
        rusqlite::params![
            models::DEFAULT_FILTER_PROFILE_ID,
            "默认筛选画像",
            old_profile.to_string(),
            "2026-06-14T00:00:00Z"
        ],
    )
    .expect("seed old profile");

    let profile =
        models::load_default_filter_profile(&conn).expect("load upgraded default profile");
    let preference_directions = json_string_list(&profile.profile_json, "preferenceDirections");
    let preference_tech_tags = json_string_list(&profile.profile_json, "preferenceTechTags");
    assert!(preference_directions.iter().any(|item| item == "Go"));
    assert!(preference_directions.iter().any(|item| item == "AI Infra"));
    assert!(preference_tech_tags.iter().any(|item| item == "Kubernetes"));
    assert!(preference_tech_tags.iter().any(|item| item == "Terraform"));
    assert!(json_string_list(&profile.profile_json, "requiredDirections").is_empty());
    assert!(json_string_list(&profile.profile_json, "requiredTechTags").is_empty());

    let persisted_text: String = conn
        .query_row(
            "SELECT profile_json FROM filter_profile WHERE id = ?1",
            [models::DEFAULT_FILTER_PROFILE_ID],
            |row| row.get(0),
        )
        .expect("query persisted profile");
    let persisted_json: Value =
        serde_json::from_str(&persisted_text).expect("parse persisted profile");
    assert_eq!(
        json_string_list(&persisted_json, "preferenceDirections"),
        preference_directions
    );
    assert_eq!(
        json_string_list(&persisted_json, "preferenceTechTags"),
        preference_tech_tags
    );
}

#[test]
fn existing_default_filter_profile_preserves_custom_preferences() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let old_profile = json!({
      "mustKeywords": [],
      "mustNotKeywords": ["外包"],
      "preferenceDirections": ["Rust", "Backend"],
      "preferenceTechTags": ["Nix"],
      "requiredDirections": [],
      "requiredTechTags": []
    });
    conn.execute(
        r#"
      INSERT INTO filter_profile (id, name, profile_json, is_default, updated_at)
      VALUES (?1, ?2, ?3, 1, ?4)
      "#,
        rusqlite::params![
            models::DEFAULT_FILTER_PROFILE_ID,
            "默认筛选画像",
            old_profile.to_string(),
            "2026-06-14T00:00:00Z"
        ],
    )
    .expect("seed custom profile");

    let profile = models::load_default_filter_profile(&conn).expect("load custom default profile");
    assert_eq!(
        json_string_list(&profile.profile_json, "preferenceDirections"),
        vec!["Rust".to_string(), "Backend".to_string()]
    );
    assert_eq!(
        json_string_list(&profile.profile_json, "preferenceTechTags"),
        vec!["Nix".to_string()]
    );
    assert!(json_string_list(&profile.profile_json, "requiredDirections").is_empty());
    assert!(json_string_list(&profile.profile_json, "requiredTechTags").is_empty());
}

#[test]
fn multiple_filter_profiles_can_switch_single_default() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let default_profile = models::load_default_filter_profile(&conn).expect("load default profile");
    assert_eq!(default_profile.id, models::DEFAULT_FILTER_PROFILE_ID);
    assert!(default_profile.is_default);

    let remote_profile = json!({
      "mustKeywords": ["远程"],
      "mustNotKeywords": ["外包"],
      "preferenceDirections": ["Go"],
      "preferenceTechTags": ["Kubernetes"]
    });
    let created =
        models::upsert_filter_profile(&conn, "remote-first", "远程优先", &remote_profile, false)
            .expect("create profile");
    assert_eq!(created.id, "remote-first");
    assert!(!created.is_default);

    let switched = models::set_default_filter_profile_id(&conn, "remote-first")
        .expect("switch default profile");
    assert_eq!(switched.id, "remote-first");
    assert!(switched.is_default);

    let loaded = models::load_default_filter_profile(&conn).expect("load switched default");
    assert_eq!(loaded.id, "remote-first");
    assert_eq!(
        json_string_list(&loaded.profile_json, "mustKeywords"),
        vec!["远程".to_string()]
    );

    let profiles = models::list_filter_profiles(&conn).expect("list profiles");
    assert_eq!(
        profiles.iter().filter(|profile| profile.is_default).count(),
        1
    );
    assert!(profiles
        .iter()
        .any(|profile| profile.id == models::DEFAULT_FILTER_PROFILE_ID && !profile.is_default));
}

#[test]
fn init_and_upsert_job_works() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let encrypt_job_id = "encrypt_123";
    let zp_data_json = r#"
    {
      "jobInfo": {
        "encryptJobId": "encrypt_123",
        "securityId": "sec-upsert-123",
        "positionName": "Rust 开发",
        "salaryDesc": "20-40K",
        "experienceName": "3-5 年",
        "degreeName": "本科",
        "cityName": "北京",
        "postDescription": "负责 Rust 平台工程和云原生基础设施"
      },
      "brandInfo": {
        "brandName": "某某科技"
      }
    }
  "#;

    models::upsert_job_from_detail(&conn, encrypt_job_id, zp_data_json).expect("upsert job");

    let mut stmt = conn
        .prepare(
            r#"
      SELECT
        position_name,
        brand_name,
        source_platform,
        source_url,
        dedup_key,
        jd_text,
        raw_payload_json
      FROM job
      WHERE encrypt_job_id = ?1
      "#,
        )
        .expect("prepare");
    let (
        position_name,
        brand_name,
        source_platform,
        source_url,
        dedup_key,
        jd_text,
        raw_payload_json,
    ): (
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = stmt
        .query_row([encrypt_job_id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })
        .expect("query row");

    assert_eq!(position_name.as_deref(), Some("Rust 开发"));
    assert_eq!(brand_name.as_deref(), Some("某某科技"));
    assert_eq!(source_platform, "boss");
    assert_eq!(
        source_url.as_deref(),
        Some("https://www.zhipin.com/job_detail/sec-upsert-123.html")
    );
    assert_eq!(dedup_key.as_deref(), Some("sec-upsert-123"));
    assert_eq!(
        jd_text.as_deref(),
        Some("负责 Rust 平台工程和云原生基础设施")
    );
    assert!(raw_payload_json
        .as_deref()
        .unwrap_or_default()
        .contains("\"securityId\":\"sec-upsert-123\""));

    let mut stmt = conn
        .prepare("SELECT fetched_at FROM job_detail_raw WHERE encrypt_job_id = ?1")
        .expect("prepare raw");
    let fetched_at: String = stmt
        .query_row([encrypt_job_id], |row| row.get(0))
        .expect("query raw");
    assert!(!fetched_at.is_empty());
}

#[test]
fn upsert_job_from_list_item_maps_mock_boss_payload_to_unified_source_fields() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let encrypt_job_id = "encrypt_list_123";
    let item = json!({
      "securityId": "list-sec-123",
      "jobName": "Go SRE 工程师",
      "bossName": "王女士",
      "brandName": "Mock 云科技",
      "cityName": "深圳",
      "salaryDesc": "30-55K",
      "jobExperience": "3-5年",
      "jobDegree": "本科",
      "skills": ["Go", "Kubernetes", "Prometheus"],
      "jobLabels": ["云原生", "长期远程"]
    });

    models::upsert_job_from_list_item(&conn, encrypt_job_id, &item).expect("upsert list item");

    let row: (
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            r#"
      SELECT
        position_name,
        brand_name,
        source_platform,
        source_url,
        dedup_key,
        jd_text,
        raw_payload_json
      FROM job
      WHERE encrypt_job_id = ?1
      "#,
            [encrypt_job_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .expect("query list item job");

    assert_eq!(row.0.as_deref(), Some("Go SRE 工程师"));
    assert_eq!(row.1.as_deref(), Some("Mock 云科技"));
    assert_eq!(row.2, "boss");
    assert_eq!(
        row.3.as_deref(),
        Some("https://www.zhipin.com/job_detail/list-sec-123.html")
    );
    assert_eq!(row.4.as_deref(), Some("list-sec-123"));
    assert_eq!(
        row.5.as_deref(),
        Some("Go SRE 工程师 Mock 云科技 深圳 30-55K 3-5年 本科")
    );
    let raw_payload = row.6.as_deref().unwrap_or_default();
    assert!(raw_payload.contains("\"securityId\":\"list-sec-123\""));
    assert!(raw_payload.contains("Kubernetes"));
}

#[test]
fn upsert_job_from_external_source_maps_manual_import_payload_to_unified_fields() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let payload = json!({
      "job_id": "liepin-remote-123",
      "job_url": "https://www.liepin.com/job/123.shtml",
      "title": "Rust 平台工程师",
      "company": "非 Boss 科技",
      "city": "上海",
      "salary": "30-50K",
      "experience": "5-10年",
      "education": "本科",
      "recruiter": "李女士",
      "description": "负责 Rust 平台工程和 Kubernetes 基础设施"
    });

    let encrypt_job_id =
        models::upsert_job_from_external_source(&conn, "liepin", &payload).expect("import job");

    let row: (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            r#"
      SELECT
        source_platform,
        source_url,
        dedup_key,
        position_name,
        boss_name,
        brand_name,
        city_name,
        salary_desc,
        experience_name,
        degree_name,
        jd_text
      FROM job
      WHERE encrypt_job_id = ?1
      "#,
            [&encrypt_job_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                ))
            },
        )
        .expect("query imported job");

    assert!(encrypt_job_id.starts_with("external:liepin:"));
    assert_eq!(row.0, "liepin");
    assert_eq!(
        row.1.as_deref(),
        Some("https://www.liepin.com/job/123.shtml")
    );
    assert_eq!(row.2.as_deref(), Some("liepin-remote-123"));
    assert_eq!(row.3.as_deref(), Some("Rust 平台工程师"));
    assert_eq!(row.4.as_deref(), Some("李女士"));
    assert_eq!(row.5.as_deref(), Some("非 Boss 科技"));
    assert_eq!(row.6.as_deref(), Some("上海"));
    assert_eq!(row.7.as_deref(), Some("30-50K"));
    assert_eq!(row.8.as_deref(), Some("5-10年"));
    assert_eq!(row.9.as_deref(), Some("本科"));
    assert_eq!(
        row.10.as_deref(),
        Some("负责 Rust 平台工程和 Kubernetes 基础设施")
    );

    let source_keyword: String = conn
        .query_row(
            "SELECT keyword FROM job_source_link WHERE encrypt_job_id = ?1",
            [&encrypt_job_id],
            |row| row.get(0),
        )
        .expect("query source link");
    assert_eq!(source_keyword, "手动导入:liepin");
}

#[test]
fn upsert_job_from_external_source_updates_duplicate_manual_import_job() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let first_payload = json!({
      "job_id": "v2ex-topic-1",
      "title": "Go 工程师",
      "company": "社区团队"
    });
    let second_payload = json!({
      "job_id": "v2ex-topic-1",
      "title": "Go 平台工程师",
      "company": "社区团队",
      "city": "远程"
    });

    let first_id = models::upsert_job_from_external_source(&conn, "v2ex", &first_payload)
        .expect("first import");
    let second_id = models::upsert_job_from_external_source(&conn, "v2ex", &second_payload)
        .expect("second import");

    assert_eq!(first_id, second_id);
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM job WHERE source_platform = 'v2ex' AND dedup_key = 'v2ex-topic-1'",
            [],
            |row| row.get(0),
        )
        .expect("count duplicate source");
    let (position_name, city_name): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT position_name, city_name FROM job WHERE encrypt_job_id = ?1",
            [&second_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("query updated external job");

    assert_eq!(count, 1);
    assert_eq!(position_name.as_deref(), Some("Go 平台工程师"));
    assert_eq!(city_name.as_deref(), Some("远程"));
}

#[test]
fn job_fts_is_created_and_searchable() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let encrypt_job_id = "encrypt_fts_1";
    let zp_data_json = r#"
    {
      "jobInfo": {
        "positionName": "Rust 开发工程师",
        "salaryDesc": "20-40K",
        "experienceName": "3-5 年",
        "degreeName": "本科",
        "cityName": "北京"
      },
      "brandInfo": {
        "brandName": "某某科技"
      }
    }
  "#;

    models::upsert_job_from_detail(&conn, encrypt_job_id, zp_data_json).expect("upsert job");

    let fts_row_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM job_fts WHERE encrypt_job_id = ?1",
            [encrypt_job_id],
            |row| row.get(0),
        )
        .expect("query job_fts");
    assert_eq!(fts_row_count, 1);

    let match_query = "\"Rust\"";
    let match_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM job_fts WHERE job_fts MATCH ?1",
            [match_query],
            |row| row.get(0),
        )
        .expect("fts match");
    assert_eq!(match_count, 1);
}

#[test]
fn reset_communication_status_clears_last_greeted_at() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    models::upsert_job_review_state(
        &conn,
        "encrypt_reset_1",
        Some("pending"),
        Some("greeted_unread"),
        Some("2026-06-14T12:34:56Z"),
        Some("note"),
    )
    .expect("seed greeted state");

    models::upsert_job_review_state(
        &conn,
        "encrypt_reset_1",
        None,
        Some("not_contacted"),
        None,
        None,
    )
    .expect("reset state");

    let last_greeted_at: Option<String> = conn
        .query_row(
            "SELECT last_greeted_at FROM job_review_state WHERE encrypt_job_id = ?1",
            ["encrypt_reset_1"],
            |row| row.get(0),
        )
        .expect("query row");
    assert!(last_greeted_at.is_none());
}

#[test]
fn set_job_review_notes_preserves_state_and_can_clear_notes() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    models::upsert_job_review_state(
        &conn,
        "encrypt_note_1",
        Some("ready_to_apply"),
        Some("greeted_unread"),
        Some("2026-06-14T12:34:56Z"),
        Some("old note"),
    )
    .expect("seed review state");

    models::set_job_review_notes(&conn, "encrypt_note_1", Some("new note")).expect("update note");

    let row: (String, String, Option<String>, Option<String>) = conn
    .query_row(
      "SELECT review_status, communication_status, last_greeted_at, notes FROM job_review_state WHERE encrypt_job_id = ?1",
      ["encrypt_note_1"],
      |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .expect("query note row");
    assert_eq!(row.0, "ready_to_apply");
    assert_eq!(row.1, "greeted_unread");
    assert_eq!(row.2.as_deref(), Some("2026-06-14T12:34:56Z"));
    assert_eq!(row.3.as_deref(), Some("new note"));

    models::set_job_review_notes(&conn, "encrypt_note_1", None).expect("clear note");
    let notes: Option<String> = conn
        .query_row(
            "SELECT notes FROM job_review_state WHERE encrypt_job_id = ?1",
            ["encrypt_note_1"],
            |row| row.get(0),
        )
        .expect("query cleared note");
    assert!(notes.is_none());
}

#[test]
fn reset_company_review_state_clears_notes() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    models::upsert_company_review_state(&conn, "Risk Co", "manual_not_fit", Some("公司维度不合适"))
        .expect("seed company state");
    models::upsert_company_review_state(&conn, "Risk Co", "pending", None)
        .expect("reset company state");

    let (review_status, notes): (String, Option<String>) = conn
        .query_row(
            "SELECT review_status, notes FROM company_review_state WHERE company_name = ?1",
            ["Risk Co"],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("query company state");

    assert_eq!(review_status, "pending");
    assert!(notes.is_none());
}

#[test]
fn rebuild_company_scores_recomputes_local_batch_cache_from_jobs() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    conn.execute(
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
        jd_text,
        raw_payload_json,
        last_seen_at
      )
      VALUES (
        'job_company_batch',
        'boss',
        'Go 平台工程师',
        'Boss',
        'Risk Batch Co',
        '北京',
        '20-40K',
        '3-5年',
        '本科',
        '该岗位涉及外包交付和客户现场驻场，电话销售勿扰。',
        '{"brand":"Risk Batch Co","risk":"外包驻场"}',
        '2026-06-13T00:00:00Z'
      )
      "#,
        [],
    )
    .expect("seed job");
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
      VALUES ('Risk Batch Co', 99, '[]', '[]', 0.1, 1, '2026-06-13T00:00:00Z')
      "#,
        [],
    )
    .expect("seed stale company score");

    let summary = models::rebuild_company_scores(&conn).expect("rebuild company scores");
    assert_eq!(summary.companies, 1);
    assert_eq!(summary.jobs, 1);

    let (score, risk_flags_json): (f64, String) = conn
        .query_row(
            "SELECT company_score, risk_flags_json FROM company_score WHERE company_name = 'Risk Batch Co'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("query rebuilt score");
    let risk_flags: Vec<String> = serde_json::from_str(&risk_flags_json).expect("parse risk flags");
    assert!(score < 80.0);
    assert!(risk_flags.iter().any(|flag| flag == "outsourcing_risk"));
    assert!(risk_flags.iter().any(|flag| flag == "onsite_risk"));
}

#[test]
fn init_db_seeds_job_source_registry_with_manual_import_adapters() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let mut stmt = conn
        .prepare(
            "SELECT platform, display_name, adapter_kind, enabled FROM job_sources ORDER BY platform ASC",
        )
        .expect("prepare source query");
    let sources = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .expect("query sources")
        .collect::<std::result::Result<Vec<_>, _>>()
        .expect("collect sources");

    assert_eq!(sources.len(), 6);
    assert!(sources
        .iter()
        .any(|(platform, display_name, adapter_kind, enabled)| {
            platform == "boss"
                && display_name == "Boss 直聘"
                && adapter_kind == "boss"
                && *enabled == 1
        }));
    for platform in ["liepin", "linuxdo", "maimai", "v2ex", "zhilian"] {
        assert!(sources
            .iter()
            .any(|(source_platform, _, adapter_kind, enabled)| {
                source_platform == platform && adapter_kind == "manual_import" && *enabled == 1
            }));
    }
    assert_eq!(
        sources
            .iter()
            .filter(|(_, _, _, enabled)| *enabled == 1)
            .count(),
        6
    );
}

#[test]
fn init_db_exposes_supported_job_source_adapter_spec() {
    let specs = models::supported_job_source_adapters();
    let spec = specs
        .iter()
        .find(|spec| spec.platform == "boss")
        .expect("boss source spec");
    assert_eq!(spec.platform, "boss");
    assert_eq!(spec.display_name, "Boss 直聘");
    assert_eq!(spec.adapter_kind, "boss");
    assert!(spec.enabled_by_default);
    assert!(specs.iter().any(|spec| spec.platform == "liepin"
        && spec.adapter_kind == "manual_import"
        && spec.enabled_by_default));
}
