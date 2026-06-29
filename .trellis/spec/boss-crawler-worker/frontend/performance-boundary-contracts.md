# Performance Boundary Contracts

## Scenario: Jobs And Resume Library List/Detail Boundaries

### 1. Scope / Trigger

- Trigger: Jobs and Resume library performance work that changes SQLite schema,
  Tauri command contracts, row mapper fields, or frontend route state.
- Applies to list/search/candidate pages, resume library overview/detail flows,
  projection refresh code, and contract tests that guard large payloads.
- The implementation rule is additive-first: add tables/commands, dual-write or
  backfill, switch read paths, and only clean old fields in a later task.

### 2. Signatures

- SQLite hot tables/projections:
  - `job`: hot identifiers, titles, company, status, timestamps, and ordering
    fields.
  - `job_source_payload(encrypt_job_id, raw_payload_json, source_hash,
    updated_at)`: cold raw source payload.
  - `job_detail_raw(encrypt_job_id, zp_data_json, updated_at)`: cold raw detail
    payload.
  - `job_detail_projection(encrypt_job_id, ..., search_text, source_hash,
    updated_at)`: typed detail/search fields.
  - `job_search_projection(encrypt_job_id, title_text, company_text,
    location_text, requirement_text, source_text, search_text, job_hash,
    detail_hash, source_hash, updated_at)`: single owner for job search text.
  - `job_list_summary_projection(encrypt_job_id, ai_audit_status,
    ai_audit_summary, filter_summary, resume_match_score,
    resume_match_summary, company_score, company_risk_summary,
    score_reason_json, source_hash, updated_at)`: short list summaries.
- Tauri commands:
  - `list_job_candidates(...) -> JobCandidatePage`: returns lightweight rows and
    optional `next_cursor`; it must not return raw source/detail/evidence JSON.
  - `get_job_detail(encrypt_job_id) -> JobDetail`: returns full raw detail on
    demand.
  - `get_resume_library_overview(selected_resume_id?) -> ResumeLibraryOverview`:
    returns list metadata and selected id only.
  - `get_resume_record(resume_id) -> ResumeRecord | null`: returns the full
    resume body on demand.
- Write-side refresh entry points:
  - `refresh_job_derived_projections(conn, encrypt_job_id, raw_payload_json?)`
  - `refresh_all_job_projections(conn)`
  - model-level writes for `company_score`, `job_filter_result`, and job upserts
    must refresh affected list/search projections when their source fields
    change.

### 3. Contracts

- List rows may include ids, titles, timestamps, bucket/status labels, score
  numbers, and short summary strings.
- List rows must not include:
  - `job.raw_payload_json`
  - `job_source_payload.raw_payload_json`
  - `job_detail_raw.zp_data_json`
  - full `ai_report.result_json`
  - full `company_score.evidence_json`
  - full resume Markdown/body text
- Search, blacklist, FTS rebuilds, source grouping, review candidates, and daily
  intelligence candidates should read `job_search_projection.search_text`
  instead of rebuilding ad hoc long SQL concatenations.
- Candidate/list row mappers should read `job_list_summary_projection` for
  badges and summaries instead of parsing full evidence JSON per row.
- Full raw data remains available only through explicit detail, evidence,
  replay, debug, AI-context, or recomputation paths.
- Projections store hashes and must skip unchanged rows during startup/backfill.

### 4. Validation & Error Matrix

- Missing projection row -> backfill or refresh it before relying on list/search
  behavior.
- Stale hash -> refresh the projection; unchanged hash -> skip expensive JSON
  parsing.
- Missing raw detail/source payload -> keep list behavior functional and surface
  an explicit detail/recompute error only in the on-demand path.
- Search projection missing a field -> fix the projection builder, not every SQL
  caller.
- Direct SQL writes to evidence/source tables -> either route through the model
  write function or explicitly refresh the affected projection in the same
  transaction boundary.

### 5. Good/Base/Bad Cases

- Good: `list_job_candidates` joins `job_search_projection` and
  `job_list_summary_projection`, then `get_job_detail` loads
  `job_detail_raw.zp_data_json` only when the row is expanded.
- Base: existing `limit/offset` pagination remains supported while new callers
  may use `next_cursor` based on `(last_seen_at, encrypt_job_id)`.
- Bad: a list query selects `cs.evidence_json` or `ar.result_json` and lets the
  Rust mapper parse those large JSON blobs for every visible row.
- Bad: the resume route calls `get_resume_library_state` on initial list load
  and moves the selected resume body even when no detail/editor view needs it.

### 6. Tests Required

- Rust DB tests:
  - projection backfill is idempotent;
  - stale hashes refresh affected rows;
  - unchanged rows are skipped;
  - FTS/search projection can find projected text without raw JSON joins.
- Rust command tests:
  - candidate/list queries avoid `job_detail_raw` until detail search is needed;
  - cursor pagination is stable with duplicate `last_seen_at` values;
  - review/daily/source-group paths reuse projections.
- Resume tests:
  - overview serialization omits resume body;
  - `get_resume_record` returns the body on demand.
- Contract tests:
  - scan `queries.rs` for forbidden hot-path reads such as `j.raw_payload_json`,
    `cs.evidence_json`, and `SELECT ar.result_json`;
  - scan frontend resume types/state so overview/list item types do not include
    `body`.
- Build checks:
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
  - targeted Rust tests for DB/job/query/resume paths;
  - `node --test test/review-workflow-contract.test.js`
  - `npm run build`

### 7. Wrong vs Correct

#### Wrong

```sql
SELECT j.*, cs.evidence_json, ar.result_json
FROM job j
LEFT JOIN company_score cs ON cs.company_name = j.brand_name
LEFT JOIN ai_report ar ON ar.encrypt_job_id = j.encrypt_job_id;
```

This makes every list row pay the cost of moving and parsing full evidence JSON.

#### Correct

```sql
SELECT j.*, lsp.company_score, lsp.company_risk_summary, lsp.score_reason_json
FROM job j
LEFT JOIN job_search_projection sp ON sp.encrypt_job_id = j.encrypt_job_id
LEFT JOIN job_list_summary_projection lsp ON lsp.encrypt_job_id = j.encrypt_job_id;
```

The list path receives stable short summaries. Full evidence remains available
through explicit detail/evidence commands.

