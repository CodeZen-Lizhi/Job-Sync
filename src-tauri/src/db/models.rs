mod collection;
mod common;
mod company_score;
mod filter_results;
mod job_fields;
mod job_list_summary_projection;
mod job_projection;
mod job_review;
mod job_search_projection;
mod job_source_payload;
mod jobs;
mod source_adapter;
mod source_links;

#[cfg(test)]
pub(crate) use collection::JobUpsertOutcome;
pub(crate) use collection::{
    create_collection_run, fail_collection_run, fail_stale_running_collection_runs,
    finish_collection_run, increment_collection_counter, new_collection_run_id,
    record_collection_failure, record_collection_run_job_inserted,
    refresh_collection_run_bucket_counts, BucketCounts, CollectionCounter, NewCollectionFailure,
    NewCollectionRun,
};
pub use collection::{
    get_collection_batch_summary, list_collection_failures, list_collection_run_inserted_job_ids,
    list_collection_runs, CollectionBatchSummary, CollectionFailure, CollectionRun,
};
pub(crate) use company_score::{
    compute_company_score, rebuild_company_scores, upsert_company_score,
    upsert_company_score_from_source,
};
pub(crate) use filter_results::{
    list_filter_profiles, load_default_filter_profile, set_default_filter_profile_id,
    upsert_default_filter_profile, upsert_filter_profile, upsert_job_filter_result, FilterProfile,
    DEFAULT_FILTER_PROFILE_ID,
};
#[cfg(test)]
pub(crate) use job_list_summary_projection::{
    backfill_job_list_summary_projections, refresh_job_list_summary_projection,
};
#[cfg(test)]
pub(crate) use job_projection::backfill_job_detail_projections;
#[cfg(test)]
pub(crate) use job_projection::upsert_job_detail_projection;
pub(crate) use job_review::{
    set_job_review_notes, upsert_company_review_state, upsert_job_blacklist,
    upsert_job_review_state, BLACKLIST_KIND_COMPANY, BLACKLIST_KIND_JOB, BLACKLIST_KIND_KEYWORD,
};
#[cfg(test)]
pub(crate) use job_search_projection::backfill_job_search_projections;
#[cfg(test)]
pub(crate) use job_source_payload::backfill_job_source_payloads;
#[cfg(test)]
pub(crate) use job_source_payload::get_job_source_payload;
pub(crate) use jobs::{
    rebuild_all_job_fields, refresh_all_job_projections, upsert_job_from_detail_with_outcome,
    upsert_job_from_list_item_with_outcome, upsert_job_from_normalized_with_outcome,
    NormalizedJobInput,
};
#[cfg(test)]
pub(crate) use jobs::{
    upsert_job_from_detail, upsert_job_from_list_item, upsert_job_from_normalized,
};
pub(crate) use source_adapter::supported_job_source_adapters;
pub(crate) use source_links::insert_job_source_link;
