use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::Result;

use super::common::now_rfc3339;

pub(crate) const DEFAULT_FILTER_PROFILE_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterProfile {
    pub id: String,
    pub name: String,
    pub profile_json: Value,
    pub is_default: bool,
    pub updated_at: String,
}

pub(crate) fn default_filter_profile_json() -> Value {
    json!({
      "mustKeywords": [],
      "mustNotKeywords": ["外包", "驻场", "培训", "销售", "电话销售"],
      "preferenceKeywords": [],
      "requiredDirections": [],
      "excludedDirections": [],
      "preferenceDirections": ["Go", "Infra", "DevOps", "SRE", "平台工程", "AI Infra", "AI Agent", "云原生"],
      "requiredTechTags": [],
      "excludedTechTags": [],
      "preferenceTechTags": ["Go", "Kubernetes", "Docker", "AWS", "Prometheus", "Linux", "CI/CD", "Terraform"],
      "requiredWorkModes": [],
      "excludedWorkModes": [],
      "preferenceWorkModes": [],
      "targetCities": [],
      "excludedCities": [],
      "sourcePlatforms": ["boss"],
      "communicationStatuses": ["not_contacted", "greeted_unread"],
      "minimumSalaryK": null,
      "maximumSalaryK": null,
      "acceptNegotiableSalary": false,
      "recentDays": null,
      "minimumExperienceYears": null,
      "maximumExperienceYears": null,
      "acceptUnknownExperience": true,
      "allowedDegrees": [],
      "excludedDegrees": [],
      "companyMustKeywords": [],
      "companyMustNotKeywords": [],
      "companyPreferenceKeywords": [],
      "companyRequiredScales": [],
      "companyExcludedScales": [],
      "companyPreferenceScales": [],
      "companyRequiredFinancingStages": [],
      "companyExcludedFinancingStages": [],
      "companyPreferenceFinancingStages": [],
      "companyRequiredIndustries": [],
      "companyExcludedIndustries": [],
      "companyPreferenceIndustries": [],
      "scoreWeights": {
        "resume": 0.6,
        "preference": 0.25,
        "company": 0.15
      }
    })
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
    if let Some(upgraded_json) = upgrade_default_filter_profile_json(&profile.profile_json) {
        let updated_at = update_filter_profile_json(conn, &profile.id, &upgraded_json)?;
        profile.profile_json = upgraded_json;
        profile.updated_at = updated_at;
    }
    Ok(profile)
}

fn upgrade_default_filter_profile_json(profile_json: &Value) -> Option<Value> {
    let defaults = default_filter_profile_json();
    let mut upgraded = profile_json.clone();
    let mut changed = false;

    for key in ["preferenceDirections", "preferenceTechTags"] {
        changed |= fill_missing_or_empty_array(&mut upgraded, &defaults, key);
    }

    if changed {
        Some(upgraded)
    } else {
        None
    }
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
