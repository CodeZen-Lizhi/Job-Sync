# Jobs And Resume Library Performance Implementation Plan

## Checklist

- [x] Read project frontend quality and cross-layer guidelines.
- [x] Add additive SQLite indexes in schema and migration.
- [x] Measure/query-plan the affected local query paths before and after index changes.
- [x] Gate expensive `job_detail_raw` joins and large text scans so normal candidate/list loads do not touch full detail JSON.
- [x] Preserve full body/detail search behavior where the user explicitly searches text.
- [x] Add or update Rust tests for list payload boundaries and query behavior.
- [x] Add resume overview/detail commands or an equivalent split contract.
- [x] Update `src/lib/resumeLibrary.ts`, `useResumeLibraryPage.ts`, and `ResumeLibrary.vue` to load body on demand.
- [x] Add or update frontend contract tests that heavy list/state payloads do not include full bodies.
- [x] Run targeted Rust tests for jobs/resume/db and frontend contract tests.
- [x] Run final review/self-check for Rust/TypeScript performance boundary regressions.

## Next Structural Optimization Plan

Goal: move search/list hot paths away from raw detail JSON by introducing an additive typed projection.

- [x] Add `job_detail_projection` schema and additive migration.
- [x] Extract projection fields from `job_detail_raw.zp_data_json` with best-effort parsers for Boss, V2EX, LinuxDo, and imported sources.
- [x] Store `source_hash` so projection staleness can be detected cheaply.
- [x] Backfill projection for existing detail rows without reparsing unchanged rows on every app start.
- [x] Update job detail upsert paths so projection is refreshed whenever raw detail JSON changes.
- [x] Update candidate query search and keyword blacklist checks to use `job_detail_projection.search_text` instead of raw `zp_data_json` when raw detail is not required.
- [x] Keep `get_job_detail` returning raw JSON on demand for expanded/debug detail.
- [x] Add tests for projection backfill, stale refresh, detail search through projection, and list paths not joining `job_detail_raw`.
- [x] Run targeted Rust jobs/db tests, frontend contract tests, and `npm run build`.

Suggested implementation order:

1. Schema/migration and projection extractor tests.
2. Upsert/backfill wiring.
3. Candidate search/blacklist query switch.
4. Contract tests and performance query-plan check.

## Next Architecture-Level Optimization Plan

Goal: finish moving the Jobs library from "large JSON in hot queries" to "small hot tables plus cold raw payloads and explicit projections".

Detailed handoff roadmap: `architecture-roadmap.md`.

### Phase A: Move Source Raw Payload Out Of The Hot `job` Table

- [x] Add `job_source_payload`:
  - `encrypt_job_id TEXT PRIMARY KEY`
  - `raw_payload_json TEXT NOT NULL`
  - `source_hash TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- [x] Backfill from `job.raw_payload_json`.
- [x] Dual-write from all job upsert paths.
- [x] Switch replay/debug/detail-only consumers to read `job_source_payload`.
- [x] Remove `j.raw_payload_json` from list/search/FTS SQL inputs where it is still present.
- [x] Add tests proving list/candidate/source-group queries do not select or join raw source payload.
- [x] Keep the old `job.raw_payload_json` column for compatibility until a later cleanup.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml source_payload -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml list_job_candidates -- --nocapture
node --test test/review-workflow-contract.test.js
npm run build
```

### Phase B: Add A Unified `job_search_projection`

- [x] Add `job_search_projection`:
  - `encrypt_job_id TEXT PRIMARY KEY`
  - `title_text TEXT NOT NULL DEFAULT ''`
  - `company_text TEXT NOT NULL DEFAULT ''`
  - `location_text TEXT NOT NULL DEFAULT ''`
  - `requirement_text TEXT NOT NULL DEFAULT ''`
  - `source_text TEXT NOT NULL DEFAULT ''`
  - `search_text TEXT NOT NULL DEFAULT ''`
  - `job_hash TEXT NOT NULL`
  - `detail_hash TEXT`
  - `source_hash TEXT`
  - `updated_at TEXT NOT NULL`
- [x] Build it from hot `job` fields, `job_detail_projection`, and selected lightweight source metadata.
- [x] Route keyword blacklist SQL through `job_search_projection.search_text`.
- [x] Route LIKE search through `job_search_projection.search_text`.
- [x] Rebuild `job_fts` from `job_search_projection`, not from ad hoc concatenation in triggers.
- [x] Delete repeated long search concatenation constants after all callers move.
- [x] Add tests proving search/blacklist/FTS all share the projection and preserve current behavior.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml job_search_projection -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml list_job_candidates -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml job_fts_is_created_and_searchable -- --nocapture
node --test test/review-workflow-contract.test.js
```

### Phase C: Project List Summaries For AI, Filter, Resume, And Company Evidence

- [x] Identify every JSON field parsed for list rows:
  - `ai_report.result_json`
  - filter reason JSON
  - company score evidence JSON
  - resume match evidence JSON
- [x] Add or extend a summary projection with stable row fields:
  - `ai_audit_status`
  - `ai_audit_summary`
  - `filter_summary`
  - `resume_match_score`
  - `resume_match_summary`
  - `company_score`
  - `company_risk_summary`
- [x] Update row mapper to select summary fields instead of parsing full evidence JSON per row.
- [x] Add detail/evidence commands for full JSON evidence when the user opens the detail drawer or confirmation view.
- [x] Add contract tests that list payloads do not include full evidence JSON.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml list_job_candidates -- --nocapture
node --test test/review-workflow-contract.test.js
npm run build
```

### Phase D: Add Cursor Pagination For Large Local Libraries

- [x] Keep existing `limit/offset` API for compatibility.
- [x] Add cursor fields based on `(last_seen_at, encrypt_job_id)`.
- [x] Add backend command support for next-page cursor.
- [x] Update the frontend only after backend tests prove ordering stability.
- [x] Add tests for duplicate timestamps, source filters, processed filters, and back/forward route behavior.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml list_job_candidates_cursor -- --nocapture
npm run build
```

### Phase E: Consolidate Projection Refresh Pipeline

- [x] Create one write-side refresh function that updates:
  - hot job fields
  - source payload
  - detail projection
  - search projection
  - list summary projection
- [x] Store hashes on every projection and skip unchanged rows.
- [x] Use the same pipeline for migration backfill and normal writes.
- [x] Add tests that a source update refreshes every derived projection exactly once.
- [x] Document the pipeline in `.trellis/spec/` if it becomes the project convention.

Implementation notes:

- Added `job_source_payload`, `job_search_projection`, and `job_list_summary_projection`.
- `refresh_all_job_projections` is the migration/backfill entry point.
- Job upsert paths call `refresh_job_derived_projections` after hot fields, detail projection, source payload, and company score are updated.
- Main candidate rows prefer `job_list_summary_projection` and no longer select full company evidence JSON.
- Full raw source/detail JSON remains available for detail, evidence refresh, filter recomputation, and AI evidence commands.

Validation:

```bash
cargo test --manifest-path src-tauri/Cargo.toml projection_refresh -- --nocapture
node --test test/review-workflow-contract.test.js
npm run build
```

Suggested next-session order:

1. Phase A first: it removes the next largest hot-table JSON risk, `job.raw_payload_json`.
2. Phase B second: it gives search and blacklist one owner instead of scattered SQL text.
3. Phase C third: it reduces per-row evidence JSON parsing and list payload weight.
4. Phase D only after list/search projections are stable.
5. Phase E when the projection pattern appears in 3+ places and needs one owner.

## Validation Commands

```bash
cargo test --manifest-path src-tauri/Cargo.toml db:: commands::jobs::queries resume_library
node --test test/review-workflow-contract.test.js
npm run build
```

Adjust Rust filters if the module filter syntax is too broad or misses affected tests.

## Performance Observations To Recheck

- Local database row counts:
  - `job`: 165
  - `job_detail_raw`: 165
  - `job_filter_result`: 274
- Large payload sizes:
  - max `job_detail_raw.zp_data_json`: about 202 KB
  - max `job.raw_payload_json`: about 130 KB
  - max `job.jd_text`: about 55 KB
- Existing simple candidate query plan scans `job` and uses a temp B-tree for ordering.

## Risk Points

- Keyword blacklist semantics depend on matching large text/detail fields.
- Search behavior may rely on detail JSON for rare matches.
- Resume route async loading can race when users switch quickly.
- Existing dirty worktree must be preserved.

## Rollback Points

- Revert query SQL constants to the previous joined form.
- Keep new indexes if harmless; drop in later migration only if write overhead is proven problematic.
- Fall back Resume library page to `get_resume_library_state(selectedResumeId)` for a selected detail if split commands regress.
