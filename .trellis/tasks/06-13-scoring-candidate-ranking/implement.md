# Implementation Plan

## Checklist

1. Extend Rust `JobRow` with score fields.
2. Add score helpers in jobs query layer:
   - latest resume AI report score
   - preference score from filter reason JSON
   - company risk score from job fields/detail JSON
   - final weighted score
3. Update list/search/source/candidate queries to include score projection.
4. Sort `list_review_candidates` by `final_score DESC`.
5. Extend frontend `JobRow` type.
6. Render score badges and reason summary in `JobsJobItem`.
7. Validate schema/build/browser smoke test.

## Validation

- `sqlite3 :memory: < src-tauri/src/db/schema.sql`
- focused SQLite smoke test for score ordering if practical
- `npm run build`
- `npm run build:worker`
- `cargo check` if Rust toolchain is available

## Risk Points

- SQL column order must stay aligned with `map_job_row`.
- `score_reason_json` should be valid JSON even when source data is malformed.
- Heuristic Company Score is not a replacement for later AI Company Score.
