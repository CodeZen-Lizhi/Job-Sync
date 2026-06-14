# Implementation Plan

## Checklist

1. Add SQLite schema for `job_review_state` and `job_blacklist`.
2. Add Rust DB helpers for review state upsert and blacklist insertion.
3. Extend jobs query projections and `JobRow` mapping with review/blacklist fields.
4. Add `list_review_candidates`.
5. Add Tauri commands for review state and blacklist operations.
6. Register commands in the Tauri app.
7. Extend frontend `JobRow` type and jobs page state management.
8. Add Top 20 candidate section to the jobs page.
9. Extend job item badges/actions for review, communication and blacklist.
10. Validate schema, TypeScript build, worker build, and Rust compile if `cargo` is available.

## Validation

- `sqlite3 :memory: < src-tauri/src/db/schema.sql`
- `npm run build`
- `npm run build:worker`
- `cargo check` if Rust toolchain is available

## Risk Points

- `JobRow` SELECT column order must stay aligned with `map_job_row`.
- Candidate query must exclude local manual decisions without hiding rows from ordinary search/source views.
- Company blacklist depends on `brand_name`; empty company names should not create unusable blacklist records.
