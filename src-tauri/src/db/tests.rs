use super::{connect_db, init_db, init_db_for_app_start, models};
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
    assert!(source_platforms
        .iter()
        .any(|item| item.as_str() == Some("liepin")));
    assert!(source_platforms
        .iter()
        .any(|item| item.as_str() == Some("v2ex")));
    assert!(source_platforms
        .iter()
        .any(|item| item.as_str() == Some("linuxdo")));
    assert!(source_platforms
        .iter()
        .any(|item| item.as_str() == Some("zhilian")));
    assert!(source_platforms
        .iter()
        .any(|item| item.as_str() == Some("maimai")));
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
fn connect_db_opens_runtime_connection_without_running_migrations() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = connect_db(&app_data_dir).expect("connect db");

    let has_job_table = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='job'",
            [],
            |row| row.get::<_, bool>(0),
        )
        .expect("query sqlite master");

    assert!(!has_job_table);
}

#[test]
fn init_db_creates_library_performance_indexes() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    for index_name in [
        "idx_job_last_seen_id",
        "idx_job_brand_name_id",
        "idx_job_source_link_keyword_job",
        "idx_ai_report_latest_resume",
        "idx_job_detail_projection_hash",
        "idx_job_source_payload_hash",
        "idx_job_search_projection_hash",
        "idx_job_list_summary_projection_hash",
    ] {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='index' AND name=?1",
                [index_name],
                |row| row.get(0),
            )
            .expect("query index");
        assert!(exists, "{index_name} should exist");
    }

    let projection_table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='job_detail_projection'",
            [],
            |row| row.get(0),
        )
        .expect("query projection table");
    assert!(projection_table_exists);

    for table_name in [
        "job_source_payload",
        "job_search_projection",
        "job_list_summary_projection",
    ] {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
                [table_name],
                |row| row.get(0),
            )
            .expect("query projection table");
        assert!(exists, "{table_name} should exist");
    }
}

#[test]
fn brand_name_history_query_uses_company_index() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    conn.execute_batch(
        r#"
        INSERT INTO job (encrypt_job_id, brand_name, last_seen_at)
        VALUES
          ('job-a', 'Acme', '2026-07-05T10:00:00Z'),
          ('job-b', 'Acme', '2026-07-05T11:00:00Z'),
          ('job-c', 'Other', '2026-07-05T12:00:00Z');
        "#,
    )
    .expect("seed jobs");

    let mut stmt = conn
        .prepare(
            "EXPLAIN QUERY PLAN
             SELECT encrypt_job_id
             FROM job
             WHERE brand_name = ?1
             ORDER BY encrypt_job_id ASC",
        )
        .expect("prepare explain");
    let plan = stmt
        .query_map(["Acme"], |row| row.get::<_, String>(3))
        .expect("explain rows")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect explain")
        .join("\n");

    assert!(
        plan.contains("idx_job_brand_name_id"),
        "brand_name history query should use idx_job_brand_name_id, got plan:\n{plan}"
    );
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
fn existing_default_filter_profile_with_legacy_boss_only_source_upgrades_automatic_sources() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let old_profile = json!({
      "sourcePlatforms": ["boss"],
      "preferenceDirections": ["Go"],
      "preferenceTechTags": ["Kubernetes"]
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

    let profile = models::load_default_filter_profile(&conn).expect("load upgraded profile");
    assert_eq!(
        json_string_list(&profile.profile_json, "sourcePlatforms"),
        vec![
            "boss".to_string(),
            "liepin".to_string(),
            "v2ex".to_string(),
            "linuxdo".to_string(),
            "zhilian".to_string(),
            "maimai".to_string()
        ]
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
	          "bossActiveTimeDesc": "今日活跃",
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
	        boss_active_status,
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
        boss_active_status,
        source_platform,
        source_url,
        dedup_key,
        jd_text,
        raw_payload_json,
    ): (
        Option<String>,
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
                row.get(7)?,
            ))
        })
        .expect("query row");

    assert_eq!(position_name.as_deref(), Some("Rust 开发"));
    assert_eq!(brand_name.as_deref(), Some("某某科技"));
    assert_eq!(boss_active_status.as_deref(), Some("今日活跃"));
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
          "bossActiveTimeDesc": "刚刚活跃",
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
	        boss_active_status,
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
                    row.get(7)?,
                ))
            },
        )
        .expect("query list item job");

    assert_eq!(row.0.as_deref(), Some("Go SRE 工程师"));
    assert_eq!(row.1.as_deref(), Some("Mock 云科技"));
    assert_eq!(row.2.as_deref(), Some("刚刚活跃"));
    assert_eq!(row.3, "boss");
    assert_eq!(
        row.4.as_deref(),
        Some("https://www.zhipin.com/job_detail/list-sec-123.html")
    );
    assert_eq!(row.5.as_deref(), Some("list-sec-123"));
    assert_eq!(
        row.6.as_deref(),
        Some("Go SRE 工程师 Mock 云科技 深圳 30-55K 3-5年 本科")
    );
    let raw_payload = row.7.as_deref().unwrap_or_default();
    assert!(raw_payload.contains("\"securityId\":\"list-sec-123\""));
    assert!(raw_payload.contains("Kubernetes"));

    let detail_json: String = conn
        .query_row(
            "SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = ?1",
            [encrypt_job_id],
            |row| row.get(0),
        )
        .expect("query list-only detail");
    let detail: Value = serde_json::from_str(&detail_json).expect("parse list-only detail");
    assert_eq!(
        detail.get("detailStatus").and_then(Value::as_str),
        Some("list_only")
    );
    assert_eq!(
        detail
            .get("jobInfo")
            .and_then(|job_info| job_info.get("postDescription"))
            .and_then(Value::as_str),
        Some("Go SRE 工程师 Mock 云科技 深圳 30-55K 3-5年 本科")
    );
    assert_eq!(
        detail
            .get("jobInfo")
            .and_then(|job_info| job_info.get("jobLabels"))
            .and_then(Value::as_array)
            .map(|items| items.len()),
        Some(2)
    );
}

#[test]
fn upsert_job_from_list_item_does_not_overwrite_real_boss_detail_raw() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    let encrypt_job_id = "encrypt_real_detail_1";
    let detail_json = r#"
    {
      "jobInfo": {
        "jobName": "Go 平台工程师",
        "postDescription": "真实详情：负责平台工程和云原生基础设施",
        "salaryDesc": "35-55K",
        "experienceName": "5-10 年",
        "degreeName": "本科",
        "cityName": "上海"
      },
      "brandInfo": {
        "brandName": "真实科技"
      }
    }
  "#;
    models::upsert_job_from_detail(&conn, encrypt_job_id, detail_json).expect("upsert real detail");

    let item = json!({
      "securityId": "real-sec-1",
      "jobName": "Go 平台工程师",
      "brandName": "真实科技",
      "cityName": "上海",
      "salaryDesc": "30-50K"
    });
    models::upsert_job_from_list_item(&conn, encrypt_job_id, &item)
        .expect("upsert list item after real detail");

    let stored_json: String = conn
        .query_row(
            "SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = ?1",
            [encrypt_job_id],
            |row| row.get(0),
        )
        .expect("query stored detail");
    let stored: Value = serde_json::from_str(&stored_json).expect("parse stored detail");
    assert_eq!(stored.get("detailStatus").and_then(Value::as_str), None);
    assert_eq!(
        stored
            .get("jobInfo")
            .and_then(|job_info| job_info.get("postDescription"))
            .and_then(Value::as_str),
        Some("真实详情：负责平台工程和云原生基础设施")
    );
}

#[test]
fn collection_run_and_failure_helpers_persist_summary_records() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    let run_id = models::new_collection_run_id();

    models::create_collection_run(
        &conn,
        &models::NewCollectionRun {
            id: &run_id,
            batch_id: None,
            source_platform: "boss",
            keywords: &["Go".to_string(), "平台工程".to_string()],
            filters: &json!({ "city": ["101020100"] }),
            limits: &json!({ "maxJobs": 20 }),
        },
    )
    .expect("create run");
    models::increment_collection_counter(&conn, &run_id, models::CollectionCounter::Captured, 3)
        .expect("increment captured");
    models::record_collection_failure(
        &conn,
        &models::NewCollectionFailure {
            run_id: Some(&run_id),
            source_platform: Some("boss"),
            event_type: "JOB_LIST_CAPTURED",
            keyword: Some("Go"),
            encrypt_job_id: None,
            reason: "missing stable job id",
            raw_payload: Some(&json!({ "jobName": "No ID" })),
        },
    )
    .expect("record failure");
    models::refresh_collection_run_bucket_counts(
        &conn,
        &run_id,
        models::BucketCounts {
            recommended: 1,
            pending: 1,
            filtered: 1,
            processed: 0,
            all: 3,
        },
    )
    .expect("refresh counts");
    models::record_collection_run_job_inserted(&conn, &run_id, "job-a")
        .expect("record inserted job");
    models::record_collection_run_job_inserted(&conn, &run_id, "job-a")
        .expect("dedupe inserted job");
    models::finish_collection_run(&conn, &run_id, None).expect("finish run");

    let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].status, "finished");
    assert_eq!(runs[0].captured, 3);
    assert_eq!(runs[0].failed, 1);
    assert_eq!(runs[0].recommended, 1);
    assert_eq!(runs[0].pending, 1);
    assert_eq!(runs[0].all_jobs, 3);
    assert_eq!(
        models::list_collection_run_inserted_job_ids(&conn, &run_id)
            .expect("list inserted job ids"),
        vec!["job-a".to_string()]
    );

    let failures = models::list_collection_failures(&conn, Some(5)).expect("list failures");
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].run_id.as_deref(), Some(run_id.as_str()));
    assert_eq!(failures[0].event_type, "JOB_LIST_CAPTURED");
    assert_eq!(failures[0].reason, "missing stable job id");
}

#[test]
fn collection_batch_summary_aggregates_runs_and_uses_final_inserted_job_buckets() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    let batch_id = "batch-test";
    let run_ids = [
        models::new_collection_run_id(),
        models::new_collection_run_id(),
    ];

    for (index, run_id) in run_ids.iter().enumerate() {
        models::create_collection_run(
            &conn,
            &models::NewCollectionRun {
                id: run_id,
                batch_id: Some(batch_id),
                source_platform: if index == 0 { "boss" } else { "v2ex" },
                keywords: &[],
                filters: &json!({}),
                limits: &json!({}),
            },
        )
        .expect("create batched run");
    }

    models::increment_collection_counter(
        &conn,
        &run_ids[0],
        models::CollectionCounter::Captured,
        12,
    )
    .expect("captured");
    models::increment_collection_counter(
        &conn,
        &run_ids[0],
        models::CollectionCounter::Inserted,
        7,
    )
    .expect("inserted");
    models::increment_collection_counter(
        &conn,
        &run_ids[0],
        models::CollectionCounter::Duplicate,
        5,
    )
    .expect("duplicate");
    models::increment_collection_counter(
        &conn,
        &run_ids[1],
        models::CollectionCounter::Captured,
        8,
    )
    .expect("captured");
    models::increment_collection_counter(
        &conn,
        &run_ids[1],
        models::CollectionCounter::Inserted,
        4,
    )
    .expect("inserted");
    models::increment_collection_counter(&conn, &run_ids[1], models::CollectionCounter::Updated, 4)
        .expect("updated");

    for (job_id, run_id, bucket, eligible) in [
        ("job-passed", &run_ids[0], "recommended", 1),
        ("job-not-ai-judged", &run_ids[0], "recommended", 1),
        ("job-rejected", &run_ids[0], "filtered", 0),
        ("job-pending", &run_ids[1], "pending_confirmation", 0),
    ] {
        conn.execute(
            "INSERT INTO job (encrypt_job_id, source_platform) VALUES (?1, 'boss')",
            [job_id],
        )
        .expect("insert job");
        conn.execute(
            "INSERT INTO job_filter_result (encrypt_job_id, profile_id, eligible, reason_json, updated_at) VALUES (?1, 'default', ?2, ?3, 'now')",
            rusqlite::params![
                job_id,
                eligible,
                if job_id == "job-not-ai-judged" {
                    json!({ "bucket": bucket })
                } else {
                    json!({
                        "bucket": bucket,
                        "ai_judgement": {
                            "status": if bucket == "recommended" { "passed" } else { "rejected" }
                        }
                    })
                }
                .to_string()
            ],
        )
        .expect("insert filter result");
        models::record_collection_run_job_inserted(&conn, run_id, job_id)
            .expect("record inserted job");
    }

    let summary = models::get_collection_batch_summary(&conn, batch_id).expect("batch summary");
    assert_eq!(summary.captured, 20);
    assert_eq!(summary.inserted, 11);
    assert_eq!(summary.not_inserted, 9);
    assert_eq!(summary.passed, 1);
}

#[test]
fn init_db_preserves_active_collection_runs() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    let run_id = models::new_collection_run_id();

    models::create_collection_run(
        &conn,
        &models::NewCollectionRun {
            id: &run_id,
            batch_id: None,
            source_platform: "v2ex",
            keywords: &["V2EX".to_string()],
            filters: &json!({}),
            limits: &json!({ "maxJobs": 10 }),
        },
    )
    .expect("create running run");
    drop(conn);

    let conn = init_db(&app_data_dir).expect("re-init db");
    let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs");

    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].id, run_id);
    assert_eq!(runs[0].status, "running");
    assert_eq!(runs[0].error_message, None);
    assert!(runs[0].finished_at.is_none());
}

#[test]
fn finish_collection_run_does_not_overwrite_failed_user_stop() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    let run_id = models::new_collection_run_id();

    models::create_collection_run(
        &conn,
        &models::NewCollectionRun {
            id: &run_id,
            batch_id: None,
            source_platform: "boss",
            keywords: &["Go 远程".to_string()],
            filters: &json!({}),
            limits: &json!({ "maxJobs": 1 }),
        },
    )
    .expect("create running run");
    models::fail_collection_run(&conn, &run_id, "用户已停止采集").expect("fail run");
    models::finish_collection_run(&conn, &run_id, None).expect("finish after fail");

    let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].id, run_id);
    assert_eq!(runs[0].status, "failed");
    assert_eq!(runs[0].error_message.as_deref(), Some("用户已停止采集"));
    assert!(runs[0].finished_at.is_some());
}

#[test]
fn finish_collection_run_does_not_overwrite_failed_worker_error() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    let run_id = models::new_collection_run_id();

    models::create_collection_run(
        &conn,
        &models::NewCollectionRun {
            id: &run_id,
            batch_id: None,
            source_platform: "boss",
            keywords: &["Go 远程".to_string()],
            filters: &json!({}),
            limits: &json!({ "maxJobs": 1 }),
        },
    )
    .expect("create running run");
    models::fail_collection_run(&conn, &run_id, "Boss 未返回有效岗位列表").expect("fail run");
    models::finish_collection_run(&conn, &run_id, None).expect("finish after worker error");

    let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].id, run_id);
    assert_eq!(runs[0].status, "failed");
    assert_eq!(
        runs[0].error_message.as_deref(),
        Some("Boss 未返回有效岗位列表")
    );
    assert!(runs[0].finished_at.is_some());
}

#[test]
fn init_db_for_app_start_marks_stale_running_collection_runs_failed() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    let run_id = models::new_collection_run_id();

    models::create_collection_run(
        &conn,
        &models::NewCollectionRun {
            id: &run_id,
            batch_id: None,
            source_platform: "v2ex",
            keywords: &["V2EX".to_string()],
            filters: &json!({}),
            limits: &json!({ "maxJobs": 10 }),
        },
    )
    .expect("create running run");
    drop(conn);

    let conn = init_db_for_app_start(&app_data_dir).expect("app-start init db");
    let runs = models::list_collection_runs(&conn, Some(1)).expect("list runs");

    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].id, run_id);
    assert_eq!(runs[0].status, "failed");
    assert_eq!(
        runs[0].error_message.as_deref(),
        Some("app restarted before collection finished")
    );
    assert!(runs[0].finished_at.is_some());
}

#[test]
fn upsert_job_from_list_item_with_outcome_classifies_insert_update_duplicate() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    let encrypt_job_id = "outcome_job_1";
    let item = json!({
      "securityId": "outcome_job_1",
      "jobName": "Go 后端",
      "brandName": "Outcome Co",
      "cityName": "上海"
    });

    let inserted = models::upsert_job_from_list_item_with_outcome(&conn, encrypt_job_id, &item)
        .expect("insert outcome");
    let duplicate = models::upsert_job_from_list_item_with_outcome(&conn, encrypt_job_id, &item)
        .expect("duplicate outcome");
    let updated_item = json!({
      "securityId": "outcome_job_1",
      "jobName": "Go 后端",
      "brandName": "Outcome Co",
      "cityName": "上海",
      "salaryDesc": "30-45K"
    });
    let updated =
        models::upsert_job_from_list_item_with_outcome(&conn, encrypt_job_id, &updated_item)
            .expect("update outcome");

    assert_eq!(inserted, models::JobUpsertOutcome::Inserted);
    assert_eq!(duplicate, models::JobUpsertOutcome::Duplicate);
    assert_eq!(updated, models::JobUpsertOutcome::Updated);
}

#[test]
fn upsert_job_from_normalized_writes_v2ex_unified_source_fields() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let input = models::NormalizedJobInput {
        encrypt_job_id: "v2ex:123456".to_string(),
        source_platform: "v2ex".to_string(),
        source_url: Some("https://www.v2ex.com/t/123456".to_string()),
        dedup_key: "123456".to_string(),
        position_name: Some("远程 Go 平台工程师".to_string()),
        boss_name: Some("alice".to_string()),
        brand_name: None,
        city_name: Some("远程".to_string()),
        salary_desc: None,
        experience_name: None,
        degree_name: None,
        jd_text: Some("远程 Go 平台工程师\n负责 Kubernetes 平台建设".to_string()),
        raw_payload: json!({
          "topicId": "123456",
          "title": "远程 Go 平台工程师",
          "contentHtml": "<p>负责 Kubernetes 平台建设</p>",
          "contentText": "负责 Kubernetes 平台建设",
          "classification": { "isJobPosting": true }
        }),
    };

    models::upsert_job_from_normalized(&conn, &input).expect("upsert normalized job");

    let row: (
        String,
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
        jd_text
      FROM job
      WHERE encrypt_job_id = ?1
      "#,
            ["v2ex:123456"],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .expect("query normalized job");

    assert_eq!(row.0, "v2ex");
    assert_eq!(row.1.as_deref(), Some("https://www.v2ex.com/t/123456"));
    assert_eq!(row.2.as_deref(), Some("123456"));
    assert_eq!(row.3.as_deref(), Some("远程 Go 平台工程师"));
    assert_eq!(row.4.as_deref(), Some("alice"));
    assert_eq!(
        row.5.as_deref(),
        Some("远程 Go 平台工程师\n负责 Kubernetes 平台建设")
    );

    let detail_json: String = conn
        .query_row(
            "SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = ?1",
            ["v2ex:123456"],
            |row| row.get(0),
        )
        .expect("query normalized job detail");
    let detail: Value = serde_json::from_str(&detail_json).expect("parse normalized job detail");
    assert_eq!(
        detail
            .get("jobInfo")
            .and_then(|job_info| job_info.get("postDescription"))
            .and_then(Value::as_str),
        Some("<p>负责 Kubernetes 平台建设</p>")
    );
}

#[test]
fn upsert_job_from_normalized_writes_linuxdo_unified_source_fields() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let input = models::NormalizedJobInput {
        encrypt_job_id: "linuxdo:2467891".to_string(),
        source_platform: "linuxdo".to_string(),
        source_url: Some("https://linux.do/t/2467891".to_string()),
        dedup_key: "2467891".to_string(),
        position_name: Some("贵阳某省属国企子公司招聘劳务人员——全栈".to_string()),
        boss_name: Some("neo".to_string()),
        brand_name: Some("LinuxDo".to_string()),
        city_name: Some("贵阳".to_string()),
        salary_desc: Some("面议".to_string()),
        experience_name: None,
        degree_name: None,
        jd_text: Some(
            "贵阳某省属国企子公司招聘劳务人员——全栈\n详情暂未抓取，需打开原帖确认。".to_string(),
        ),
        raw_payload: json!({
          "topicId": "2467891",
          "title": "贵阳某省属国企子公司招聘劳务人员——全栈",
          "url": "https://linux.do/t/2467891",
          "contentText": "详情暂未抓取，需打开原帖确认。",
          "detail_status": "blocked",
          "classification": { "isJobPosting": true }
        }),
    };

    models::upsert_job_from_normalized(&conn, &input).expect("upsert normalized job");

    let row: (
        String,
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
        jd_text
      FROM job
      WHERE encrypt_job_id = ?1
      "#,
            ["linuxdo:2467891"],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .expect("query normalized job");

    assert_eq!(row.0, "linuxdo");
    assert_eq!(row.1.as_deref(), Some("https://linux.do/t/2467891"));
    assert_eq!(row.2.as_deref(), Some("2467891"));
    assert_eq!(
        row.3.as_deref(),
        Some("贵阳某省属国企子公司招聘劳务人员——全栈")
    );
    assert_eq!(row.4.as_deref(), Some("neo"));
    assert_eq!(
        row.5.as_deref(),
        Some("贵阳某省属国企子公司招聘劳务人员——全栈\n详情暂未抓取，需打开原帖确认。")
    );

    let detail_json: String = conn
        .query_row(
            "SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = ?1",
            ["linuxdo:2467891"],
            |row| row.get(0),
        )
        .expect("query normalized job detail");
    let detail: Value = serde_json::from_str(&detail_json).expect("parse normalized job detail");
    assert_eq!(
        detail
            .get("jobInfo")
            .and_then(|job_info| job_info.get("postDescription"))
            .and_then(Value::as_str),
        Some("贵阳某省属国企子公司招聘劳务人员——全栈\n详情暂未抓取，需打开原帖确认。")
    );
}

#[test]
fn upsert_job_from_normalized_writes_zhilian_unified_source_fields() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    let input = models::NormalizedJobInput {
        encrypt_job_id: "zhilian:CCL1405333700J40877845205".to_string(),
        source_platform: "zhilian".to_string(),
        source_url: Some(
            "https://www.zhaopin.com/jobdetail/CCL1405333700J40877845205.htm".to_string(),
        ),
        dedup_key: "CCL1405333700J40877845205".to_string(),
        position_name: Some("java 开发工程师".to_string()),
        boss_name: None,
        brand_name: Some("北京捷科智诚科技有限公司上海分公司".to_string()),
        city_name: Some("北京·顺义·双丰".to_string()),
        salary_desc: Some("1.3-1.7万".to_string()),
        experience_name: Some("3-5年".to_string()),
        degree_name: Some("本科".to_string()),
        jd_text: Some(
            "java 开发工程师\n北京捷科智诚科技有限公司上海分公司\n北京·顺义·双丰\n1.3-1.7万\n3-5年\n本科\n详情暂未抓取，需打开原岗位确认。".to_string(),
        ),
        raw_payload: json!({
          "jobId": "CCL1405333700J40877845205",
          "title": "java 开发工程师",
          "company": "北京捷科智诚科技有限公司上海分公司",
          "city": "北京·顺义·双丰",
          "salary": "1.3-1.7万",
          "experience": "3-5年",
          "degree": "本科",
          "detail_status": "missing",
          "raw": { "source": "pc_search_dom" }
        }),
    };

    models::upsert_job_from_normalized(&conn, &input).expect("upsert zhilian normalized job");

    let row: (
        String,
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
        brand_name,
        city_name,
        salary_desc,
        jd_text
      FROM job
      WHERE encrypt_job_id = ?1
      "#,
            ["zhilian:CCL1405333700J40877845205"],
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
                ))
            },
        )
        .expect("query zhilian normalized job");

    assert_eq!(row.0, "zhilian");
    assert_eq!(
        row.1.as_deref(),
        Some("https://www.zhaopin.com/jobdetail/CCL1405333700J40877845205.htm")
    );
    assert_eq!(row.2.as_deref(), Some("CCL1405333700J40877845205"));
    assert_eq!(row.3.as_deref(), Some("java 开发工程师"));
    assert_eq!(row.4.as_deref(), Some("北京捷科智诚科技有限公司上海分公司"));
    assert_eq!(row.5.as_deref(), Some("北京·顺义·双丰"));
    assert_eq!(row.6.as_deref(), Some("1.3-1.7万"));
    assert!(row
        .7
        .as_deref()
        .unwrap_or("")
        .contains("详情暂未抓取，需打开原岗位确认。"));

    let detail_json: String = conn
        .query_row(
            "SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = ?1",
            ["zhilian:CCL1405333700J40877845205"],
            |row| row.get(0),
        )
        .expect("query zhilian normalized job detail");
    let detail: Value = serde_json::from_str(&detail_json).expect("parse zhilian detail");
    assert_eq!(
        detail.get("detailStatus").and_then(Value::as_str),
        Some("missing")
    );
    assert_eq!(
        detail.get("sourcePlatform").and_then(Value::as_str),
        Some("zhilian")
    );
    assert_eq!(
        detail
            .get("jobInfo")
            .and_then(|job_info| job_info.get("postDescription"))
            .and_then(Value::as_str),
        row.7.as_deref()
    );
    assert_eq!(
        detail
            .get("rawPayload")
            .and_then(|raw| raw.get("detail_status"))
            .and_then(Value::as_str),
        Some("missing")
    );
}

#[test]
fn init_db_backfills_missing_v2ex_job_detail_raw() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    conn.execute(
        r#"
      INSERT INTO job (
        encrypt_job_id,
        source_platform,
        source_url,
        dedup_key,
        position_name,
        boss_name,
        jd_text,
        raw_payload_json,
        last_seen_at
      )
      VALUES (?1, 'v2ex', ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      "#,
        rusqlite::params![
            "v2ex:654321",
            "https://www.v2ex.com/t/654321",
            "654321",
            "招聘 Rust 平台工程师",
            "alice",
            "招聘 Rust 平台工程师\n负责 Rust 平台建设",
            json!({
              "topicId": "654321",
              "title": "招聘 Rust 平台工程师",
              "contentHtml": "<p>负责 Rust 平台建设</p>",
              "contentText": "负责 Rust 平台建设"
            })
            .to_string(),
            "2026-06-20T00:00:00Z",
        ],
    )
    .expect("insert legacy v2ex job");
    drop(conn);

    let conn = init_db(&app_data_dir).expect("re-init db");
    let detail_json: String = conn
        .query_row(
            "SELECT zp_data_json FROM job_detail_raw WHERE encrypt_job_id = ?1",
            ["v2ex:654321"],
            |row| row.get(0),
        )
        .expect("query backfilled v2ex detail");
    let detail: Value = serde_json::from_str(&detail_json).expect("parse backfilled detail");

    assert_eq!(
        detail
            .get("jobInfo")
            .and_then(|job_info| job_info.get("postDescription"))
            .and_then(Value::as_str),
        Some("<p>负责 Rust 平台建设</p>")
    );

    let projection_text: String = conn
        .query_row(
            "SELECT search_text FROM job_detail_projection WHERE encrypt_job_id = ?1",
            ["v2ex:654321"],
            |row| row.get(0),
        )
        .expect("query backfilled projection");
    assert!(projection_text.contains("负责 Rust 平台建设"));
}

#[test]
fn job_detail_projection_backfill_is_idempotent_and_refreshes_changed_raw_detail() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    conn.execute(
        r#"
      INSERT INTO job_detail_raw (encrypt_job_id, zp_data_json, fetched_at)
      VALUES (?1, ?2, '2026-06-20T00:00:00Z')
      "#,
        rusqlite::params![
            "projection_refresh_1",
            r#"{"jobInfo":{"positionName":"投影岗位","postDescription":"OldNeedle"}}"#
        ],
    )
    .expect("insert raw detail");

    let first_changed =
        models::backfill_job_detail_projections(&conn).expect("backfill projection first");
    assert_eq!(first_changed, 1);

    let unchanged =
        models::backfill_job_detail_projections(&conn).expect("backfill projection unchanged");
    assert_eq!(unchanged, 0);

    conn.execute(
        "UPDATE job_detail_raw SET zp_data_json = ?2 WHERE encrypt_job_id = ?1",
        rusqlite::params![
            "projection_refresh_1",
            r#"{"jobInfo":{"positionName":"投影岗位","postDescription":"NewNeedle"}}"#
        ],
    )
    .expect("update raw detail");
    let refreshed =
        models::backfill_job_detail_projections(&conn).expect("backfill projection refreshed");
    assert_eq!(refreshed, 1);

    let projection_text: String = conn
        .query_row(
            "SELECT search_text FROM job_detail_projection WHERE encrypt_job_id = ?1",
            ["projection_refresh_1"],
            |row| row.get(0),
        )
        .expect("query projection text");
    assert!(projection_text.contains("NewNeedle"));
    assert!(!projection_text.contains("OldNeedle"));
}

#[test]
fn job_source_payload_backfill_and_upsert_keep_raw_payload_cold() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    conn.execute(
        r#"
      INSERT INTO job (
        encrypt_job_id,
        source_platform,
        dedup_key,
        position_name,
        raw_payload_json,
        last_seen_at
      )
      VALUES (?1, 'v2ex', ?1, '冷表岗位', ?2, '2026-06-20T00:00:00Z')
      "#,
        rusqlite::params!["source_payload_legacy", r#"{"title":"ColdPayloadNeedle"}"#],
    )
    .expect("seed legacy raw payload");

    let changed = models::backfill_job_source_payloads(&conn).expect("backfill source payload");
    assert_eq!(changed, 1);
    let payload = models::get_job_source_payload(&conn, "source_payload_legacy")
        .expect("get source payload")
        .expect("source payload exists");
    assert!(payload.contains("ColdPayloadNeedle"));

    models::upsert_job_from_normalized(
        &conn,
        &models::NormalizedJobInput {
            encrypt_job_id: "source_payload_new".to_string(),
            source_platform: "linuxdo".to_string(),
            source_url: Some("https://linux.do/t/1".to_string()),
            dedup_key: "linuxdo:1".to_string(),
            position_name: Some("新冷表岗位".to_string()),
            boss_name: None,
            brand_name: Some("冷表公司".to_string()),
            city_name: Some("Remote".to_string()),
            salary_desc: None,
            experience_name: None,
            degree_name: None,
            jd_text: Some("Go 平台".to_string()),
            raw_payload: json!({"contentText":"DualWriteNeedle"}),
        },
    )
    .expect("upsert normalized job");
    let dual_written = models::get_job_source_payload(&conn, "source_payload_new")
        .expect("get dual written payload")
        .expect("dual written source payload exists");
    assert!(dual_written.contains("DualWriteNeedle"));
}

#[test]
fn job_search_projection_backfill_feeds_fts_without_raw_json() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    models::upsert_job_from_normalized(
        &conn,
        &models::NormalizedJobInput {
            encrypt_job_id: "search_projection_1".to_string(),
            source_platform: "v2ex".to_string(),
            source_url: Some("https://v2ex.com/t/1".to_string()),
            dedup_key: "v2ex:1".to_string(),
            position_name: Some("Rust 搜索投影岗位".to_string()),
            boss_name: None,
            brand_name: Some("搜索公司".to_string()),
            city_name: Some("Remote".to_string()),
            salary_desc: Some("20-40K".to_string()),
            experience_name: Some("3-5 年".to_string()),
            degree_name: None,
            jd_text: Some("SearchProjectionNeedle".to_string()),
            raw_payload: json!({"contentText":"RawPayloadNeedle"}),
        },
    )
    .expect("upsert normalized job");

    let search_text: String = conn
        .query_row(
            "SELECT search_text FROM job_search_projection WHERE encrypt_job_id = ?1",
            ["search_projection_1"],
            |row| row.get(0),
        )
        .expect("query search projection");
    assert!(search_text.contains("SearchProjectionNeedle"));

    let fts_text: String = conn
        .query_row(
            "SELECT detail_text FROM job_fts WHERE encrypt_job_id = ?1",
            ["search_projection_1"],
            |row| row.get(0),
        )
        .expect("query fts detail text");
    assert!(fts_text.contains("SearchProjectionNeedle"));
    assert!(!fts_text.contains('{'));
}

#[test]
fn job_projection_backfills_skip_unchanged_rows_and_refresh_stale_hashes() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");

    models::upsert_job_from_normalized(
        &conn,
        &models::NormalizedJobInput {
            encrypt_job_id: "projection_stale_1".to_string(),
            source_platform: "v2ex".to_string(),
            source_url: Some("https://v2ex.com/t/projection-stale".to_string()),
            dedup_key: "v2ex:projection-stale".to_string(),
            position_name: Some("Rust 投影岗位".to_string()),
            boss_name: None,
            brand_name: Some("Projection Co".to_string()),
            city_name: Some("Remote".to_string()),
            salary_desc: Some("20-40K".to_string()),
            experience_name: Some("3-5 年".to_string()),
            degree_name: None,
            jd_text: Some("InitialProjectionNeedle".to_string()),
            raw_payload: json!({"contentText":"InitialSourceNeedle"}),
        },
    )
    .expect("upsert normalized job");

    models::upsert_job_filter_result(
        &conn,
        "projection_stale_1",
        models::DEFAULT_FILTER_PROFILE_ID,
        true,
        &json!({"eligible": true, "matched_preferences": ["Rust"], "missing_preferences": []}),
    )
    .expect("seed filter result");
    models::upsert_company_score(&conn, "Projection Co", 88.0, &[], &[], 0.40, 0)
        .expect("seed company score");

    assert_eq!(
        models::backfill_job_search_projections(&conn).expect("unchanged search backfill"),
        0
    );
    assert_eq!(
        models::backfill_job_list_summary_projections(&conn).expect("unchanged summary backfill"),
        0
    );

    conn.execute(
        "UPDATE job SET jd_text = ?2 WHERE encrypt_job_id = ?1",
        ["projection_stale_1", "UpdatedProjectionNeedle"],
    )
    .expect("stale search source");
    assert_eq!(
        models::backfill_job_search_projections(&conn).expect("refresh stale search projection"),
        1
    );
    assert_eq!(
        models::backfill_job_search_projections(&conn).expect("skip refreshed search projection"),
        0
    );
    let search_text: String = conn
        .query_row(
            "SELECT search_text FROM job_search_projection WHERE encrypt_job_id = ?1",
            ["projection_stale_1"],
            |row| row.get(0),
        )
        .expect("query refreshed search projection");
    assert!(search_text.contains("UpdatedProjectionNeedle"));

    models::upsert_job_filter_result(
        &conn,
        "projection_stale_1",
        models::DEFAULT_FILTER_PROFILE_ID,
        true,
        &json!({"eligible": true, "matched_preferences": ["Rust", "SQLite"], "missing_preferences": []}),
    )
    .expect("refresh summary through normal write");
    assert_eq!(
        models::backfill_job_list_summary_projections(&conn)
            .expect("skip refreshed summary projection"),
        0
    );

    conn.execute(
        "UPDATE job_filter_result SET reason_json = ?2 WHERE encrypt_job_id = ?1",
        [
            "projection_stale_1",
            r#"{"eligible":true,"matched_preferences":["Rust","SQLite","FTS"],"missing_preferences":[]}"#,
        ],
    )
    .expect("stale summary source");
    assert_eq!(
        models::backfill_job_list_summary_projections(&conn)
            .expect("refresh stale summary projection"),
        1
    );
    assert_eq!(
        models::backfill_job_list_summary_projections(&conn)
            .expect("skip refreshed summary projection again"),
        0
    );
    let filter_summary: String = conn
        .query_row(
            "SELECT filter_summary FROM job_list_summary_projection WHERE encrypt_job_id = ?1",
            ["projection_stale_1"],
            |row| row.get(0),
        )
        .expect("query refreshed summary projection");
    assert!(filter_summary.contains("FTS"));

    conn.execute(
        "UPDATE company_score SET confidence = 0.93 WHERE company_name = ?1",
        ["Projection Co"],
    )
    .expect("stale summary confidence source");
    assert_eq!(
        models::backfill_job_list_summary_projections(&conn)
            .expect("refresh summary confidence projection"),
        1
    );
    let score_reason_json: String = conn
        .query_row(
            "SELECT score_reason_json FROM job_list_summary_projection WHERE encrypt_job_id = ?1",
            ["projection_stale_1"],
            |row| row.get(0),
        )
        .expect("query refreshed score reason projection");
    let score_reason: Value = serde_json::from_str(&score_reason_json).expect("score reason json");
    assert_eq!(score_reason["company"]["confidence"].as_f64(), Some(0.93));
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
        "postDescription": "ProjectionOnlyNeedle",
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

    let projection_match_query = "\"ProjectionOnlyNeedle\"";
    let projection_match_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM job_fts WHERE job_fts MATCH ?1",
            [projection_match_query],
            |row| row.get(0),
        )
        .expect("fts projection match");
    assert_eq!(projection_match_count, 1);

    let detail_text: String = conn
        .query_row(
            "SELECT detail_text FROM job_fts WHERE encrypt_job_id = ?1",
            [encrypt_job_id],
            |row| row.get(0),
        )
        .expect("query fts detail text");
    assert!(!detail_text.contains("jobInfo"));
    assert!(!detail_text.contains('{'));
    assert!(detail_text.contains("ProjectionOnlyNeedle"));
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
fn init_db_does_not_recompute_existing_company_score_cache() {
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
        'job_company_cache_init',
        'boss',
        'Go 平台工程师',
        'Boss',
        'Cached Init Co',
        '北京',
        '20-40K',
        '3-5年',
        '本科',
        '该岗位涉及外包交付和客户现场驻场。',
        '{"brand":"Cached Init Co","risk":"外包驻场"}',
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
      VALUES ('Cached Init Co', 99, '[]', '[]', 0.1, 1, '2026-06-13T00:00:00Z')
      "#,
        [],
    )
    .expect("seed existing company score");
    drop(conn);

    let conn = init_db(&app_data_dir).expect("re-init db");
    let (score, risk_flags_json): (f64, String) = conn
        .query_row(
            "SELECT company_score, risk_flags_json FROM company_score WHERE company_name = 'Cached Init Co'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("query company score");

    assert_eq!(score, 99.0);
    assert_eq!(risk_flags_json, "[]");
}

#[test]
fn init_db_seeds_job_source_registry_with_platform_adapters() {
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
    assert!(sources
        .iter()
        .any(|(source_platform, _, adapter_kind, enabled)| {
            source_platform == "maimai" && adapter_kind == "feed" && *enabled == 1
        }));
    assert!(sources
        .iter()
        .any(|(source_platform, _, adapter_kind, enabled)| {
            source_platform == "liepin" && adapter_kind == "liepin" && *enabled == 1
        }));
    assert!(sources
        .iter()
        .any(|(source_platform, _, adapter_kind, enabled)| {
            source_platform == "zhilian" && adapter_kind == "zhilian" && *enabled == 1
        }));
    assert!(sources
        .iter()
        .any(|(source_platform, _, adapter_kind, enabled)| {
            source_platform == "v2ex" && adapter_kind == "feed" && *enabled == 1
        }));
    assert!(sources
        .iter()
        .any(|(source_platform, _, adapter_kind, enabled)| {
            source_platform == "linuxdo" && adapter_kind == "feed" && *enabled == 1
        }));
    assert_eq!(
        sources
            .iter()
            .filter(|(_, _, _, enabled)| *enabled == 1)
            .count(),
        6
    );
}

#[test]
fn init_db_preserves_existing_job_source_enabled_choices() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let app_data_dir = tmp.path().join("app-data");
    let conn = init_db(&app_data_dir).expect("init db");
    conn.execute(
        "UPDATE job_sources SET enabled = 0 WHERE platform = 'boss'",
        [],
    )
    .expect("disable boss source");
    drop(conn);

    let conn = init_db(&app_data_dir).expect("re-init db");
    let enabled: i64 = conn
        .query_row(
            "SELECT enabled FROM job_sources WHERE platform = 'boss'",
            [],
            |row| row.get(0),
        )
        .expect("query boss source");

    assert_eq!(enabled, 0);
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
        && spec.adapter_kind == "liepin"
        && spec.enabled_by_default));
    assert!(specs.iter().any(|spec| spec.platform == "zhilian"
        && spec.adapter_kind == "zhilian"
        && spec.enabled_by_default));
    assert!(specs.iter().any(|spec| spec.platform == "v2ex"
        && spec.adapter_kind == "feed"
        && spec.enabled_by_default));
    assert!(specs.iter().any(|spec| spec.platform == "linuxdo"
        && spec.adapter_kind == "feed"
        && spec.enabled_by_default));
    assert!(specs.iter().any(|spec| spec.platform == "maimai"
        && spec.adapter_kind == "feed"
        && spec.enabled_by_default));
}
