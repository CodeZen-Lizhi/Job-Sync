mod common;
mod company_score;
mod filter_results;
mod job_fields;
mod job_review;
mod jobs;
mod source_adapter;
mod source_links;

pub(crate) use company_score::{
    compute_company_score, rebuild_company_scores, upsert_company_score,
    upsert_company_score_from_source,
};
pub(crate) use filter_results::{
    list_filter_profiles, load_default_filter_profile, set_default_filter_profile_id,
    upsert_default_filter_profile, upsert_filter_profile, upsert_job_filter_result, FilterProfile,
    DEFAULT_FILTER_PROFILE_ID,
};
pub(crate) use job_review::{
    set_job_review_notes, upsert_company_review_state, upsert_job_blacklist,
    upsert_job_review_state, BLACKLIST_KIND_COMPANY, BLACKLIST_KIND_JOB, BLACKLIST_KIND_KEYWORD,
};
pub(crate) use jobs::{
    rebuild_all_job_fields, upsert_job_from_detail, upsert_job_from_list_item,
    upsert_job_from_normalized, NormalizedJobInput,
};
pub(crate) use source_adapter::supported_job_source_adapters;
pub(crate) use source_links::insert_job_source_link;
