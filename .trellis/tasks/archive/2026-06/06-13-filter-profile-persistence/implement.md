# Implementation Plan

## Checklist

1. Add SQLite schema/migration for `filter_profile` and `job_filter_result`.
2. Add Rust db model helpers to upsert/load default profile and upsert filter results.
3. Add Tauri commands:
   - `get_default_filter_profile`
   - `set_default_filter_profile`
4. Register commands in Tauri app.
5. Persist `JOB_FILTERED` and eligible `JOB_LIST_CAPTURED` results in sidecar event loop.
6. Extend jobs queries/model with filter result fields.
7. Extend frontend types and jobs item rendering.
8. Make crawl page load/save default profile.
9. Validate with builds and browser smoke test.

## Validation

- `npm run build`
- `npm run build:worker`
- `cargo check` if Rust toolchain is available in the environment
- Browser smoke test for crawl and jobs pages when dev server can run

## Risk Points

- Rust protocol event persistence must not break existing worker events.
- `JOB_LIST_CAPTURED` should only mark eligible jobs after worker-side filtering.
- Jobs query column order must match `map_job_row`.
