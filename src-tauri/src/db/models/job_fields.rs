use serde_json::Value;

use super::common::json_get_str;

#[derive(Debug, Default)]
pub(super) struct JobFields {
    pub position_name: Option<String>,
    pub boss_name: Option<String>,
    pub boss_active_status: Option<String>,
    pub brand_name: Option<String>,
    pub city_name: Option<String>,
    pub salary_desc: Option<String>,
    pub experience_name: Option<String>,
    pub degree_name: Option<String>,
}

pub(super) fn extract_job_fields_from_list_item(item: &Value) -> JobFields {
    JobFields {
        position_name: json_get_str(item, &["jobName"])
            .or_else(|| json_get_str(item, &["jobInfo", "jobName"]))
            .or_else(|| json_get_str(item, &["positionName"]))
            .or_else(|| json_get_str(item, &["jobInfo", "positionName"]))
            .or_else(|| json_get_str(item, &["positionName"]))
            .map(|value| value.to_string()),
        boss_name: json_get_str(item, &["bossName"])
            .or_else(|| json_get_str(item, &["bossInfo", "name"]))
            .or_else(|| json_get_str(item, &["bossInfo", "bossName"]))
            .or_else(|| json_get_str(item, &["bossName"]))
            .map(|value| value.to_string()),
        boss_active_status: extract_boss_active_status(item),
        brand_name: json_get_str(item, &["brandName"])
            .or_else(|| json_get_str(item, &["brandInfo", "brandName"]))
            .or_else(|| json_get_str(item, &["brandComInfo", "brandName"]))
            .or_else(|| json_get_str(item, &["bossInfo", "brandName"]))
            .or_else(|| json_get_str(item, &["brandName"]))
            .map(|value| value.to_string()),
        city_name: json_get_str(item, &["cityName"])
            .or_else(|| json_get_str(item, &["jobInfo", "cityName"]))
            .or_else(|| json_get_str(item, &["jobInfo", "locationName"]))
            .or_else(|| json_get_str(item, &["locationName"]))
            .or_else(|| json_get_str(item, &["cityName"]))
            .map(|value| value.to_string()),
        salary_desc: json_get_str(item, &["salaryDesc"])
            .or_else(|| json_get_str(item, &["jobInfo", "salaryDesc"]))
            .or_else(|| json_get_str(item, &["salaryDesc"]))
            .map(|value| value.to_string()),
        experience_name: json_get_str(item, &["jobExperience"])
            .or_else(|| json_get_str(item, &["experienceName"]))
            .or_else(|| json_get_str(item, &["jobInfo", "experienceName"]))
            .or_else(|| json_get_str(item, &["jobExperience"]))
            .map(|value| value.to_string()),
        degree_name: json_get_str(item, &["jobDegree"])
            .or_else(|| json_get_str(item, &["degreeName"]))
            .or_else(|| json_get_str(item, &["jobInfo", "degreeName"]))
            .or_else(|| json_get_str(item, &["jobDegree"]))
            .map(|value| value.to_string()),
    }
}

pub(super) fn extract_job_fields_from_detail(zp_data: &Value) -> JobFields {
    JobFields {
        position_name: json_get_str(zp_data, &["jobInfo", "jobName"])
            .or_else(|| json_get_str(zp_data, &["jobName"]))
            .or_else(|| json_get_str(zp_data, &["jobInfo", "positionName"]))
            .or_else(|| json_get_str(zp_data, &["positionName"]))
            .or_else(|| json_get_str(zp_data, &["jobName"]))
            .map(|value| value.to_string()),
        boss_name: json_get_str(zp_data, &["bossInfo", "name"])
            .or_else(|| json_get_str(zp_data, &["bossInfo", "bossName"]))
            .or_else(|| json_get_str(zp_data, &["bossName"]))
            .map(|value| value.to_string()),
        boss_active_status: extract_boss_active_status(zp_data),
        brand_name: json_get_str(zp_data, &["brandComInfo", "brandName"])
            .or_else(|| json_get_str(zp_data, &["brandInfo", "brandName"]))
            .or_else(|| json_get_str(zp_data, &["bossInfo", "brandName"]))
            .or_else(|| json_get_str(zp_data, &["brandName"]))
            .map(|value| value.to_string()),
        city_name: json_get_str(zp_data, &["jobInfo", "locationName"])
            .or_else(|| json_get_str(zp_data, &["jobInfo", "cityName"]))
            .or_else(|| json_get_str(zp_data, &["locationName"]))
            .or_else(|| json_get_str(zp_data, &["cityName"]))
            .map(|value| value.to_string()),
        salary_desc: json_get_str(zp_data, &["jobInfo", "salaryDesc"])
            .or_else(|| json_get_str(zp_data, &["salaryDesc"]))
            .map(|value| value.to_string()),
        experience_name: json_get_str(zp_data, &["jobInfo", "experienceName"])
            .or_else(|| json_get_str(zp_data, &["experienceName"]))
            .or_else(|| json_get_str(zp_data, &["jobExperience"]))
            .map(|value| value.to_string()),
        degree_name: json_get_str(zp_data, &["jobInfo", "degreeName"])
            .or_else(|| json_get_str(zp_data, &["degreeName"]))
            .or_else(|| json_get_str(zp_data, &["jobDegree"]))
            .map(|value| value.to_string()),
    }
}

fn extract_boss_active_status(payload: &Value) -> Option<String> {
    let candidates: &[&[&str]] = &[
        &["bossActiveTimeDesc"],
        &["bossActiveStatus"],
        &["bossActiveDesc"],
        &["activeTimeDesc"],
        &["lastLoginTimeDesc"],
        &["bossOnlineDesc"],
        &["onlineDesc"],
        &["bossOnline"],
        &["online"],
        &["bossInfo", "bossActiveTimeDesc"],
        &["bossInfo", "bossActiveStatus"],
        &["bossInfo", "bossActiveDesc"],
        &["bossInfo", "activeTimeDesc"],
        &["bossInfo", "lastLoginTimeDesc"],
        &["bossInfo", "bossOnlineDesc"],
        &["bossInfo", "onlineDesc"],
        &["bossInfo", "bossOnline"],
        &["bossInfo", "online"],
        &["jobInfo", "bossActiveTimeDesc"],
        &["jobInfo", "bossActiveStatus"],
        &["jobInfo", "bossActiveDesc"],
        &["jobInfo", "activeTimeDesc"],
        &["jobInfo", "lastLoginTimeDesc"],
        &["jobInfo", "bossOnline"],
    ];

    candidates
        .iter()
        .find_map(|path| json_get_text(payload, path))
}

fn json_get_text(value: &Value, path: &[&str]) -> Option<String> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    match cursor {
        Value::String(text) => clean_text(text),
        Value::Bool(true) => Some("在线".to_string()),
        Value::Bool(false) => Some("离线".to_string()),
        Value::Number(number) => clean_text(&number.to_string()),
        _ => None,
    }
}

fn clean_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
