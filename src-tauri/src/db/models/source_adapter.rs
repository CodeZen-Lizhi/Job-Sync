use serde_json::Value;

use super::{
    common::{json_get_str, json_get_text, normalize_text},
    job_fields::JobFields,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct JobSourceAdapterSpec {
    pub platform: &'static str,
    pub display_name: &'static str,
    pub adapter_kind: &'static str,
    pub enabled_by_default: bool,
}

impl JobSourceAdapterSpec {
    pub const fn new(
        platform: &'static str,
        display_name: &'static str,
        adapter_kind: &'static str,
        enabled_by_default: bool,
    ) -> Self {
        Self {
            platform,
            display_name,
            adapter_kind,
            enabled_by_default,
        }
    }
}

pub(super) const SOURCE_PLATFORM_BOSS: &str = "boss";
const SOURCE_ADAPTER_KIND_MANUAL_IMPORT: &str = "manual_import";
const BOSS_SOURCE_ADAPTER_SPEC: JobSourceAdapterSpec =
    JobSourceAdapterSpec::new("boss", "Boss 直聘", "boss", true);
const JOB_SOURCE_ADAPTER_SPECS: [JobSourceAdapterSpec; 6] = [
    BOSS_SOURCE_ADAPTER_SPEC,
    JobSourceAdapterSpec::new("liepin", "猎聘", SOURCE_ADAPTER_KIND_MANUAL_IMPORT, true),
    JobSourceAdapterSpec::new(
        "zhilian",
        "智联招聘",
        SOURCE_ADAPTER_KIND_MANUAL_IMPORT,
        true,
    ),
    JobSourceAdapterSpec::new("maimai", "脉脉", SOURCE_ADAPTER_KIND_MANUAL_IMPORT, true),
    JobSourceAdapterSpec::new("v2ex", "V2EX", SOURCE_ADAPTER_KIND_MANUAL_IMPORT, true),
    JobSourceAdapterSpec::new(
        "linuxdo",
        "LinuxDo",
        SOURCE_ADAPTER_KIND_MANUAL_IMPORT,
        true,
    ),
];

pub(crate) fn supported_job_source_adapters() -> &'static [JobSourceAdapterSpec] {
    &JOB_SOURCE_ADAPTER_SPECS
}

pub(crate) fn is_supported_manual_import_platform(platform: &str) -> bool {
    let platform = normalize_platform(platform);
    JOB_SOURCE_ADAPTER_SPECS.iter().any(|spec| {
        spec.platform == platform && spec.adapter_kind == SOURCE_ADAPTER_KIND_MANUAL_IMPORT
    })
}

#[derive(Debug, Default)]
pub(super) struct NormalizedJobSource {
    pub source_platform: String,
    pub source_url: Option<String>,
    pub dedup_key: String,
    pub jd_text: Option<String>,
    pub raw_payload_json: String,
}

pub(super) fn normalize_boss_list_item(
    encrypt_job_id: &str,
    item: &Value,
    fields: &JobFields,
) -> NormalizedJobSource {
    normalize_boss_payload(encrypt_job_id, item, fields)
}

pub(super) fn normalize_boss_detail(
    encrypt_job_id: &str,
    zp_data: &Value,
    fields: &JobFields,
) -> NormalizedJobSource {
    normalize_boss_payload(encrypt_job_id, zp_data, fields)
}

pub(super) fn normalize_external_source(
    platform: &str,
    payload: &Value,
    fields: &JobFields,
) -> (String, NormalizedJobSource) {
    let platform = normalize_platform(platform);
    let source_url = extract_external_source_url(payload);
    let raw_payload_json = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
    let dedup_key = extract_external_dedup_key(payload)
        .or_else(|| source_url.clone())
        .unwrap_or_else(|| {
            let fallback = build_fields_text(fields).unwrap_or_else(|| raw_payload_json.clone());
            format!("payload:{}", stable_hash_hex(&fallback))
        });
    let dedup_key = normalize_dedup_key(&dedup_key);
    let encrypt_job_id = format!("external:{}:{}", platform, stable_hash_hex(&dedup_key));
    let source = NormalizedJobSource {
        source_platform: platform,
        source_url,
        dedup_key,
        jd_text: extract_external_jd_text(payload).or_else(|| build_fields_text(fields)),
        raw_payload_json,
    };
    (encrypt_job_id, source)
}

fn normalize_boss_payload(
    encrypt_job_id: &str,
    payload: &Value,
    fields: &JobFields,
) -> NormalizedJobSource {
    let mut dedup_key = normalize_dedup_key(
        json_get_str(payload, &["securityId"])
            .or_else(|| json_get_str(payload, &["jobInfo", "securityId"]))
            .or_else(|| json_get_str(payload, &["encryptJobId"]))
            .or_else(|| json_get_str(payload, &["jobInfo", "encryptJobId"]))
            .or_else(|| json_get_str(payload, &["encrypt_job_id"]))
            .or_else(|| json_get_str(payload, &["jobInfo", "encrypt_job_id"]))
            .unwrap_or(encrypt_job_id),
    );
    if dedup_key.is_empty() {
        dedup_key = encrypt_job_id.trim().to_string();
    }
    NormalizedJobSource {
        source_platform: SOURCE_PLATFORM_BOSS.to_string(),
        source_url: Some(build_boss_job_url(&dedup_key)),
        dedup_key,
        jd_text: extract_boss_jd_text(payload).or_else(|| build_fields_text(fields)),
        raw_payload_json: serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string()),
    }
}

fn build_fields_text(fields: &JobFields) -> Option<String> {
    let text = [
        fields.position_name.as_deref(),
        fields.brand_name.as_deref(),
        fields.city_name.as_deref(),
        fields.salary_desc.as_deref(),
        fields.experience_name.as_deref(),
        fields.degree_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn normalize_dedup_key(value: &str) -> String {
    let trimmed = value.trim();
    trimmed.to_string()
}

fn normalize_platform(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn build_boss_job_url(dedup_key: &str) -> String {
    format!("https://www.zhipin.com/job_detail/{dedup_key}.html")
}

fn extract_boss_jd_text(payload: &Value) -> Option<String> {
    [
        json_get_str(payload, &["jobInfo", "postDescription"]),
        json_get_str(payload, &["jobInfo", "jobDescription"]),
        json_get_str(payload, &["jobInfo", "description"]),
        json_get_str(payload, &["postDescription"]),
        json_get_str(payload, &["jobDescription"]),
        json_get_str(payload, &["description"]),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .find(|value| !value.is_empty())
    .map(ToString::to_string)
}

fn extract_external_dedup_key(payload: &Value) -> Option<String> {
    pick_text(
        payload,
        &[
            &["dedup_key"],
            &["dedupKey"],
            &["source_id"],
            &["sourceId"],
            &["encrypt_job_id"],
            &["encryptJobId"],
            &["job_id"],
            &["jobId"],
            &["id"],
            &["securityId"],
            &["jobInfo", "encryptJobId"],
            &["jobInfo", "securityId"],
            &["job", "id"],
        ],
    )
}

fn extract_external_source_url(payload: &Value) -> Option<String> {
    pick_text(
        payload,
        &[
            &["source_url"],
            &["sourceUrl"],
            &["job_url"],
            &["jobUrl"],
            &["url"],
            &["href"],
            &["link"],
            &["permalink"],
            &["jobInfo", "url"],
            &["job", "url"],
        ],
    )
}

fn extract_external_jd_text(payload: &Value) -> Option<String> {
    pick_text(
        payload,
        &[
            &["jd_text"],
            &["jdText"],
            &["job_description"],
            &["jobDescription"],
            &["description"],
            &["content"],
            &["body"],
            &["text"],
            &["jobInfo", "postDescription"],
            &["jobInfo", "jobDescription"],
            &["jobInfo", "description"],
            &["job", "description"],
        ],
    )
}

fn pick_text(payload: &Value, paths: &[&[&str]]) -> Option<String> {
    paths
        .iter()
        .find_map(|path| json_get_text(payload, path))
        .and_then(|value| normalize_text(&value))
}

fn stable_hash_hex(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn job_source_specs_register_boss_and_manual_import_adapters() {
        let specs = supported_job_source_adapters();
        let spec = specs
            .iter()
            .find(|spec| spec.platform == SOURCE_PLATFORM_BOSS)
            .expect("boss source spec");

        assert_eq!(spec.platform, "boss");
        assert_eq!(spec.display_name, "Boss 直聘");
        assert_eq!(spec.adapter_kind, "boss");
        assert!(spec.enabled_by_default);
        assert_eq!(specs.len(), 6);
        for platform in ["liepin", "zhilian", "maimai", "v2ex", "linuxdo"] {
            let manual = specs
                .iter()
                .find(|spec| spec.platform == platform)
                .expect("manual source spec");
            assert_eq!(manual.adapter_kind, SOURCE_ADAPTER_KIND_MANUAL_IMPORT);
            assert!(manual.enabled_by_default);
            assert!(is_supported_manual_import_platform(platform));
        }
    }

    #[test]
    fn normalize_boss_detail_produces_unified_source_fields() {
        let fields = JobFields {
            position_name: Some("Go 平台工程师".to_string()),
            boss_name: Some("Boss 招聘".to_string()),
            brand_name: Some("统一科技".to_string()),
            city_name: Some("北京".to_string()),
            salary_desc: Some("20-40K".to_string()),
            experience_name: Some("3-5 年".to_string()),
            degree_name: Some("本科".to_string()),
        };
        let zp_data = json!({
          "securityId": "sec-123",
          "jobInfo": {
            "postDescription": "负责 Go 平台工程与云原生基础设施",
          },
          "brandInfo": {
            "brandName": "统一科技"
          }
        });

        let source = normalize_boss_detail("encrypt_1", &zp_data, &fields);

        assert_eq!(source.source_platform, SOURCE_PLATFORM_BOSS);
        assert_eq!(
            source.source_url.as_deref(),
            Some("https://www.zhipin.com/job_detail/sec-123.html")
        );
        assert_eq!(source.dedup_key, "sec-123");
        assert_eq!(
            source.jd_text.as_deref(),
            Some("负责 Go 平台工程与云原生基础设施")
        );
        assert!(source
            .raw_payload_json
            .contains("\"securityId\":\"sec-123\""));
    }

    #[test]
    fn normalize_boss_detail_falls_back_to_fields_text_when_jd_missing() {
        let fields = JobFields {
            position_name: Some("Go 平台工程师".to_string()),
            boss_name: Some("Boss 招聘".to_string()),
            brand_name: Some("统一科技".to_string()),
            city_name: Some("北京".to_string()),
            salary_desc: Some("20-40K".to_string()),
            experience_name: Some("3-5 年".to_string()),
            degree_name: Some("本科".to_string()),
        };
        let zp_data = json!({
          "brandInfo": {
            "brandName": "统一科技"
          }
        });

        let source = normalize_boss_detail("encrypt_2", &zp_data, &fields);

        assert_eq!(source.source_platform, SOURCE_PLATFORM_BOSS);
        assert_eq!(source.dedup_key, "encrypt_2");
        assert_eq!(
            source.jd_text.as_deref(),
            Some("Go 平台工程师 统一科技 北京 20-40K 3-5 年 本科")
        );
    }

    #[test]
    fn normalize_boss_detail_reads_nested_job_info_source_ids() {
        let fields = JobFields {
            position_name: Some("Go 平台工程师".to_string()),
            ..JobFields::default()
        };
        let zp_data = json!({
          "jobInfo": {
            "securityId": "nested-sec-123",
            "encryptJobId": "nested-encrypt-123",
            "postDescription": "负责平台工程"
          }
        });

        let source = normalize_boss_detail("fallback_encrypt", &zp_data, &fields);

        assert_eq!(source.dedup_key, "nested-sec-123");
        assert_eq!(
            source.source_url.as_deref(),
            Some("https://www.zhipin.com/job_detail/nested-sec-123.html")
        );
    }

    #[test]
    fn normalize_external_source_maps_generic_manual_import_payload() {
        let fields = JobFields {
            position_name: Some("Rust 后端工程师".to_string()),
            boss_name: Some("李女士".to_string()),
            brand_name: Some("猎聘科技".to_string()),
            city_name: Some("上海".to_string()),
            salary_desc: Some("30-50K".to_string()),
            experience_name: Some("5-10年".to_string()),
            degree_name: Some("本科".to_string()),
        };
        let payload = json!({
          "job_id": "lp-123",
          "job_url": "https://www.liepin.com/job/123.shtml",
          "description": "负责 Rust 平台工程和云原生基础设施"
        });

        let (encrypt_job_id, source) = normalize_external_source("LiePin", &payload, &fields);

        assert!(encrypt_job_id.starts_with("external:liepin:"));
        assert_eq!(source.source_platform, "liepin");
        assert_eq!(source.dedup_key, "lp-123");
        assert_eq!(
            source.source_url.as_deref(),
            Some("https://www.liepin.com/job/123.shtml")
        );
        assert_eq!(
            source.jd_text.as_deref(),
            Some("负责 Rust 平台工程和云原生基础设施")
        );
        assert!(source.raw_payload_json.contains("\"job_id\":\"lp-123\""));
    }

    #[test]
    fn normalize_external_source_falls_back_to_stable_payload_hash() {
        let fields = JobFields {
            position_name: Some("Go SRE 工程师".to_string()),
            brand_name: Some("社区招聘".to_string()),
            ..JobFields::default()
        };
        let payload = json!({
          "title": "Go SRE 工程师",
          "company": "社区招聘"
        });

        let (first_id, first_source) = normalize_external_source("v2ex", &payload, &fields);
        let (second_id, second_source) = normalize_external_source("v2ex", &payload, &fields);

        assert_eq!(first_id, second_id);
        assert_eq!(first_source.dedup_key, second_source.dedup_key);
        assert!(first_source.dedup_key.starts_with("payload:"));
    }
}
