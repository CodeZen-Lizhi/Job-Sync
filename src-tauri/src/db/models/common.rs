use serde_json::Value;
use time::format_description::well_known::Rfc3339;

pub(super) fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc().format(&Rfc3339).unwrap()
}

pub(super) fn json_get_str<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_str()
}

pub(super) fn json_get_text(value: &Value, path: &[&str]) -> Option<String> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    match cursor {
        Value::String(value) => normalize_text(value),
        Value::Number(value) => normalize_text(&value.to_string()),
        Value::Bool(value) => normalize_text(if *value { "true" } else { "false" }),
        _ => None,
    }
}

pub(super) fn normalize_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
