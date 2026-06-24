use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use time::{Date, Month, OffsetDateTime};

use crate::{db, paths};

#[derive(Debug, Serialize)]
pub struct RecomputeFilterProfileResult {
    pub updated: u64,
    pub counts: db::models::BucketCounts,
}

#[derive(Debug, Default)]
struct NormalizedFilterProfile {
    must_keywords: Vec<String>,
    must_not_keywords: Vec<String>,
    preference_keywords: Vec<String>,
    required_directions: Vec<String>,
    excluded_directions: Vec<String>,
    preference_directions: Vec<String>,
    required_tech_tags: Vec<String>,
    excluded_tech_tags: Vec<String>,
    preference_tech_tags: Vec<String>,
    required_work_modes: Vec<String>,
    excluded_work_modes: Vec<String>,
    preference_work_modes: Vec<String>,
    target_cities: Vec<String>,
    excluded_cities: Vec<String>,
    source_platforms: Vec<String>,
    required_boss_active_statuses: Vec<String>,
    excluded_boss_active_statuses: Vec<String>,
    communication_statuses: Vec<String>,
    minimum_salary_k: Option<f64>,
    maximum_salary_k: Option<f64>,
    accept_negotiable_salary: bool,
    recent_days: Option<i64>,
    minimum_experience_years: Option<f64>,
    maximum_experience_years: Option<f64>,
    accept_unknown_experience: bool,
    allowed_degrees: Vec<String>,
    excluded_degrees: Vec<String>,
    company_must_keywords: Vec<String>,
    company_must_not_keywords: Vec<String>,
    company_preference_keywords: Vec<String>,
    company_required_scales: Vec<String>,
    company_excluded_scales: Vec<String>,
    company_preference_scales: Vec<String>,
    company_required_financing_stages: Vec<String>,
    company_excluded_financing_stages: Vec<String>,
    company_preference_financing_stages: Vec<String>,
    company_required_industries: Vec<String>,
    company_excluded_industries: Vec<String>,
    company_preference_industries: Vec<String>,
}

#[derive(Debug, Clone)]
struct SalaryRange {
    min_k: Option<f64>,
    max_k: Option<f64>,
    negotiable: bool,
}

#[derive(Debug, Clone)]
struct ExperienceRange {
    min_years: Option<f64>,
    max_years: Option<f64>,
    unknown: bool,
}

#[derive(Debug, Clone)]
struct BlacklistHit {
    kind: String,
    value: String,
    reason: Option<String>,
}

fn clean_filter_profile_name(name: &str) -> Result<String, String> {
    let cleaned = name.trim();
    if cleaned.is_empty() {
        return Err("筛选画像名称不能为空".to_string());
    }
    Ok(cleaned.chars().take(80).collect())
}

fn clean_filter_profile_id(profile_id: &str) -> Option<String> {
    let cleaned: String = profile_id
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        .take(80)
        .collect();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn new_filter_profile_id() -> String {
    format!(
        "profile-{}",
        OffsetDateTime::now_utc().unix_timestamp_nanos()
    )
}

fn text_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(text)) => text
            .split(['\n', ',', '，'])
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect(),
        Some(Value::Array(items)) => items
            .iter()
            .flat_map(|item| text_list(Some(item)))
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn unique_text_list(items: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        let key = item.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        out.push(item);
    }
    out
}

fn pick_profile_lists(profile: &Value, keys: &[&str]) -> Vec<String> {
    unique_text_list(
        keys.iter()
            .flat_map(|key| text_list(profile.get(*key)))
            .collect(),
    )
}

fn number_value(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
    .filter(|value| value.is_finite() && *value >= 0.0)
}

fn bool_value(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::String(text)) => match text.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "y" | "是" | "接受" => Some(true),
            "false" | "0" | "no" | "n" | "否" | "不接受" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn pick_profile_number(profile: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| number_value(profile.get(*key)))
}

fn pick_profile_bool(profile: &Value, keys: &[&str], default_value: bool) -> bool {
    keys.iter()
        .find_map(|key| bool_value(profile.get(*key)))
        .unwrap_or(default_value)
}

fn normalize_token(value: &str) -> String {
    value.trim().to_lowercase().replace('-', "_")
}

fn normalize_work_mode(value: &str) -> Option<String> {
    let token = normalize_token(value);
    let normalized = match token.as_str() {
        "remote" | "远程" | "远程办公" | "居家" | "居家办公" | "在家办公" => {
            "remote"
        }
        "long_remote" | "长期远程" | "全远程" | "完全远程" | "full_remote" => {
            "long_remote"
        }
        "flex_remote" | "flexible_remote" | "弹性远程" | "可远程" | "部分远程" => {
            "flex_remote"
        }
        "hybrid" | "混合" | "混合办公" | "弹性办公" => "hybrid",
        "office" | "到岗" | "到岗办公" | "线下" | "线下办公" | "坐班" => "office",
        "on_site" | "onsite" | "驻场" | "客户现场" => "on_site",
        "unknown" | "未知" => "unknown",
        _ => return None,
    };
    Some(normalized.to_string())
}

fn normalize_work_modes(items: Vec<String>) -> Vec<String> {
    unique_text_list(
        items
            .into_iter()
            .filter_map(|item| normalize_work_mode(&item))
            .collect(),
    )
}

fn normalize_status(value: &str) -> Option<String> {
    let token = normalize_token(value);
    let normalized = match token.as_str() {
        "not_contacted" | "未打招呼" | "未沟通" => "not_contacted",
        "greeted_unread" | "已打招呼未读" | "未读" => "greeted_unread",
        "read_no_reply" | "已读未回" => "read_no_reply",
        "replied" | "已回复" | "有回复" => "replied",
        "rejected" | "已拒绝" | "拒绝" => "rejected",
        "manual_not_fit" | "手动不合适" | "不合适" => "manual_not_fit",
        _ => return None,
    };
    Some(normalized.to_string())
}

fn normalize_statuses(items: Vec<String>) -> Vec<String> {
    unique_text_list(
        items
            .into_iter()
            .filter_map(|item| normalize_status(&item))
            .collect(),
    )
}

fn normalize_sources(items: Vec<String>) -> Vec<String> {
    unique_text_list(
        items
            .into_iter()
            .map(|item| normalize_token(&item))
            .filter(|item| !item.is_empty())
            .collect(),
    )
}

fn normalize_filter_profile(raw: &Value) -> NormalizedFilterProfile {
    let profile = raw
        .get("profile")
        .filter(|value| value.is_object())
        .unwrap_or(raw);
    NormalizedFilterProfile {
        must_keywords: pick_profile_lists(
            profile,
            &[
                "mustKeywords",
                "must_keywords",
                "requiredKeywords",
                "required_keywords",
                "includeKeywords",
                "include_keywords",
            ],
        ),
        must_not_keywords: pick_profile_lists(
            profile,
            &[
                "mustNotKeywords",
                "must_not_keywords",
                "excludeKeywords",
                "exclude_keywords",
                "blacklistKeywords",
                "blacklist_keywords",
            ],
        ),
        preference_keywords: pick_profile_lists(
            profile,
            &[
                "preferenceKeywords",
                "preference_keywords",
                "preferredKeywords",
                "preferred_keywords",
                "weakPreferenceKeywords",
                "weak_preference_keywords",
            ],
        ),
        required_directions: pick_profile_lists(
            profile,
            &[
                "requiredDirections",
                "required_directions",
                "mustDirections",
                "must_directions",
            ],
        ),
        excluded_directions: pick_profile_lists(
            profile,
            &[
                "excludedDirections",
                "excluded_directions",
                "mustNotDirections",
                "must_not_directions",
            ],
        ),
        preference_directions: pick_profile_lists(
            profile,
            &[
                "preferenceDirections",
                "preference_directions",
                "preferredDirections",
                "preferred_directions",
            ],
        ),
        required_tech_tags: pick_profile_lists(
            profile,
            &[
                "requiredTechTags",
                "required_tech_tags",
                "mustTechTags",
                "must_tech_tags",
            ],
        ),
        excluded_tech_tags: pick_profile_lists(
            profile,
            &[
                "excludedTechTags",
                "excluded_tech_tags",
                "blockedTechTags",
                "blocked_tech_tags",
            ],
        ),
        preference_tech_tags: pick_profile_lists(
            profile,
            &[
                "preferenceTechTags",
                "preference_tech_tags",
                "preferredTechTags",
                "preferred_tech_tags",
            ],
        ),
        required_work_modes: normalize_work_modes(pick_profile_lists(
            profile,
            &[
                "requiredWorkModes",
                "required_work_modes",
                "mustWorkModes",
                "must_work_modes",
            ],
        )),
        excluded_work_modes: normalize_work_modes(pick_profile_lists(
            profile,
            &[
                "excludedWorkModes",
                "excluded_work_modes",
                "mustNotWorkModes",
                "must_not_work_modes",
            ],
        )),
        preference_work_modes: normalize_work_modes(pick_profile_lists(
            profile,
            &[
                "preferenceWorkModes",
                "preference_work_modes",
                "preferredWorkModes",
                "preferred_work_modes",
            ],
        )),
        target_cities: pick_profile_lists(
            profile,
            &[
                "targetCities",
                "target_cities",
                "allowedCities",
                "allowed_cities",
            ],
        ),
        excluded_cities: pick_profile_lists(
            profile,
            &[
                "excludedCities",
                "excluded_cities",
                "blockedCities",
                "blocked_cities",
            ],
        ),
        source_platforms: normalize_sources(pick_profile_lists(
            profile,
            &[
                "sourcePlatforms",
                "source_platforms",
                "allowedSourcePlatforms",
                "allowed_source_platforms",
            ],
        )),
        required_boss_active_statuses: pick_profile_lists(
            profile,
            &[
                "requiredBossActiveStatuses",
                "required_boss_active_statuses",
                "allowedBossActiveStatuses",
                "allowed_boss_active_statuses",
            ],
        ),
        excluded_boss_active_statuses: pick_profile_lists(
            profile,
            &[
                "excludedBossActiveStatuses",
                "excluded_boss_active_statuses",
                "blockedBossActiveStatuses",
                "blocked_boss_active_statuses",
            ],
        ),
        communication_statuses: normalize_statuses(pick_profile_lists(
            profile,
            &[
                "communicationStatuses",
                "communication_statuses",
                "allowedCommunicationStatuses",
                "allowed_communication_statuses",
            ],
        )),
        minimum_salary_k: pick_profile_number(
            profile,
            &[
                "minimumSalaryK",
                "minimum_salary_k",
                "minSalaryK",
                "min_salary_k",
            ],
        ),
        maximum_salary_k: pick_profile_number(
            profile,
            &[
                "maximumSalaryK",
                "maximum_salary_k",
                "maxSalaryK",
                "max_salary_k",
            ],
        ),
        accept_negotiable_salary: pick_profile_bool(
            profile,
            &["acceptNegotiableSalary", "accept_negotiable_salary"],
            false,
        ),
        recent_days: pick_profile_number(
            profile,
            &[
                "recentDays",
                "recent_days",
                "maxJobAgeDays",
                "max_job_age_days",
            ],
        )
        .map(|value| value.round() as i64)
        .filter(|value| *value > 0),
        minimum_experience_years: pick_profile_number(
            profile,
            &[
                "minimumExperienceYears",
                "minimum_experience_years",
                "minExperienceYears",
                "min_experience_years",
            ],
        ),
        maximum_experience_years: pick_profile_number(
            profile,
            &[
                "maximumExperienceYears",
                "maximum_experience_years",
                "maxExperienceYears",
                "max_experience_years",
            ],
        ),
        accept_unknown_experience: pick_profile_bool(
            profile,
            &["acceptUnknownExperience", "accept_unknown_experience"],
            true,
        ),
        allowed_degrees: pick_profile_lists(
            profile,
            &[
                "allowedDegrees",
                "allowed_degrees",
                "requiredDegrees",
                "required_degrees",
            ],
        ),
        excluded_degrees: pick_profile_lists(profile, &["excludedDegrees", "excluded_degrees"]),
        company_must_keywords: pick_profile_lists(
            profile,
            &[
                "companyMustKeywords",
                "company_must_keywords",
                "requiredCompanyKeywords",
                "required_company_keywords",
            ],
        ),
        company_must_not_keywords: pick_profile_lists(
            profile,
            &[
                "companyMustNotKeywords",
                "company_must_not_keywords",
                "excludedCompanyKeywords",
                "excluded_company_keywords",
            ],
        ),
        company_preference_keywords: pick_profile_lists(
            profile,
            &[
                "companyPreferenceKeywords",
                "company_preference_keywords",
                "preferredCompanyKeywords",
                "preferred_company_keywords",
            ],
        ),
        company_required_scales: pick_profile_lists(
            profile,
            &[
                "companyRequiredScales",
                "company_required_scales",
                "requiredCompanyScales",
                "required_company_scales",
            ],
        ),
        company_excluded_scales: pick_profile_lists(
            profile,
            &[
                "companyExcludedScales",
                "company_excluded_scales",
                "excludedCompanyScales",
                "excluded_company_scales",
            ],
        ),
        company_preference_scales: pick_profile_lists(
            profile,
            &[
                "companyPreferenceScales",
                "company_preference_scales",
                "preferredCompanyScales",
                "preferred_company_scales",
            ],
        ),
        company_required_financing_stages: pick_profile_lists(
            profile,
            &[
                "companyRequiredFinancingStages",
                "company_required_financing_stages",
                "requiredCompanyFinancingStages",
                "required_company_financing_stages",
            ],
        ),
        company_excluded_financing_stages: pick_profile_lists(
            profile,
            &[
                "companyExcludedFinancingStages",
                "company_excluded_financing_stages",
                "excludedCompanyFinancingStages",
                "excluded_company_financing_stages",
            ],
        ),
        company_preference_financing_stages: pick_profile_lists(
            profile,
            &[
                "companyPreferenceFinancingStages",
                "company_preference_financing_stages",
                "preferredCompanyFinancingStages",
                "preferred_company_financing_stages",
            ],
        ),
        company_required_industries: pick_profile_lists(
            profile,
            &[
                "companyRequiredIndustries",
                "company_required_industries",
                "requiredCompanyIndustries",
                "required_company_industries",
            ],
        ),
        company_excluded_industries: pick_profile_lists(
            profile,
            &[
                "companyExcludedIndustries",
                "company_excluded_industries",
                "excludedCompanyIndustries",
                "excluded_company_industries",
            ],
        ),
        company_preference_industries: pick_profile_lists(
            profile,
            &[
                "companyPreferenceIndustries",
                "company_preference_industries",
                "preferredCompanyIndustries",
                "preferred_company_industries",
            ],
        ),
    }
}

fn collect_strings(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            let text = text.trim();
            if !text.is_empty() {
                out.push(text.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_strings(item, out);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_strings(item, out);
            }
        }
        _ => {}
    }
}

fn build_search_text(job: &Value, detail: Option<&str>) -> String {
    let mut parts = Vec::new();
    collect_strings(job, &mut parts);
    if let Some(raw_detail) = detail {
        if let Ok(detail_json) = serde_json::from_str::<Value>(raw_detail) {
            collect_strings(&detail_json, &mut parts);
        } else {
            parts.push(raw_detail.to_string());
        }
    }
    parts.join(" ").to_lowercase()
}

fn includes_keyword(search_text: &str, keyword: &str) -> bool {
    search_text.contains(&keyword.to_lowercase())
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

fn push_blocked(
    blocked_by: &mut Vec<Value>,
    rule_type: &str,
    field: &str,
    value: &str,
    reason: String,
) {
    blocked_by.push(json!({
      "rule_type": rule_type,
      "field": field,
      "value": value,
      "reason": reason
    }));
}

fn has_text_detail_evidence(job: &Value, detail: Option<&str>) -> bool {
    let has_jd = job
        .get("jd_text")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let has_detail = detail.map(str::trim).is_some_and(|value| !value.is_empty());
    has_jd || has_detail
}

fn has_raw_payload_evidence(job: &Value) -> bool {
    job.get("raw_payload_json")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| !value.is_empty() && value != "{}" && value != "null")
}

fn rule_type_of(blocked: &Value) -> Option<&str> {
    blocked.get("rule_type").and_then(Value::as_str)
}

fn has_any(items: &[String], rules: &[String]) -> bool {
    rules
        .iter()
        .any(|rule| items.iter().any(|item| item == rule))
}

fn matching_rules<'a>(items: &[String], rules: &'a [String]) -> Vec<&'a str> {
    rules
        .iter()
        .filter(|rule| items.iter().any(|item| item == *rule))
        .map(String::as_str)
        .collect()
}

fn text_matches_rule(value: &str, rule: &str) -> bool {
    let value = value.trim().to_lowercase();
    let rule = rule.trim().to_lowercase();
    !value.is_empty()
        && !rule.is_empty()
        && (value == rule || value.contains(&rule) || rule.contains(&value))
}

fn text_matches_any(value: &str, rules: &[String]) -> bool {
    rules.iter().any(|rule| text_matches_rule(value, rule))
}

fn keyword_hits<'a>(search_text: &str, rules: &'a [String]) -> Vec<&'a str> {
    rules
        .iter()
        .filter(|rule| includes_keyword(search_text, rule))
        .map(String::as_str)
        .collect()
}

fn missing_keywords<'a>(search_text: &str, rules: &'a [String]) -> Vec<&'a str> {
    rules
        .iter()
        .filter(|rule| !includes_keyword(search_text, rule))
        .map(String::as_str)
        .collect()
}

fn append_keyword_preferences(
    matched_preferences: &mut Vec<String>,
    missing_preferences: &mut Vec<String>,
    prefix: &str,
    search_text: &str,
    rules: &[String],
) {
    for rule in rules {
        let label = format!("{prefix}:{rule}");
        if includes_keyword(search_text, rule) {
            matched_preferences.push(label);
        } else {
            missing_preferences.push(label);
        }
    }
}

fn detect_work_modes(search_text: &str) -> Vec<String> {
    let mut modes = Vec::new();
    let mut add = |mode: &str| {
        if !modes.iter().any(|item| item == mode) {
            modes.push(mode.to_string());
        }
    };

    if [
        "长期远程",
        "全远程",
        "完全远程",
        "full remote",
        "full_remote",
    ]
    .iter()
    .any(|item| search_text.contains(item))
    {
        add("long_remote");
        add("remote");
    }
    if [
        "弹性远程",
        "可远程",
        "部分远程",
        "flex remote",
        "flexible remote",
    ]
    .iter()
    .any(|item| search_text.contains(item))
    {
        add("flex_remote");
        add("remote");
    }
    if ["远程", "remote", "居家办公", "在家办公"]
        .iter()
        .any(|item| search_text.contains(item))
    {
        add("remote");
    }
    if ["hybrid", "混合办公", "混合模式", "弹性办公"]
        .iter()
        .any(|item| search_text.contains(item))
    {
        add("hybrid");
    }
    if ["驻场", "客户现场", "onsite", "on-site"]
        .iter()
        .any(|item| search_text.contains(item))
    {
        add("on_site");
    }
    if ["线下办公", "到岗", "到公司", "坐班", "办公室办公"]
        .iter()
        .any(|item| search_text.contains(item))
    {
        add("office");
    }
    if modes.is_empty() {
        modes.push("unknown".to_string());
    }
    modes
}

fn parse_number_sequence(text: &str) -> Vec<f64> {
    let mut numbers = Vec::new();
    let mut buf = String::new();
    for ch in text.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            buf.push(ch);
            continue;
        }
        if !buf.is_empty() {
            if let Ok(value) = buf.parse::<f64>() {
                numbers.push(value);
            }
            buf.clear();
        }
    }
    if !buf.is_empty() {
        if let Ok(value) = buf.parse::<f64>() {
            numbers.push(value);
        }
    }
    numbers
}

fn parse_salary_range(salary_desc: &str) -> SalaryRange {
    let lower = salary_desc.to_lowercase();
    let negotiable = lower.contains("面议") || lower.contains("negotiable");
    if !(lower.contains('k') || lower.contains('千')) {
        return SalaryRange {
            min_k: None,
            max_k: None,
            negotiable,
        };
    }

    let numbers = parse_number_sequence(&lower);

    let min_k = numbers.first().copied();
    let max_k = numbers.get(1).copied().or(min_k);
    SalaryRange {
        min_k,
        max_k,
        negotiable,
    }
}

fn parse_experience_range(experience_name: &str) -> ExperienceRange {
    let lower = experience_name.to_lowercase();
    if lower.trim().is_empty()
        || lower.contains("不限")
        || lower.contains("无经验")
        || lower.contains("应届")
        || lower.contains("在校")
    {
        return ExperienceRange {
            min_years: Some(0.0),
            max_years: None,
            unknown: lower.trim().is_empty(),
        };
    }
    let numbers = parse_number_sequence(&lower);
    let min_years = numbers.first().copied();
    let max_years = numbers.get(1).copied().or(min_years);
    ExperienceRange {
        min_years,
        max_years,
        unknown: min_years.is_none(),
    }
}

fn date_from_prefix(value: &str) -> Option<Date> {
    let prefix = value.get(0..10)?;
    let mut parts = prefix.split('-');
    let year = parts.next()?.parse::<i32>().ok()?;
    let month = parts.next()?.parse::<u8>().ok()?;
    let day = parts.next()?.parse::<u8>().ok()?;
    let month = Month::try_from(month).ok()?;
    Date::from_calendar_date(year, month, day).ok()
}

fn days_since_date(value: &str) -> Option<i64> {
    let date = date_from_prefix(value)?;
    let today = OffsetDateTime::now_utc().date();
    Some((today - date).whole_days())
}

#[cfg(test)]
fn evaluate_filter_profile(
    job: &Value,
    detail: Option<&str>,
    profile: &NormalizedFilterProfile,
) -> (bool, Value) {
    evaluate_filter_profile_with_blacklist(job, detail, profile, &[])
}

fn evaluate_filter_profile_with_blacklist(
    job: &Value,
    detail: Option<&str>,
    profile: &NormalizedFilterProfile,
    blacklist_hits: &[BlacklistHit],
) -> (bool, Value) {
    let search_text = build_search_text(job, detail);
    let mut blocked_by = Vec::new();
    let city_name = string_field(job, "city_name");
    let source_platform = string_field(job, "source_platform");
    let source_platform = if source_platform.is_empty() {
        "boss".to_string()
    } else {
        normalize_token(&source_platform)
    };
    let communication_status = normalize_status(&string_field(job, "communication_status"))
        .unwrap_or_else(|| "not_contacted".to_string());
    let review_status = normalize_token(&string_field(job, "review_status"));
    let review_status = if review_status.is_empty() {
        "pending".to_string()
    } else {
        review_status
    };
    let company_review_status = normalize_token(&string_field(job, "company_review_status"));
    let company_review_status = if company_review_status.is_empty() {
        "pending".to_string()
    } else {
        company_review_status
    };
    let salary_desc = string_field(job, "salary_desc");
    let experience_name = string_field(job, "experience_name");
    let degree_name = string_field(job, "degree_name");
    let last_seen_at = string_field(job, "last_seen_at");
    let boss_active_status = string_field(job, "boss_active_status");
    let detected_work_modes = detect_work_modes(&search_text);
    let salary_range = parse_salary_range(&salary_desc);
    let experience_range = parse_experience_range(&experience_name);

    for hit in blacklist_hits {
        let (rule_type, field, fallback_reason) = match hit.kind.as_str() {
            db::models::BLACKLIST_KIND_COMPANY => (
                "company_blacklist",
                "brand_name",
                format!("公司命中黑名单：{}", hit.value),
            ),
            db::models::BLACKLIST_KIND_JOB => (
                "job_blacklist",
                "encrypt_job_id",
                format!("职位已加入黑名单：{}", hit.value),
            ),
            db::models::BLACKLIST_KIND_KEYWORD => (
                "keyword_blacklist",
                "local_job",
                format!("职位命中关键词黑名单：{}", hit.value),
            ),
            _ => continue,
        };
        push_blocked(
            &mut blocked_by,
            rule_type,
            field,
            &hit.value,
            hit.reason.clone().unwrap_or(fallback_reason),
        );
    }

    let mut matched_preferences: Vec<String> = profile
        .preference_keywords
        .iter()
        .filter(|keyword| includes_keyword(&search_text, keyword))
        .cloned()
        .collect();
    let mut missing_preferences: Vec<String> = profile
        .preference_keywords
        .iter()
        .filter(|keyword| !includes_keyword(&search_text, keyword))
        .cloned()
        .collect();

    for mode in &profile.preference_work_modes {
        let label = format!("work_mode:{mode}");
        if detected_work_modes.iter().any(|detected| detected == mode) {
            matched_preferences.push(label);
        } else {
            missing_preferences.push(label);
        }
    }
    append_keyword_preferences(
        &mut matched_preferences,
        &mut missing_preferences,
        "direction",
        &search_text,
        &profile.preference_directions,
    );
    append_keyword_preferences(
        &mut matched_preferences,
        &mut missing_preferences,
        "tech",
        &search_text,
        &profile.preference_tech_tags,
    );
    append_keyword_preferences(
        &mut matched_preferences,
        &mut missing_preferences,
        "company",
        &search_text,
        &profile.company_preference_keywords,
    );
    append_keyword_preferences(
        &mut matched_preferences,
        &mut missing_preferences,
        "company_scale",
        &search_text,
        &profile.company_preference_scales,
    );
    append_keyword_preferences(
        &mut matched_preferences,
        &mut missing_preferences,
        "company_financing",
        &search_text,
        &profile.company_preference_financing_stages,
    );
    append_keyword_preferences(
        &mut matched_preferences,
        &mut missing_preferences,
        "company_industry",
        &search_text,
        &profile.company_preference_industries,
    );
    let has_detail_evidence = has_text_detail_evidence(job, detail);
    let has_raw_payload = has_raw_payload_evidence(job);
    let evidence_quality = if has_detail_evidence {
        "strong"
    } else {
        "weak"
    };
    let mut evidence_sources = Vec::new();
    if has_detail_evidence {
        evidence_sources.push("jd_or_detail");
    }
    if has_raw_payload {
        evidence_sources.push("raw_payload");
    }
    if evidence_sources.is_empty() {
        evidence_sources.push("list_fields");
    }
    let eligible = blocked_by.is_empty();
    let bucket = if eligible { "recommended" } else { "filtered" };

    (
        eligible,
        json!({
          "eligible": eligible,
          "bucket": bucket,
          "evidence_quality": evidence_quality,
          "evidence_sources": evidence_sources,
          "pending_by": [],
          "blocked_by": blocked_by,
          "matched_preferences": matched_preferences,
          "missing_preferences": missing_preferences,
              "dimensions": {
                "detected_work_modes": detected_work_modes,
                "city_name": city_name,
                "source_platform": source_platform,
                "boss_active_status": boss_active_status,
                "review_status": review_status,
            "communication_status": communication_status,
            "company_review_status": company_review_status,
            "salary": {
              "raw": salary_desc,
              "min_k": salary_range.min_k,
              "max_k": salary_range.max_k,
              "negotiable": salary_range.negotiable
            },
            "experience": {
              "raw": experience_name,
              "min_years": experience_range.min_years,
              "max_years": experience_range.max_years,
              "unknown": experience_range.unknown
            },
            "degree_name": degree_name,
            "last_seen_at": last_seen_at
          }
        }),
    )
}

fn upsert_filter_profile_result_for_job(
    conn: &Connection,
    profile_id: &str,
    profile: &NormalizedFilterProfile,
    encrypt_job_id: &str,
    job_json: &str,
    detail_json: Option<&str>,
) -> Result<(), String> {
    let job = serde_json::from_str::<Value>(job_json).unwrap_or(Value::Null);
    let blacklist_hits = load_blacklist_hits_for_job(conn, encrypt_job_id, &job, detail_json)?;
    let (eligible, reason) =
        evaluate_filter_profile_with_blacklist(&job, detail_json, profile, &blacklist_hits);
    db::models::upsert_job_filter_result(conn, encrypt_job_id, profile_id, eligible, &reason)
        .map_err(|e| e.to_string())
}

fn load_blacklist_hits_for_job(
    conn: &Connection,
    encrypt_job_id: &str,
    job: &Value,
    detail_json: Option<&str>,
) -> Result<Vec<BlacklistHit>, String> {
    let brand_name = string_field(job, "brand_name");
    let search_text = build_search_text(job, detail_json);
    let mut stmt = conn
        .prepare(
            r#"
      SELECT kind, value, reason
      FROM job_blacklist
      WHERE (kind = 'job' AND value = ?1)
        OR (kind = 'company' AND ?2 != '' AND value = ?2)
        OR (kind = 'keyword' AND trim(value) != '')
      ORDER BY id ASC
      "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![encrypt_job_id, brand_name], |row| {
            Ok(BlacklistHit {
                kind: row.get(0)?,
                value: row.get(1)?,
                reason: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    for row in rows {
        let hit = row.map_err(|e| e.to_string())?;
        if hit.kind == db::models::BLACKLIST_KIND_KEYWORD
            && !includes_keyword(&search_text, &hit.value)
        {
            continue;
        }
        hits.push(hit);
    }
    Ok(hits)
}

pub(crate) fn recompute_default_filter_profile_for_job_on_conn(
    conn: &Connection,
    encrypt_job_id: &str,
) -> Result<bool, String> {
    let profile = db::models::load_default_filter_profile(conn).map_err(|e| e.to_string())?;
    let profile_id = profile.id.clone();
    let profile = normalize_filter_profile(&profile.profile_json);
    let row = conn
        .query_row(
            r#"
      SELECT
        json_object(
          'encrypt_job_id', j.encrypt_job_id,
          'source_platform', COALESCE(NULLIF(j.source_platform, ''), 'boss'),
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
          'last_seen_at', j.last_seen_at,
          'review_status', COALESCE(rs.review_status, 'pending'),
          'communication_status', COALESCE(rs.communication_status, 'not_contacted'),
          'company_review_status', COALESCE(crs.review_status, 'pending')
        ),
        d.zp_data_json
      FROM job j
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      WHERE j.encrypt_job_id = ?1
      "#,
            [encrypt_job_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((job_json, detail_json)) = row else {
        return Ok(false);
    };
    upsert_filter_profile_result_for_job(
        conn,
        &profile_id,
        &profile,
        encrypt_job_id,
        &job_json,
        detail_json.as_deref(),
    )?;
    Ok(true)
}

pub(crate) fn recompute_default_filter_profile_for_company_on_conn(
    conn: &Connection,
    company_name: &str,
) -> Result<u64, String> {
    let job_ids = conn
        .prepare("SELECT encrypt_job_id FROM job WHERE brand_name = ?1 ORDER BY encrypt_job_id ASC")
        .map_err(|e| e.to_string())?
        .query_map([company_name], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut updated = 0;
    for encrypt_job_id in job_ids {
        if recompute_default_filter_profile_for_job_on_conn(conn, &encrypt_job_id)? {
            updated += 1;
        }
    }
    Ok(updated)
}

fn recompute_filter_profile_on_conn(conn: &Connection) -> Result<u64, String> {
    let profile = db::models::load_default_filter_profile(conn).map_err(|e| e.to_string())?;
    let profile_id = profile.id.clone();
    let profile = normalize_filter_profile(&profile.profile_json);
    let mut stmt = conn
        .prepare(
            r#"
      SELECT
        j.encrypt_job_id,
        json_object(
          'encrypt_job_id', j.encrypt_job_id,
          'source_platform', COALESCE(NULLIF(j.source_platform, ''), 'boss'),
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
          'last_seen_at', j.last_seen_at,
          'review_status', COALESCE(rs.review_status, 'pending'),
          'communication_status', COALESCE(rs.communication_status, 'not_contacted'),
          'company_review_status', COALESCE(crs.review_status, 'pending')
        ),
        d.zp_data_json
      FROM job j
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let job_rows: Vec<(String, String, Option<String>)> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let mut updated = 0;
    for (encrypt_job_id, job_json, detail_json) in job_rows {
        upsert_filter_profile_result_for_job(
            conn,
            &profile_id,
            &profile,
            &encrypt_job_id,
            &job_json,
            detail_json.as_deref(),
        )?;
        updated += 1;
    }
    Ok(updated)
}

pub(crate) fn recompute_missing_default_filter_profile_on_conn(
    conn: &Connection,
) -> Result<u64, String> {
    let profile = db::models::load_default_filter_profile(conn).map_err(|e| e.to_string())?;
    let profile_id = profile.id.clone();
    let profile_updated_at = profile.updated_at.clone();
    let profile = normalize_filter_profile(&profile.profile_json);
    let mut stmt = conn
        .prepare(
            r#"
      SELECT
        j.encrypt_job_id,
        json_object(
          'encrypt_job_id', j.encrypt_job_id,
          'source_platform', COALESCE(NULLIF(j.source_platform, ''), 'boss'),
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
          'last_seen_at', j.last_seen_at,
          'review_status', COALESCE(rs.review_status, 'pending'),
          'communication_status', COALESCE(rs.communication_status, 'not_contacted'),
          'company_review_status', COALESCE(crs.review_status, 'pending')
        ),
        d.zp_data_json
      FROM job j
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
      LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
      LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
      WHERE r.encrypt_job_id IS NULL
        OR r.profile_id != ?1
        OR r.updated_at < ?2
      "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![profile_id.as_str(), profile_updated_at.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let job_rows: Vec<(String, String, Option<String>)> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let mut updated = 0;
    for (encrypt_job_id, job_json, detail_json) in job_rows {
        upsert_filter_profile_result_for_job(
            conn,
            &profile_id,
            &profile,
            &encrypt_job_id,
            &job_json,
            detail_json.as_deref(),
        )?;
        updated += 1;
    }
    Ok(updated)
}

pub(crate) fn recompute_default_filter_profile_on_conn(conn: &Connection) -> Result<u64, String> {
    recompute_filter_profile_on_conn(conn)
}

pub(crate) fn count_filter_buckets_on_conn(
    conn: &Connection,
) -> Result<db::models::BucketCounts, String> {
    let sql = r#"
        SELECT
          SUM(CASE
            WHEN r.eligible = 1
             AND COALESCE(json_extract(r.reason_json, '$.bucket'), 'recommended') = 'recommended'
             AND NOT (
               COALESCE(rs.review_status, 'pending') != 'pending'
               OR COALESCE(rs.communication_status, 'not_contacted') != 'not_contacted'
               OR jb.id IS NOT NULL
               OR cb.id IS NOT NULL
               OR COALESCE(crs.review_status, 'pending') != 'pending'
             )
            THEN 1 ELSE 0 END) AS recommended,
          SUM(CASE
            WHEN COALESCE(json_extract(r.reason_json, '$.bucket'), '') = 'pending_confirmation'
            THEN 1 ELSE 0 END) AS pending,
          SUM(CASE
            WHEN (
              r.eligible = 0
              OR jb.id IS NOT NULL
              OR cb.id IS NOT NULL
              OR COALESCE(crs.review_status, 'pending') = 'manual_not_fit'
              OR COALESCE(rs.review_status, 'pending') IN ('ignored', 'applied')
              OR COALESCE(rs.communication_status, 'not_contacted') IN ('read_no_reply', 'rejected', 'manual_not_fit')
            )
            AND COALESCE(json_extract(r.reason_json, '$.bucket'), '') != 'pending_confirmation'
            THEN 1 ELSE 0 END) AS filtered,
          SUM(CASE
            WHEN (
              COALESCE(rs.review_status, 'pending') != 'pending'
              OR COALESCE(rs.communication_status, 'not_contacted') != 'not_contacted'
              OR jb.id IS NOT NULL
              OR cb.id IS NOT NULL
              OR COALESCE(crs.review_status, 'pending') != 'pending'
            )
            THEN 1 ELSE 0 END) AS processed,
          COUNT(j.encrypt_job_id) AS all_jobs
        FROM job j
        LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
        LEFT JOIN job_review_state rs ON rs.encrypt_job_id = j.encrypt_job_id
        LEFT JOIN company_review_state crs ON crs.company_name = j.brand_name
        LEFT JOIN job_blacklist jb ON jb.kind = 'job' AND jb.value = j.encrypt_job_id
        LEFT JOIN job_blacklist cb ON cb.kind = 'company' AND cb.value = j.brand_name
    "#;
    conn.query_row(sql, [], |row| {
        Ok(db::models::BucketCounts {
            recommended: row.get::<_, Option<i64>>(0)?.unwrap_or(0),
            pending: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
            filtered: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
            processed: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            all: row.get::<_, i64>(4)?,
        })
    })
    .map_err(|e| e.to_string())
}

fn set_default_filter_profile_id_on_conn(
    conn: &Connection,
    profile_id: &str,
) -> Result<db::models::FilterProfile, String> {
    let profile =
        db::models::set_default_filter_profile_id(conn, profile_id).map_err(|e| e.to_string())?;
    recompute_default_filter_profile_on_conn(conn)?;
    Ok(profile)
}

#[tauri::command]
pub fn get_default_filter_profile(
    app: tauri::AppHandle,
) -> Result<db::models::FilterProfile, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    db::models::load_default_filter_profile(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_filter_profiles(
    app: tauri::AppHandle,
) -> Result<Vec<db::models::FilterProfile>, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    db::models::list_filter_profiles(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_filter_profile(
    app: tauri::AppHandle,
    id: Option<String>,
    name: String,
    profile: Value,
    is_default: Option<bool>,
) -> Result<db::models::FilterProfile, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    let profile_id = id
        .as_deref()
        .and_then(clean_filter_profile_id)
        .unwrap_or_else(new_filter_profile_id);
    let name = clean_filter_profile_name(&name)?;
    db::models::upsert_filter_profile(
        &conn,
        &profile_id,
        &name,
        &profile,
        is_default.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_default_filter_profile_id(
    app: tauri::AppHandle,
    profile_id: String,
) -> Result<db::models::FilterProfile, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    let Some(profile_id) = clean_filter_profile_id(&profile_id) else {
        return Err("筛选画像 ID 不能为空".to_string());
    };
    set_default_filter_profile_id_on_conn(&conn, &profile_id)
}

#[tauri::command]
pub fn set_default_filter_profile(
    app: tauri::AppHandle,
    profile: Value,
) -> Result<db::models::FilterProfile, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    db::models::upsert_default_filter_profile(&conn, &profile).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recompute_default_filter_profile(
    app: tauri::AppHandle,
) -> Result<RecomputeFilterProfileResult, String> {
    let app_data_dir = paths::resolve_data_dir(&app)?;
    let conn = db::init_db(&app_data_dir).map_err(|e| e.to_string())?;
    let updated = recompute_default_filter_profile_on_conn(&conn)?;
    let counts = count_filter_buckets_on_conn(&conn)?;
    Ok(RecomputeFilterProfileResult { updated, counts })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn evaluate_filter_profile_blocks_required_and_excluded_keywords() {
        let profile = normalize_filter_profile(&json!({
          "mustKeywords": ["Go"],
          "mustNotKeywords": ["外包"],
          "preferenceKeywords": ["Kubernetes"]
        }));
        let job = json!({
          "position_name": "Rust 开发",
          "brand_name": "外包公司"
        });

        let (eligible, reason) = evaluate_filter_profile(&job, None, &profile);

        assert!(eligible);
        assert_eq!(reason["bucket"], json!("recommended"));
        assert_eq!(reason["blocked_by"].as_array().map(Vec::len), Some(0));
        assert_eq!(
            reason["matched_preferences"].as_array().map(Vec::len),
            Some(0)
        );
        assert_eq!(reason["missing_preferences"][0], json!("Kubernetes"));
    }

    #[test]
    fn evaluate_filter_profile_accepts_dimension_rules() {
        let profile = normalize_filter_profile(&json!({
          "requiredDirections": ["云原生"],
          "requiredTechTags": ["Kubernetes"],
          "preferenceTechTags": ["Prometheus"],
          "companyPreferenceKeywords": ["云计算"],
          "companyRequiredScales": ["1000人以上"],
          "companyRequiredFinancingStages": ["B轮"],
          "companyRequiredIndustries": ["云计算"],
          "companyPreferenceIndustries": ["SaaS"],
          "requiredWorkModes": ["remote"],
          "preferenceWorkModes": ["long_remote"],
          "targetCities": ["北京"],
          "sourcePlatforms": ["boss"],
          "communicationStatuses": ["not_contacted"],
          "minimumSalaryK": 25,
          "maximumSalaryK": 60,
          "minimumExperienceYears": 3,
          "maximumExperienceYears": 8,
          "allowedDegrees": ["本科"]
        }));
        let job = json!({
          "source_platform": "boss",
          "position_name": "Go 云原生开发",
          "city_name": "北京",
          "salary_desc": "30-45K·14薪",
          "experience_name": "3-5年",
          "degree_name": "本科",
          "communication_status": "not_contacted",
          "last_seen_at": OffsetDateTime::now_utc().date().to_string(),
          "description": "长期远程 Kubernetes 平台工程"
        });
        let detail = r#"{"brandInfo":{"scaleName":"1000人以上","stageName":"B轮","industryName":"云计算 SaaS"},"jobInfo":{"postDescription":"使用 Prometheus 做可观测性"}}"#;

        let (eligible, reason) = evaluate_filter_profile(&job, Some(detail), &profile);

        assert!(eligible);
        assert_eq!(reason["bucket"], json!("recommended"));
        assert_eq!(reason["evidence_quality"], json!("strong"));
        assert_eq!(reason["blocked_by"].as_array().map(Vec::len), Some(0));
        assert_eq!(
            reason["matched_preferences"][0],
            json!("work_mode:long_remote")
        );
        assert!(reason["matched_preferences"]
            .as_array()
            .expect("matched preferences")
            .iter()
            .any(|item| item.as_str() == Some("tech:Prometheus")));
        assert!(reason["matched_preferences"]
            .as_array()
            .expect("matched preferences")
            .iter()
            .any(|item| item.as_str() == Some("company_industry:SaaS")));
        assert_eq!(reason["dimensions"]["experience"]["min_years"], json!(3.0));
        assert_eq!(reason["dimensions"]["salary"]["min_k"], json!(30.0));
    }

    #[test]
    fn evaluate_filter_profile_keeps_missing_detail_recommended_with_text_rules() {
        let profile = normalize_filter_profile(&json!({
          "mustKeywords": ["Kubernetes"]
        }));
        let job = json!({
          "source_platform": "boss",
          "position_name": "后端开发",
          "brand_name": "Pending Co"
        });

        let (eligible, reason) = evaluate_filter_profile(&job, None, &profile);

        assert!(eligible);
        assert_eq!(reason["bucket"], json!("recommended"));
        assert_eq!(reason["evidence_quality"], json!("weak"));
        assert!(reason["pending_by"]
            .as_array()
            .expect("pending reasons")
            .is_empty());
    }

    #[test]
    fn evaluate_filter_profile_blocks_dimension_rules() {
        let profile = normalize_filter_profile(&json!({
          "requiredDirections": ["Go"],
          "excludedTechTags": ["Java"],
          "companyMustKeywords": ["云计算"],
          "companyMustNotKeywords": ["外包"],
          "companyRequiredScales": ["1000人以上"],
          "companyExcludedFinancingStages": ["未融资"],
          "companyExcludedIndustries": ["外包服务"],
          "requiredWorkModes": ["remote"],
          "excludedCities": ["上海"],
          "sourcePlatforms": ["boss"],
          "communicationStatuses": ["not_contacted"],
          "minimumSalaryK": 30,
          "acceptNegotiableSalary": false,
          "maximumExperienceYears": 5,
          "excludedDegrees": ["硕士"]
        }));
        let job = json!({
          "source_platform": "liepin",
          "position_name": "Java 开发",
          "city_name": "上海",
          "salary_desc": "20-25K",
          "experience_name": "8-10年",
          "degree_name": "硕士",
          "communication_status": "read_no_reply",
          "last_seen_at": "2024-01-01",
          "brand_name": "外包公司",
          "company_scale": "20人以下",
          "financing_stage": "未融资",
          "industry": "外包服务"
        });

        let (eligible, reason) = evaluate_filter_profile(&job, None, &profile);
        let blocked = reason["blocked_by"].as_array().expect("blocked rules");
        let rule_types: Vec<&str> = blocked
            .iter()
            .filter_map(|item| item.get("rule_type").and_then(Value::as_str))
            .collect();

        assert!(eligible);
        assert!(rule_types.is_empty());
        assert_eq!(reason["bucket"], json!("recommended"));
        assert_eq!(reason["dimensions"]["source_platform"], json!("liepin"));
    }

    #[test]
    fn evaluate_filter_profile_keeps_boss_only_source_platform() {
        let profile = normalize_filter_profile(&json!({
          "sourcePlatforms": ["boss"],
          "communicationStatuses": ["not_contacted"]
        }));
        let boss_job = json!({
          "source_platform": "boss",
          "position_name": "Go 开发工程师",
          "communication_status": "not_contacted"
        });
        let liepin_job = json!({
          "source_platform": "liepin",
          "position_name": "Go 开发工程师",
          "communication_status": "not_contacted"
        });

        let (boss_eligible, boss_reason) = evaluate_filter_profile(&boss_job, None, &profile);
        let (liepin_eligible, liepin_reason) = evaluate_filter_profile(&liepin_job, None, &profile);

        assert!(boss_eligible);
        assert!(liepin_eligible);
        assert!(liepin_reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());
        assert_eq!(boss_reason["dimensions"]["source_platform"], json!("boss"));
    }

    #[test]
    fn evaluate_filter_profile_allows_default_collectable_sources() {
        let profile = normalize_filter_profile(&json!({
          "sourcePlatforms": ["boss", "v2ex"],
          "communicationStatuses": ["not_contacted"]
        }));
        let v2ex_job = json!({
          "source_platform": "v2ex",
          "position_name": "Go AI Agent 工程师",
          "communication_status": "not_contacted"
        });

        let (eligible, reason) = evaluate_filter_profile(&v2ex_job, None, &profile);

        assert!(eligible);
        assert!(reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());
        assert_eq!(reason["dimensions"]["source_platform"], json!("v2ex"));
    }

    #[test]
    fn evaluate_filter_profile_blocks_disallowed_communication_status() {
        let profile = normalize_filter_profile(&json!({
          "sourcePlatforms": ["boss"],
          "communicationStatuses": ["not_contacted", "greeted_unread"]
        }));
        let job = json!({
          "source_platform": "boss",
          "position_name": "Go 开发工程师",
          "communication_status": "read_no_reply"
        });

        let (eligible, reason) = evaluate_filter_profile(&job, None, &profile);

        assert!(eligible);
        assert!(reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());
        assert_eq!(
            reason["dimensions"]["communication_status"],
            json!("read_no_reply")
        );
    }

    #[test]
    fn evaluate_filter_profile_blocks_terminal_review_status() {
        let profile = normalize_filter_profile(&json!({
          "sourcePlatforms": ["boss"],
          "communicationStatuses": ["not_contacted", "greeted_unread"]
        }));
        let job = json!({
          "source_platform": "boss",
          "position_name": "Go 开发工程师",
          "review_status": "applied",
          "communication_status": "not_contacted"
        });

        let (eligible, reason) = evaluate_filter_profile(&job, None, &profile);

        assert!(eligible);
        assert!(reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());
        assert_eq!(reason["dimensions"]["review_status"], json!("applied"));
    }

    #[test]
    fn recompute_default_filter_profile_blocks_read_no_reply_by_default() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

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
        VALUES
          ('job_not_contacted', 'boss', 'Go 开发工程师', 'Boss', 'Keep Co', '北京', '20-40K', '3-5年', '本科', '2026-06-13T00:00:00Z'),
          ('job_read_no_reply', 'boss', 'Go 开发工程师', 'Boss', 'Skip Co', '北京', '20-40K', '3-5年', '本科', '2026-06-13T00:00:00Z')
        "#,
        [],
      )
      .expect("seed jobs");
        db::models::upsert_job_review_state(
            &conn,
            "job_read_no_reply",
            Some("pending"),
            Some("read_no_reply"),
            Some("2026-06-12T00:00:00Z"),
            None,
        )
        .expect("seed read no reply state");

        let updated = recompute_filter_profile_on_conn(&conn).expect("recompute profile");
        assert_eq!(updated, 2);

        let keep_eligible: i64 = conn
            .query_row(
                "SELECT eligible FROM job_filter_result WHERE encrypt_job_id = 'job_not_contacted'",
                [],
                |row| row.get(0),
            )
            .expect("query keep filter");
        let blocked_reason: String = conn
      .query_row(
        "SELECT reason_json FROM job_filter_result WHERE encrypt_job_id = 'job_read_no_reply'",
        [],
        |row| row.get(0),
      )
      .expect("query blocked filter");
        let blocked_reason: Value =
            serde_json::from_str(&blocked_reason).expect("blocked reason json");

        assert_eq!(keep_eligible, 1);
        assert_eq!(blocked_reason["eligible"], json!(true));
        assert_eq!(
            blocked_reason["dimensions"]["communication_status"],
            json!("read_no_reply")
        );
        assert!(blocked_reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());
    }

    #[test]
    fn recompute_default_filter_profile_preserves_existing_ai_judgement() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

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
          last_seen_at
        )
        VALUES (
          'job_ai_filtered',
          'v2ex',
          '全栈开发在线接单',
          '',
          '',
          '',
          '',
          '',
          '',
          '2026-06-13T00:00:00Z'
        )
        "#,
            [],
        )
        .expect("seed job");
        db::models::upsert_job_filter_result(
            &conn,
            "job_ai_filtered",
            db::models::DEFAULT_FILTER_PROFILE_ID,
            false,
            &json!({
              "eligible": false,
              "bucket": "filtered",
              "ai_judgement": {
                "status": "rejected",
                "bucket": "filtered",
                "confidence": 0.98,
                "summary": "接单帖，不是招聘岗位",
                "evidence": ["标题写明在线接单"],
                "risks": []
              }
            }),
        )
        .expect("seed ai result");

        let recomputed = recompute_default_filter_profile_for_job_on_conn(&conn, "job_ai_filtered")
            .expect("recompute");

        let row = conn
            .query_row(
                "SELECT eligible, reason_json FROM job_filter_result WHERE encrypt_job_id = 'job_ai_filtered'",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .expect("query filter result");
        let reason: Value = serde_json::from_str(&row.1).expect("reason json");

        assert!(recomputed);
        assert_eq!(row.0, 0);
        assert_eq!(reason["bucket"], json!("filtered"));
        assert_eq!(reason["ai_judgement"]["bucket"], json!("filtered"));
        assert_eq!(
            reason["ai_judgement"]["summary"],
            json!("接单帖，不是招聘岗位")
        );
    }

    #[test]
    fn recompute_default_filter_profile_uses_selected_profile_id_and_rules() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

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
          last_seen_at
        )
        VALUES (
          'job_strategy_switch',
          'boss',
          'Go 开发工程师',
          'Boss',
          'Strategy Co',
          '北京',
          '20-40K',
          '3-5年',
          '本科',
          '2026-06-13T00:00:00Z'
        )
        "#,
            [],
        )
        .expect("seed job");

        db::models::upsert_filter_profile(
            &conn,
            "rust-only",
            "Rust Only",
            &json!({ "mustKeywords": ["Rust"] }),
            true,
        )
        .expect("seed rust profile");

        let updated = recompute_filter_profile_on_conn(&conn).expect("recompute rust profile");
        assert_eq!(updated, 1);
        let (profile_id, eligible): (String, i64) = conn
            .query_row(
                "SELECT profile_id, eligible FROM job_filter_result WHERE encrypt_job_id = 'job_strategy_switch'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query rust result");
        assert_eq!(profile_id, "rust-only");
        assert_eq!(eligible, 1);

        db::models::upsert_filter_profile(
            &conn,
            "go-only",
            "Go Only",
            &json!({ "mustKeywords": ["Go"] }),
            true,
        )
        .expect("seed go profile");

        let updated =
            recompute_missing_default_filter_profile_on_conn(&conn).expect("recompute go profile");
        assert_eq!(updated, 1);
        let (profile_id, eligible): (String, i64) = conn
            .query_row(
                "SELECT profile_id, eligible FROM job_filter_result WHERE encrypt_job_id = 'job_strategy_switch'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query go result");
        assert_eq!(profile_id, "go-only");
        assert_eq!(eligible, 1);
    }

    #[test]
    fn recompute_default_filter_profile_uses_jd_text_and_raw_payload_json() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        conn.execute(
            r#"
        INSERT INTO job (
          encrypt_job_id,
          source_platform,
          raw_payload_json,
          position_name,
          boss_name,
          brand_name,
          city_name,
          salary_desc,
          experience_name,
          degree_name,
          jd_text,
          last_seen_at
        )
        VALUES (
          'v2ex_jd_hit',
          'v2ex',
          '{"post":"团队使用 Kubernetes 和 Rust，不接受外包驻场"}',
          '后端工程师',
          NULL,
          'V2EX Co',
          '远程',
          '30-50K',
          '3-5年',
          '本科',
          '负责 Kubernetes 平台工程和 Rust 服务开发',
          '2026-06-13T00:00:00Z'
        )
        "#,
            [],
        )
        .expect("seed v2ex jd job");

        db::models::upsert_filter_profile(
            &conn,
            "jd-required",
            "JD Required",
            &json!({
              "mustKeywords": ["Kubernetes"],
              "requiredTechTags": ["Rust"]
            }),
            true,
        )
        .expect("seed jd profile");

        let recomputed = recompute_default_filter_profile_for_job_on_conn(&conn, "v2ex_jd_hit")
            .expect("recompute jd job");
        assert!(recomputed);
        let (eligible, reason): (i64, String) = conn
            .query_row(
                "SELECT eligible, reason_json FROM job_filter_result WHERE encrypt_job_id = 'v2ex_jd_hit'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query jd result");
        let reason: Value = serde_json::from_str(&reason).expect("parse reason");

        assert_eq!(eligible, 1);
        assert_eq!(reason["bucket"], json!("recommended"));
        assert_eq!(reason["evidence_quality"], json!("strong"));

        db::models::upsert_filter_profile(
            &conn,
            "raw-blocked",
            "Raw Blocked",
            &json!({
              "mustKeywords": ["Kubernetes"],
              "mustNotKeywords": ["外包驻场"]
            }),
            true,
        )
        .expect("seed raw blocked profile");

        let recomputed =
            recompute_missing_default_filter_profile_on_conn(&conn).expect("recompute raw profile");
        assert_eq!(recomputed, 1);
        let (eligible, reason): (i64, String) = conn
            .query_row(
                "SELECT eligible, reason_json FROM job_filter_result WHERE encrypt_job_id = 'v2ex_jd_hit'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query raw result");
        let reason: Value = serde_json::from_str(&reason).expect("parse raw reason");

        assert_eq!(eligible, 1);
        assert_eq!(reason["bucket"], json!("recommended"));
        assert!(reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());
    }

    #[test]
    fn set_default_filter_profile_id_recomputes_cached_results() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

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
          last_seen_at
        )
        VALUES (
          'job_default_switch',
          'boss',
          'Go SRE 工程师',
          'Boss',
          'Default Switch Co',
          '北京',
          '25-45K',
          '3-5年',
          '本科',
          '2026-06-13T00:00:00Z'
        )
        "#,
            [],
        )
        .expect("seed job");

        db::models::upsert_filter_profile(
            &conn,
            "rust-only",
            "Rust Only",
            &json!({ "mustKeywords": ["Rust"] }),
            true,
        )
        .expect("seed rust profile");
        db::models::upsert_filter_profile(
            &conn,
            "go-only",
            "Go Only",
            &json!({ "mustKeywords": ["Go"] }),
            false,
        )
        .expect("seed go profile");

        let updated = recompute_filter_profile_on_conn(&conn).expect("recompute rust profile");
        assert_eq!(updated, 1);
        let (profile_id, eligible): (String, i64) = conn
            .query_row(
                "SELECT profile_id, eligible FROM job_filter_result WHERE encrypt_job_id = 'job_default_switch'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query rust result");
        assert_eq!(profile_id, "rust-only");
        assert_eq!(eligible, 1);

        let switched = set_default_filter_profile_id_on_conn(&conn, "go-only")
            .expect("switch default profile");
        assert_eq!(switched.id, "go-only");

        let (profile_id, eligible): (String, i64) = conn
            .query_row(
                "SELECT profile_id, eligible FROM job_filter_result WHERE encrypt_job_id = 'job_default_switch'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query go result");
        assert_eq!(profile_id, "go-only");
        assert_eq!(eligible, 1);
    }

    #[test]
    fn recompute_default_filter_profile_for_job_updates_changed_communication_status() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

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
          last_seen_at
        )
        VALUES (
          'job_status_changed',
          'boss',
          'Go 平台工程师',
          'Boss',
          'Status Co',
          '北京',
          '25-45K',
          '3-5年',
          '本科',
          '2026-06-13T00:00:00Z'
        )
        "#,
            [],
        )
        .expect("seed job");

        let recomputed =
            recompute_default_filter_profile_for_job_on_conn(&conn, "job_status_changed")
                .expect("initial recompute");
        assert!(recomputed);
        let initial_eligible: i64 = conn
      .query_row(
        "SELECT eligible FROM job_filter_result WHERE encrypt_job_id = 'job_status_changed'",
        [],
        |row| row.get(0),
      )
      .expect("query initial filter");
        assert_eq!(initial_eligible, 1);

        db::models::upsert_job_review_state(
            &conn,
            "job_status_changed",
            None,
            Some("read_no_reply"),
            Some("2026-06-14T00:00:00Z"),
            None,
        )
        .expect("update communication status");
        let recomputed =
            recompute_default_filter_profile_for_job_on_conn(&conn, "job_status_changed")
                .expect("status recompute");
        assert!(recomputed);

        let blocked_reason: String = conn
      .query_row(
        "SELECT reason_json FROM job_filter_result WHERE encrypt_job_id = 'job_status_changed'",
        [],
        |row| row.get(0),
      )
      .expect("query blocked reason");
        let blocked_reason: Value =
            serde_json::from_str(&blocked_reason).expect("blocked reason json");
        assert_eq!(blocked_reason["eligible"], json!(true));
        assert_eq!(
            blocked_reason["dimensions"]["communication_status"],
            json!("read_no_reply")
        );
        assert!(blocked_reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());

        db::models::upsert_job_review_state(
            &conn,
            "job_status_changed",
            Some("applied"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("update review status");
        let recomputed =
            recompute_default_filter_profile_for_job_on_conn(&conn, "job_status_changed")
                .expect("review status recompute");
        assert!(recomputed);

        let blocked_reason: String = conn
      .query_row(
        "SELECT reason_json FROM job_filter_result WHERE encrypt_job_id = 'job_status_changed'",
        [],
        |row| row.get(0),
      )
      .expect("query review blocked reason");
        let blocked_reason: Value =
            serde_json::from_str(&blocked_reason).expect("review blocked reason json");
        assert_eq!(blocked_reason["eligible"], json!(true));
        assert_eq!(
            blocked_reason["dimensions"]["review_status"],
            json!("applied")
        );
        assert!(blocked_reason["blocked_by"]
            .as_array()
            .expect("blocked rules")
            .is_empty());
    }

    #[test]
    fn recompute_default_filter_profile_for_company_updates_company_manual_not_fit_jobs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

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
        VALUES
          ('job_company_skip_a', 'boss', 'Go 平台工程师', 'Boss', 'Company Risk Co', '北京', '25-45K', '3-5年', '本科', '2026-06-13T00:00:00Z'),
          ('job_company_skip_b', 'boss', 'DevOps 工程师', 'Boss', 'Company Risk Co', '北京', '25-45K', '3-5年', '本科', '2026-06-13T00:00:00Z')
        "#,
        [],
      )
      .expect("seed company jobs");

        let updated =
            recompute_default_filter_profile_for_company_on_conn(&conn, "Company Risk Co")
                .expect("initial company recompute");
        assert_eq!(updated, 2);
        let initial_eligible: i64 = conn
      .query_row(
        "SELECT COUNT(*) FROM job_filter_result WHERE eligible = 1 AND encrypt_job_id IN ('job_company_skip_a', 'job_company_skip_b')",
        [],
        |row| row.get(0),
      )
      .expect("query initial eligible");
        assert_eq!(initial_eligible, 2);

        db::models::upsert_company_review_state(
            &conn,
            "Company Risk Co",
            "manual_not_fit",
            Some("公司维度不合适"),
        )
        .expect("mark company not fit");
        let updated =
            recompute_default_filter_profile_for_company_on_conn(&conn, "Company Risk Co")
                .expect("company state recompute");
        assert_eq!(updated, 2);

        let blocked_count: i64 = conn
            .query_row(
                r#"
        SELECT COUNT(*)
        FROM job_filter_result
        WHERE eligible = 0
          AND encrypt_job_id IN ('job_company_skip_a', 'job_company_skip_b')
          AND reason_json LIKE '%company_review_status%'
          AND reason_json LIKE '%manual_not_fit%'
        "#,
                [],
                |row| row.get(0),
            )
            .expect("query blocked company jobs");
        assert_eq!(blocked_count, 0);
    }

    #[test]
    fn recompute_default_filter_profile_marks_blacklist_hits() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

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
          last_seen_at
        )
        VALUES (
          'job_blacklisted',
          'boss',
          'Go 外包 开发工程师',
          'Boss',
          'Blacklist Co',
          '北京',
          '25-45K',
          '3-5年',
          '本科',
          '2026-06-13T00:00:00Z'
        )
        "#,
            [],
        )
        .expect("seed job");
        db::models::upsert_job_blacklist(
            &conn,
            db::models::BLACKLIST_KIND_COMPANY,
            "Blacklist Co",
            Some("公司维度排除"),
        )
        .expect("seed company blacklist");
        db::models::upsert_job_blacklist(
            &conn,
            db::models::BLACKLIST_KIND_JOB,
            "job_blacklisted",
            Some("职位维度排除"),
        )
        .expect("seed job blacklist");
        db::models::upsert_job_blacklist(
            &conn,
            db::models::BLACKLIST_KIND_KEYWORD,
            "外包",
            Some("关键词维度排除"),
        )
        .expect("seed keyword blacklist");

        let recomputed = recompute_default_filter_profile_for_job_on_conn(&conn, "job_blacklisted")
            .expect("recompute blacklist job");
        assert!(recomputed);

        let blocked_reason: String = conn
      .query_row(
        "SELECT reason_json FROM job_filter_result WHERE encrypt_job_id = 'job_blacklisted'",
        [],
        |row| row.get(0),
      )
      .expect("query blocked reason");
        let blocked_reason: Value =
            serde_json::from_str(&blocked_reason).expect("blocked reason json");
        let blocked = blocked_reason["blocked_by"]
            .as_array()
            .expect("blocked rules");
        let rule_types: Vec<&str> = blocked
            .iter()
            .filter_map(|item| item.get("rule_type").and_then(Value::as_str))
            .collect();

        assert_eq!(blocked_reason["eligible"], json!(false));
        assert!(rule_types.contains(&"company_blacklist"));
        assert!(rule_types.contains(&"job_blacklist"));
        assert!(rule_types.contains(&"keyword_blacklist"));
        assert!(blocked
            .iter()
            .any(|item| item.get("reason").and_then(Value::as_str) == Some("关键词维度排除")));
    }

    #[test]
    fn count_filter_buckets_derives_counts_from_canonical_filter_state() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let app_data_dir = tmp.path().join("app-data");
        let conn = db::init_db(&app_data_dir).expect("init db");

        conn.execute(
            r#"
        INSERT INTO job (
          encrypt_job_id, source_platform, position_name, brand_name, last_seen_at
        )
        VALUES
          ('bucket_recommended', 'boss', 'Go 平台工程师', 'Bucket Co', '2026-06-13T00:00:00Z'),
          ('bucket_pending', 'boss', 'Go 平台工程师', 'Bucket Co', '2026-06-13T00:00:00Z'),
          ('bucket_filtered', 'boss', '外包 Go', 'Bucket Co', '2026-06-13T00:00:00Z'),
          ('bucket_processed', 'boss', 'Go 平台工程师', 'Bucket Co', '2026-06-13T00:00:00Z')
        "#,
            [],
        )
        .expect("seed jobs");
        db::models::upsert_job_filter_result(
            &conn,
            "bucket_recommended",
            db::models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({ "bucket": "recommended", "eligible": true }),
        )
        .expect("recommended result");
        db::models::upsert_job_filter_result(
            &conn,
            "bucket_pending",
            db::models::DEFAULT_FILTER_PROFILE_ID,
            false,
            &json!({ "bucket": "pending_confirmation", "eligible": false }),
        )
        .expect("pending result");
        db::models::upsert_job_filter_result(
            &conn,
            "bucket_filtered",
            db::models::DEFAULT_FILTER_PROFILE_ID,
            false,
            &json!({ "bucket": "filtered", "eligible": false }),
        )
        .expect("filtered result");
        db::models::upsert_job_filter_result(
            &conn,
            "bucket_processed",
            db::models::DEFAULT_FILTER_PROFILE_ID,
            true,
            &json!({ "bucket": "recommended", "eligible": true }),
        )
        .expect("processed result");
        db::models::upsert_job_review_state(
            &conn,
            "bucket_processed",
            Some("ready_to_apply"),
            Some("not_contacted"),
            None,
            None,
        )
        .expect("mark processed");

        let counts = count_filter_buckets_on_conn(&conn).expect("bucket counts");

        assert_eq!(counts.recommended, 1);
        assert_eq!(counts.pending, 1);
        assert_eq!(counts.filtered, 1);
        assert_eq!(counts.processed, 1);
        assert_eq!(counts.all, 4);
    }
}
