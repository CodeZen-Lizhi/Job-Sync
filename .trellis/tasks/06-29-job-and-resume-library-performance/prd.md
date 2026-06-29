# 岗位库与简历库性能优化

## Goal

Reduce visible lag in the Jobs library and Resume library when local data grows or individual records contain large job detail / resume bodies, while preserving current user-facing behavior and local-first data ownership.

The first optimization slice should focus on query and rendering hot paths that are already visible in the current codebase:

- Jobs library candidate and search queries should avoid unnecessary full-table sorting and repeated large-field work.
- Jobs list rows should stay lightweight; large detail JSON should be fetched only when a row is expanded.
- Resume library list/state refreshes should avoid reading and returning full resume bodies unless the selected resume detail is needed.
- Frontend refreshes should avoid duplicate IPC calls and heavy re-rendering when the visible data did not require it.

## Confirmed Facts

- Real local database exists at `~/Library/Application Support/com.administrator.jobpilot/app.db`.
- Current local data snapshot has 165 jobs, 165 detail rows, 274 filter result rows, and 0 AI report rows.
- Large text is already present even with only 165 jobs:
  - `job_detail_raw.zp_data_json` average length is about 5.8 KB and max is about 202 KB.
  - `job.raw_payload_json` average length is about 3.6 KB and max is about 130 KB.
  - `job.jd_text` average length is about 1.2 KB and max is about 55 KB.
  - `job_filter_result.reason_json` average length is about 815 bytes and max is about 2.4 KB.
- `JobRow.filter_reason_json` is marked `skip_serializing`, so full filter JSON is already kept out of frontend list payloads.
- `JobRow.score_reason_json` is still serialized for every row and frontend helper code parses it when building summaries/confirmations.
- `list_job_candidates` counts and fetches rows via `JOB_CANDIDATE_FROM_SQL`, which always `LEFT JOIN`s `job_detail_raw`.
- Candidate/list search filters include `j.jd_text`, `j.raw_payload_json`, and `d.zp_data_json`, so keyword search over large fields can scan and touch large content.
- Query plan for a simple candidate-style `last_seen_at` query currently scans `job` and uses a temp B-tree for `ORDER BY`.
- Schema currently has no index on `job(last_seen_at)` and no index on `job_source_link(keyword)`.
- `get_job_detail` already fetches full detail JSON on demand by `encrypt_job_id`.
- Resume library stores metadata in `resume-library/index.json` and body JSON files separately.
- `get_resume_library_state` currently returns list metadata, selected resume full body, and linked jobs in one state payload.
- Resume page already delays Markdown rendering until preview is expanded, but selected resume body is still loaded into frontend state during library load.
- App root does not use global `<KeepAlive>` around heavy routes, matching the current frontend quality guideline.

## Requirements

- Keep list-row payloads lightweight: do not add raw job detail JSON, full job raw payloads, or full resume bodies to list responses.
- Improve Jobs library query performance for common candidate-page loads and source-group/detail navigation without changing visible filters, buckets, or sorting semantics.
- Fetch full job detail JSON only for an expanded/selected row.
- Reduce repeated large JSON parsing in frontend hot paths; parse full score/evidence JSON only where the detail/summary action needs it, or replace it with backend-projected short fields when practical.
- Improve Resume library state loading so list refreshes and route entry do not eagerly move large resume bodies unless detail/edit/preview needs them.
- Preserve existing resume create/update/delete/default/link/unlink behavior.
- Preserve existing Jobs page pagination, filters, resume status badges, detail expansion, and refresh behavior.
- Add tests or contract checks that guard the lightweight list/detail boundary.
- Add database indexes only through additive migration/schema changes; no destructive migration.

## Acceptance Criteria

- [ ] Candidate-page query plan for common `last_seen_at` ordered loads can use an index instead of scanning `job` plus temp sorting.
- [ ] Keyword/source grouping query paths avoid unnecessary large-detail reads when not searching body/detail text.
- [ ] Full `job_detail_raw.zp_data_json` remains absent from list row payloads and is still returned by `get_job_detail`.
- [ ] Resume library can load list metadata without eagerly returning full resume body unless a selected detail is requested.
- [ ] Selecting/editing a resume still loads the correct full body.
- [ ] Jobs page and Resume library remain functionally compatible with existing UI flows.
- [ ] Contract tests cover heavy list payload boundaries and/or resume body-on-demand behavior.
- [ ] Local quality checks for affected TypeScript/Rust code pass, or any skipped check is explained.

## Notes

- User explicitly cares about large data / content-heavy records, especially job details, Jobs library, and Resume library slight lag.
- User is open to frontend or architecture changes if the end result is the same.
- This is a complex cross-layer performance task; use `design.md` and `implement.md` before starting implementation.
