use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::db::Result;

use super::{
    common::now_rfc3339, job_list_summary_projection::refresh_job_list_summary_projection,
};

pub(crate) const DEFAULT_FILTER_PROFILE_ID: &str = "default";
const DEFAULT_SOURCE_PLATFORMS: &[&str] =
    &["boss", "liepin", "v2ex", "linuxdo", "zhilian", "maimai"];
const DEFAULT_AI_PREFERRED_TEXT: &str = r#"只推荐真实、当前有效、面向候选人的具体招聘或内推岗位，并且下面所有必须条件要由同一个具体岗位同时满足：
1. 必须是正式招聘或内推中的软件研发岗位，主要职责属于 Go 后端、Java 后端、AI Agent/LLM 应用开发或 AI 工程化研发。正文未标注兼职、项目制或短期合作时，可按常规全职岗位判断，不要求逐字出现“全职”。
2. AI 岗位可以使用 Python，但 Python 必须主要用于 Agent、RAG、模型/API 接入、工作流编排或 AI 应用工程；纯模型训练、算法研究、数据分析不属于目标方向。
3. 必须明确支持全远程、Remote 或居家办公。只要正文没有坐班、到岗、混合办公、偶尔远程或其他附加条件，即可判断满足，不要求逐字出现“长期、无条件”。
4. 多岗位帖子必须能清楚定位到一个独立岗位，并确认技术方向、职责、工作方式、英语和学历等条件都属于该岗位；不得从不同岗位拼接证据。
5. 必须根据具体岗位职责和任职要求判断；仅标题或正文出现 Go、Java、AI、Agent、远程等关键词不能算匹配。"#;
const DEFAULT_AI_REJECTED_TEXT: &str = r#"以下任一条件有明确岗位原文证据时直接过滤，不能被技术方向、公司品牌或其他优点抵消：
1. 要求英语口语、英语交流、英文会议、英文汇报、全英面试，或以英语作为主要工作语言、需要与海外团队持续英文沟通。仅阅读英文技术文档不等同于英语交流要求。
2. 不支持长期无条件全远程或居家办公，包括坐班、必须到岗、线下办公、混合办公、偶尔远程、远程可协商、试用期/磨合期后远程、表现优秀才可远程或优先坐班。
3. 主要职责是前端、全栈、移动端/客户端、Flutter 或 H5 开发。
4. 主要职责是产品经理/产品运营、开发者关系/Developer Advocate、销售/售前/客服或纯实施交付。
5. 主要职责是纯推荐算法、算法研究、数据分析/数据科学、模型训练/微调、CV/NLP 研究等非 AI 应用研发。
6. 以智能合约或 Web3 为核心主职，不能仅因同时出现 AI Agent 或 Go 就放行。
7. 兼职、短期外包、项目制合作、个人寻合作/接项目，而不是正式全职招聘。
8. 核心方向与 Go 后端、Java 后端、AI Agent/LLM 应用开发、AI 工程化研发无关。
9. 明确要求全日制本科。
10. 明显外包、驻场、人力外派、培训/招转培、低代码搭建等非目标工作。
11. 内容不是具体招聘或内推岗位，而是开源项目、产品/工具介绍、AI 模拟面试、课程推广、求职经验、技术分享、自我介绍、求职/项目合作，或没有具体在招岗位和投递方式的资讯/聚合帖。"#;
const DEFAULT_AI_RISK_TEXT: &str = r#"只有在岗位事实不足、语义含糊或信息互相矛盾时才使用不确定策略，并明确说明缺少什么证据：
1. 无法确认是否明确支持全远程、Remote 或居家办公，或远程是否附带到岗/混合/试用期等条件。
2. 无法判断英语只是阅读要求，还是需要口语交流、英文会议或全英面试。
3. 无法确认主要职责是否属于目标研发方向，而不是产品、算法研究、开发者关系、智能合约或其他非目标岗位。
4. 岗位标题相关，但正文没有足够职责、技术栈、招聘主体或投递信息。
5. 一个帖子聚合多个岗位，无法把职责、远程、英语、学历等条件明确归属于同一个具体岗位。
6. 薪资、经验、学历、城市或工作方式描述互相矛盾。
已经有明确排除证据时不要放入待确认，直接过滤。"#;
const DEFAULT_AI_UNCERTAIN_STRATEGY: &str = "pending_confirmation";
const FILTER_BUCKET_RECOMMENDED: &str = "recommended";
const FILTER_BUCKET_PENDING_CONFIRMATION: &str = "pending_confirmation";
const FILTER_BUCKET_FILTERED: &str = "filtered";

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
    let (eligible, reason) =
        merge_existing_ai_filter_result(conn, encrypt_job_id, eligible, reason)?;
    let reason_text = serde_json::to_string(&reason)?;
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
    refresh_job_list_summary_projection(conn, encrypt_job_id)?;
    Ok(())
}

fn merge_existing_ai_filter_result(
    conn: &Connection,
    encrypt_job_id: &str,
    next_eligible: bool,
    next_reason: &Value,
) -> Result<(bool, Value)> {
    if has_ai_judgement(next_reason) {
        return Ok((next_eligible, next_reason.clone()));
    }

    let existing_reason = conn
        .query_row(
            "SELECT reason_json FROM job_filter_result WHERE encrypt_job_id = ?1",
            params![encrypt_job_id],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    let Some(existing_reason) = existing_reason else {
        return Ok((next_eligible, next_reason.clone()));
    };
    if !has_ai_judgement(&existing_reason) {
        return Ok((next_eligible, next_reason.clone()));
    }

    let Some(ai_judgement) = existing_reason.get("ai_judgement") else {
        return Ok((next_eligible, next_reason.clone()));
    };
    let ai_bucket = ai_judgement_bucket(ai_judgement);
    let next_bucket = filter_reason_bucket(next_reason, next_eligible);
    let (merged_eligible, merged_bucket) =
        merge_filter_bucket_with_ai(next_eligible, next_bucket, ai_bucket);

    let mut merged = next_reason.clone();
    if let Some(object) = merged.as_object_mut() {
        object.insert("ai_judgement".to_string(), ai_judgement.clone());
        object.insert("eligible".to_string(), Value::Bool(merged_eligible));
        object.insert(
            "bucket".to_string(),
            Value::String(merged_bucket.to_string()),
        );
    }

    Ok((merged_eligible, merged))
}

fn has_ai_judgement(reason: &Value) -> bool {
    reason
        .get("ai_judgement")
        .and_then(Value::as_object)
        .is_some()
}

fn filter_reason_bucket(reason: &Value, eligible: bool) -> &str {
    reason
        .get("bucket")
        .and_then(Value::as_str)
        .unwrap_or(if eligible {
            FILTER_BUCKET_RECOMMENDED
        } else {
            FILTER_BUCKET_FILTERED
        })
}

fn ai_judgement_bucket(judgement: &Value) -> Option<&str> {
    let bucket = judgement.get("bucket").and_then(Value::as_str);
    if matches!(
        bucket,
        Some(
            FILTER_BUCKET_RECOMMENDED | FILTER_BUCKET_PENDING_CONFIRMATION | FILTER_BUCKET_FILTERED
        )
    ) {
        return bucket;
    }

    match judgement.get("status").and_then(Value::as_str) {
        Some("passed") => Some(FILTER_BUCKET_RECOMMENDED),
        Some("rejected") => Some(FILTER_BUCKET_FILTERED),
        Some("pending_confirmation") | Some("failed") => Some(FILTER_BUCKET_PENDING_CONFIRMATION),
        _ => None,
    }
}

fn merge_filter_bucket_with_ai<'a>(
    next_eligible: bool,
    next_bucket: &'a str,
    ai_bucket: Option<&'a str>,
) -> (bool, &'a str) {
    if !next_eligible || next_bucket == FILTER_BUCKET_FILTERED {
        return (false, FILTER_BUCKET_FILTERED);
    }
    if next_bucket == FILTER_BUCKET_PENDING_CONFIRMATION {
        return (false, FILTER_BUCKET_PENDING_CONFIRMATION);
    }

    match ai_bucket {
        Some(FILTER_BUCKET_FILTERED) => (false, FILTER_BUCKET_FILTERED),
        Some(FILTER_BUCKET_PENDING_CONFIRMATION) => (false, FILTER_BUCKET_PENDING_CONFIRMATION),
        _ => (true, FILTER_BUCKET_RECOMMENDED),
    }
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
