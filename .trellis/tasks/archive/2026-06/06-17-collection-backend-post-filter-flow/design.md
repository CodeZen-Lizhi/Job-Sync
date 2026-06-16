# Design: Collection Backend Post-Filter Flow

## Scope

This task aligns backend behavior with the product model already expressed in the UI. Full collection batch summary is intentionally deferred to a later task.

```
platform collection
  -> unified job persistence
  -> canonical post-collection filter result
  -> job library buckets
```

The first backend slice should not rewrite every downstream AI/resume flow. It should make the collection-to-library and post-filter contract true and testable.

## Current Architecture Facts

- Worker entry:
  - `crawl_auto_start` starts one source-specific worker run.
  - Boss worker currently applies a profile filter before deciding which list items continue to detail capture.
  - V2EX emits `JOB_NORMALIZED_CAPTURED`.
- Sidecar event handling:
  - `JOB_DETAIL_CAPTURED` -> `upsert_job_from_detail` -> recompute default filter result.
  - `JOB_NORMALIZED_CAPTURED` -> `upsert_job_from_normalized` -> recompute default filter result.
  - `JOB_LIST_CAPTURED` -> `upsert_job_from_list_item` for each extracted list item -> recompute default filter result.
  - `JOB_FILTERED` with raw list item also upserts list item and recomputes.
- Storage:
  - `job` stores unified source fields including `source_platform`, `source_url`, `dedup_key`, `jd_text`, `raw_payload_json`.
  - `job_detail_raw` stores Boss detail raw payload.
  - `job_filter_result` stores `eligible`, `reason_json`, `profile_id`, `updated_at`.
- Queries:
  - `list_job_candidates` recomputes missing/stale filter results and joins `job_filter_result`.
  - `list_filtered_jobs` scans job-like rows and filters by filter result / blacklist / terminal states.

## Target Contracts

### Unified Persistence Contract

Every collected platform fact with a stable id should become a `job` row before actionability is decided.

- Boss list item: upsert list-level job record with raw payload and source link.
- Boss detail: enrich existing job with detail and JD text.
- V2EX normalized job: upsert normalized job with `jd_text` and raw payload.
- Worker filtered Boss item: still upsert raw list item; Rust result owns canonical eligibility.

### Canonical Filter Evidence Contract

Default Filter profile recompute must evaluate against a search corpus built from:

- normalized job display fields
- `job.jd_text`
- `job.raw_payload_json`
- Boss `job_detail_raw.zp_data_json`
- review / communication / company state fields
- blacklist hits

The evaluator should record enough reason metadata to distinguish:

- title/list evidence
- JD/detail/post evidence
- source platform restriction
- blacklist / manual status / communication status
- insufficient evidence

### Bucket Contract

Use one canonical result source for buckets.

- `recommended`: actionable eligible jobs, not processed/terminal.
- `filtered`: ineligible jobs, not deleted, reason visible.
- `pending_confirmation`: insufficient or weak evidence; preserved in job library and excluded from default recommended results.
- `processed`: review or communication state says the user already acted.
- `all`: complete persisted library.

Implementation options:

1. Extend `reason_json` with `bucket` and `evidence_quality`.
2. Add a nullable `bucket` column to `job_filter_result`.

Recommended MVP: extend `reason_json` first because it avoids schema migration and remains backward-compatible. If SQL filtering becomes awkward, add a column later with migration.

## Data Flow

### Boss

```
joblist response
  -> worker extracts all jobs
  -> sidecar upserts every list item
  -> Rust recomputes default filter result
  -> worker may use lightweight filter only to decide detail-priority, not persistence truth
  -> captured detail enriches job
  -> Rust recomputes same job again with stronger evidence
```

### V2EX

```
feed entry
  -> worker classifies hiring post
  -> emits normalized job with jd_text/raw_payload
  -> sidecar upserts job
  -> Rust recomputes default filter result using jd_text/raw_payload
```

## Compatibility

- Existing `eligible = true/false` stays valid.
- If `reason_json.bucket` is absent:
  - `eligible=true` can be treated as `recommended` unless processed.
  - `eligible=false` can be treated as `filtered`.
- Existing UI can continue reading `filter_eligible` and `filter_reason_json`.
- A future UI can query pending confirmation once backend returns it.
- Full collection batch/run summary remains out of scope for this slice.

## Rollback

- If only reason JSON and query logic change, rollback is code-only.
- If a schema migration is later introduced, migration must be additive and old rows must continue to query correctly.
- Batch summary rollback is not needed in this slice because the batch model is not implemented here.

## Risks

- Turning off worker pre-filter detail gating may increase Boss detail requests. Prefer a staged approach: persist all list items, but still prioritize eligible-looking detail captures within configured limits.
- Pending confirmation semantics can easily become vague. MVP should define concrete triggers such as missing JD/detail when rules require text evidence.
- `sourcePlatforms` must remain post-ingest only. Tests must guard against using it as collection source selection.
