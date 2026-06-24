use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::db::Result;

use super::common::now_rfc3339;

pub(crate) const DEFAULT_FILTER_PROFILE_ID: &str = "default";
const DEFAULT_SOURCE_PLATFORMS: &[&str] = &["boss", "v2ex", "linuxdo"];
const DEFAULT_AI_PREFERRED_TEXT: &str = "优先看 Go / Infra / DevOps / SRE / 平台工程 / AI Infra / 云原生方向。\nJD 里最好能看到真实工程建设、稳定性、自动化、平台化、可观测性、Kubernetes 或云基础设施证据。\n远程、混合办公、技术深度强、业务稳定的岗位可加分。";
const DEFAULT_AI_REJECTED_TEXT: &str = "明显外包、驻场、培训机构、销售导向、纯实施交付、电话销售、低代码搭建、重复客服支持类岗位。\n标题写技术但正文主要是售前销售、客户驻场、人力外派、拉新获客、课程销售、招转培。\n技术栈与目标方向明显无关，或 JD 缺少真实研发/平台工程职责。";
const DEFAULT_AI_RISK_TEXT: &str = "信息太少、职责含糊、公司业务不清楚、薪资/经验/城市描述矛盾时不要直接推荐。\n软排除只有隐约迹象但证据不够时，放入待确认并说明需要人工看的点。";
const DEFAULT_AI_UNCERTAIN_STRATEGY: &str = "pending_confirmation";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterProfile {
    pub id: String,
    pub name: String,
    pub profile_json: Value,
    pub is_default: bool,
    pub updated_at: String,
}

pub(crate) fn default_filter_profile_json() -> Value {
    let mut profile = Map::new();
    profile.insert(
        "aiPreferredText".to_string(),
        Value::String(DEFAULT_AI_PREFERRED_TEXT.to_string()),
    );
    profile.insert(
        "aiRejectedText".to_string(),
        Value::String(DEFAULT_AI_REJECTED_TEXT.to_string()),
    );
    profile.insert(
        "aiRiskText".to_string(),
        Value::String(DEFAULT_AI_RISK_TEXT.to_string()),
    );
    profile.insert(
        "aiUncertainStrategy".to_string(),
        Value::String(DEFAULT_AI_UNCERTAIN_STRATEGY.to_string()),
    );
    profile.insert("mustKeywords".to_string(), Value::Array(vec![]));
    profile.insert(
        "mustNotKeywords".to_string(),
        Value::Array(
            ["外包", "驻场", "培训", "销售", "电话销售"]
                .into_iter()
                .map(|value| Value::String(value.to_string()))
                .collect(),
        ),
    );
    profile.insert("preferenceKeywords".to_string(), Value::Array(vec![]));
    profile.insert("requiredDirections".to_string(), Value::Array(vec![]));
    profile.insert("excludedDirections".to_string(), Value::Array(vec![]));
    profile.insert(
        "preferenceDirections".to_string(),
        Value::Array(
            [
                "Go",
                "Infra",
                "DevOps",
                "SRE",
                "平台工程",
                "AI Infra",
                "AI Agent",
                "云原生",
            ]
            .into_iter()
            .map(|value| Value::String(value.to_string()))
            .collect(),
        ),
    );
    profile.insert("requiredTechTags".to_string(), Value::Array(vec![]));
    profile.insert("excludedTechTags".to_string(), Value::Array(vec![]));
    profile.insert(
        "preferenceTechTags".to_string(),
        Value::Array(
            [
                "Go",
                "Kubernetes",
                "Docker",
                "AWS",
                "Prometheus",
                "Linux",
                "CI/CD",
                "Terraform",
            ]
            .into_iter()
            .map(|value| Value::String(value.to_string()))
            .collect(),
        ),
    );
    profile.insert("requiredWorkModes".to_string(), Value::Array(vec![]));
    profile.insert("excludedWorkModes".to_string(), Value::Array(vec![]));
    profile.insert("preferenceWorkModes".to_string(), Value::Array(vec![]));
    profile.insert("targetCities".to_string(), Value::Array(vec![]));
    profile.insert("excludedCities".to_string(), Value::Array(vec![]));
    profile.insert(
        "sourcePlatforms".to_string(),
        Value::Array(
            DEFAULT_SOURCE_PLATFORMS
                .iter()
                .map(|value| Value::String((*value).to_string()))
                .collect(),
        ),
    );
    profile.insert(
        "communicationStatuses".to_string(),
        Value::Array(
            ["not_contacted", "greeted_unread"]
                .into_iter()
                .map(|value| Value::String(value.to_string()))
                .collect(),
        ),
    );
    profile.insert("minimumSalaryK".to_string(), Value::Null);
    profile.insert("maximumSalaryK".to_string(), Value::Null);
    profile.insert("acceptNegotiableSalary".to_string(), Value::Bool(false));
    profile.insert("recentDays".to_string(), Value::Null);
    profile.insert("minimumExperienceYears".to_string(), Value::Null);
    profile.insert("maximumExperienceYears".to_string(), Value::Null);
    profile.insert("acceptUnknownExperience".to_string(), Value::Bool(true));
    profile.insert("allowedDegrees".to_string(), Value::Array(vec![]));
    profile.insert("excludedDegrees".to_string(), Value::Array(vec![]));
    profile.insert("companyMustKeywords".to_string(), Value::Array(vec![]));
    profile.insert("companyMustNotKeywords".to_string(), Value::Array(vec![]));
    profile.insert(
        "companyPreferenceKeywords".to_string(),
        Value::Array(vec![]),
    );
    profile.insert("companyRequiredScales".to_string(), Value::Array(vec![]));
    profile.insert("companyExcludedScales".to_string(), Value::Array(vec![]));
    profile.insert("companyPreferenceScales".to_string(), Value::Array(vec![]));
    profile.insert(
        "companyRequiredFinancingStages".to_string(),
        Value::Array(vec![]),
    );
    profile.insert(
        "companyExcludedFinancingStages".to_string(),
        Value::Array(vec![]),
    );
    profile.insert(
        "companyPreferenceFinancingStages".to_string(),
        Value::Array(vec![]),
    );
    profile.insert(
        "companyRequiredIndustries".to_string(),
        Value::Array(vec![]),
    );
    profile.insert(
        "companyExcludedIndustries".to_string(),
        Value::Array(vec![]),
    );
    profile.insert(
        "companyPreferenceIndustries".to_string(),
        Value::Array(vec![]),
    );

    let mut score_weights = Map::new();
    score_weights.insert("resume".to_string(), Value::from(0.6));
    score_weights.insert("preference".to_string(), Value::from(0.25));
    score_weights.insert("company".to_string(), Value::from(0.15));
    profile.insert("scoreWeights".to_string(), Value::Object(score_weights));

    Value::Object(profile)
}

pub(crate) fn load_default_filter_profile(conn: &Connection) -> Result<FilterProfile> {
    let found = {
        let mut stmt = conn.prepare(
            r#"
      SELECT id, name, profile_json, is_default, updated_at
      FROM filter_profile
      WHERE is_default = 1
      ORDER BY updated_at DESC
      LIMIT 1
      "#,
        )?;
        stmt.query_row([], map_filter_profile).ok()
    };
    if let Some(profile) = found {
        return maybe_upgrade_default_filter_profile(conn, profile);
    }

    upsert_default_filter_profile(conn, &default_filter_profile_json())?;
    let mut stmt = conn.prepare(
        r#"
    SELECT id, name, profile_json, is_default, updated_at
    FROM filter_profile
    WHERE id = ?1
    "#,
    )?;
    Ok(stmt.query_row(params![DEFAULT_FILTER_PROFILE_ID], map_filter_profile)?)
}

pub(crate) fn list_filter_profiles(conn: &Connection) -> Result<Vec<FilterProfile>> {
    let _ = load_default_filter_profile(conn)?;
    let mut stmt = conn.prepare(
        r#"
    SELECT id, name, profile_json, is_default, updated_at
    FROM filter_profile
    ORDER BY is_default DESC, updated_at DESC, name ASC
    "#,
    )?;
    let profiles = stmt
        .query_map([], map_filter_profile)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(profiles)
}

fn maybe_upgrade_default_filter_profile(
    conn: &Connection,
    mut profile: FilterProfile,
) -> Result<FilterProfile> {
    if let Some(upgraded_json) =
        upgrade_default_filter_profile_json(&profile.id, &profile.profile_json)
    {
        let updated_at = update_filter_profile_json(conn, &profile.id, &upgraded_json)?;
        profile.profile_json = upgraded_json;
        profile.updated_at = updated_at;
    }
    Ok(profile)
}

fn upgrade_default_filter_profile_json(profile_id: &str, profile_json: &Value) -> Option<Value> {
    let defaults = default_filter_profile_json();
    let mut upgraded = profile_json.clone();
    let mut changed = false;

    for key in ["preferenceDirections", "preferenceTechTags"] {
        changed |= fill_missing_or_empty_array(&mut upgraded, &defaults, key);
    }
    for key in [
        "aiPreferredText",
        "aiRejectedText",
        "aiRiskText",
        "aiUncertainStrategy",
    ] {
        changed |= fill_missing_or_empty_string(&mut upgraded, &defaults, key);
    }
    if profile_id == DEFAULT_FILTER_PROFILE_ID {
        changed |= upgrade_legacy_default_source_platforms(&mut upgraded, &defaults);
    }

    if changed {
        Some(upgraded)
    } else {
        None
    }
}

fn upgrade_legacy_default_source_platforms(profile_json: &mut Value, defaults: &Value) -> bool {
    let Some(source_platforms) = profile_json
        .get("sourcePlatforms")
        .and_then(Value::as_array)
    else {
        return fill_missing_or_empty_array(profile_json, defaults, "sourcePlatforms");
    };
    let legacy_boss_only = source_platforms.len() == 1
        && source_platforms
            .first()
            .and_then(Value::as_str)
            .map(|value| value.trim().eq_ignore_ascii_case("boss"))
            .unwrap_or(false);
    if !legacy_boss_only {
        return false;
    }
    let Some(default_value) = defaults.get("sourcePlatforms") else {
        return false;
    };
    let Some(profile_object) = profile_json.as_object_mut() else {
        return false;
    };
    profile_object.insert("sourcePlatforms".to_string(), default_value.clone());
    true
}

fn fill_missing_or_empty_array(profile_json: &mut Value, defaults: &Value, key: &str) -> bool {
    let should_fill = match profile_json.get(key).and_then(Value::as_array) {
        Some(items) => items.is_empty(),
        None => true,
    };
    if !should_fill {
        return false;
    }
    let Some(default_value) = defaults.get(key) else {
        return false;
    };
    let Some(profile_object) = profile_json.as_object_mut() else {
        return false;
    };
    profile_object.insert(key.to_string(), default_value.clone());
    true
}

fn fill_missing_or_empty_string(profile_json: &mut Value, defaults: &Value, key: &str) -> bool {
    let should_fill = match profile_json.get(key).and_then(Value::as_str) {
        Some(value) => value.trim().is_empty(),
        None => true,
    };
    if !should_fill {
        return false;
    }
    let Some(default_value) = defaults.get(key) else {
        return false;
    };
    let Some(profile_object) = profile_json.as_object_mut() else {
        return false;
    };
    profile_object.insert(key.to_string(), default_value.clone());
    true
}

fn update_filter_profile_json(
    conn: &Connection,
    profile_id: &str,
    profile_json: &Value,
) -> Result<String> {
    let updated_at = now_rfc3339();
    let profile_text = serde_json::to_string(profile_json)?;
    conn.execute(
        r#"
    UPDATE filter_profile
    SET profile_json = ?2, updated_at = ?3
    WHERE id = ?1
    "#,
        params![profile_id, profile_text, updated_at],
    )?;
    Ok(updated_at)
}

pub(crate) fn upsert_default_filter_profile(
    conn: &Connection,
    profile_json: &Value,
) -> Result<FilterProfile> {
    upsert_filter_profile(
        conn,
        DEFAULT_FILTER_PROFILE_ID,
        "默认筛选画像",
        profile_json,
        true,
    )
}

pub(crate) fn upsert_filter_profile(
    conn: &Connection,
    profile_id: &str,
    name: &str,
    profile_json: &Value,
    is_default: bool,
) -> Result<FilterProfile> {
    let updated_at = now_rfc3339();
    let profile_text = serde_json::to_string(profile_json)?;
    if is_default {
        conn.execute("UPDATE filter_profile SET is_default = 0", [])?;
    }
    conn.execute(
        r#"
    INSERT INTO filter_profile (id, name, profile_json, is_default, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      profile_json = excluded.profile_json,
      is_default = CASE
        WHEN excluded.is_default = 1 THEN 1
        ELSE filter_profile.is_default
      END,
      updated_at = excluded.updated_at
    "#,
        params![
            profile_id,
            name,
            profile_text,
            if is_default { 1 } else { 0 },
            updated_at
        ],
    )?;
    load_filter_profile(conn, profile_id)
}

pub(crate) fn set_default_filter_profile_id(
    conn: &Connection,
    profile_id: &str,
) -> Result<FilterProfile> {
    let updated_at = now_rfc3339();
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM filter_profile WHERE id = ?1",
        params![profile_id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows.into());
    }
    conn.execute("UPDATE filter_profile SET is_default = 0", [])?;
    conn.execute(
        r#"
    UPDATE filter_profile
    SET is_default = 1, updated_at = ?2
    WHERE id = ?1
    "#,
        params![profile_id, updated_at],
    )?;
    load_default_filter_profile(conn)
}

fn load_filter_profile(conn: &Connection, profile_id: &str) -> Result<FilterProfile> {
    let mut stmt = conn.prepare(
        r#"
    SELECT id, name, profile_json, is_default, updated_at
    FROM filter_profile
    WHERE id = ?1
    "#,
    )?;
    let profile = stmt.query_row(params![profile_id], map_filter_profile)?;
    maybe_upgrade_default_filter_profile(conn, profile)
}

pub(crate) fn upsert_job_filter_result(
    conn: &Connection,
    encrypt_job_id: &str,
    profile_id: &str,
    eligible: bool,
    reason: &Value,
) -> Result<()> {
    let updated_at = now_rfc3339();
    let reason_text = serde_json::to_string(reason)?;
    conn.execute(
        r#"
    INSERT INTO job_filter_result (encrypt_job_id, profile_id, eligible, reason_json, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(encrypt_job_id) DO UPDATE SET
      profile_id = excluded.profile_id,
      eligible = excluded.eligible,
      reason_json = excluded.reason_json,
      updated_at = excluded.updated_at
    "#,
        params![
            encrypt_job_id,
            profile_id,
            if eligible { 1 } else { 0 },
            reason_text,
            updated_at
        ],
    )?;
    Ok(())
}

fn map_filter_profile(row: &rusqlite::Row) -> rusqlite::Result<FilterProfile> {
    let profile_text: String = row.get(2)?;
    let profile_json =
        serde_json::from_str(&profile_text).unwrap_or_else(|_| default_filter_profile_json());
    let is_default_raw: i64 = row.get(3)?;
    Ok(FilterProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        profile_json,
        is_default: is_default_raw != 0,
        updated_at: row.get(4)?,
    })
}
