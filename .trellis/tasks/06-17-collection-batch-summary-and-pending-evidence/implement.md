# Implement: Collection Batch Summary and Pending Evidence Refresh

## Checklist

1. Pre-dev context
   - Read task PRD/design/implement.
   - Read collection source contracts spec.
   - Inspect sidecar event handling, crawl command, DB models/migrations, job queries, crawl/jobs page state.

2. DB model and migration
   - Add `collection_run` and `collection_failure` to schema.
   - Add migrations for existing DBs.
   - Add Rust model helpers for create/start/finish/update counters/list runs/list failures.
   - Add tests for migration and model helpers.

3. Collection run lifecycle
   - Create run when `crawl_auto_start` begins.
   - Attach run id to sidecar/worker context.
   - Mark run finished/failed/stopped.
   - Record run-level errors.

4. Event outcome accounting
   - For `JOB_LIST_CAPTURED`, count observed items and upsert outcomes.
   - For `JOB_NORMALIZED_CAPTURED`, count normalized item outcome.
   - For `JOB_DETAIL_CAPTURED`, update/enrich outcome without double counting inserted list facts if possible.
   - For `JOB_FILTERED`, preserve optional evidence without final truth.
   - Record item-level failures for missing ids/upsert/recompute failures.

5. Canonical bucket counts and recompute result
   - Add shared bucket-count query helper.
   - Extend `recompute_default_filter_profile` response with counts while keeping `updated`.
   - Refresh latest collection run bucket counters from canonical counts.

6. Pending evidence refresh
   - Add command `refresh_pending_job_evidence`.
   - Boss MVP: reuse worker/session/detail fetch path if feasible; otherwise create narrow one-job detail refresh path.
   - Unsupported source/missing session/fetch failure returns clear error and writes failure record.
   - Recompute filter after successful evidence update.

7. UI integration
   - Crawl page shows latest run summary and recent failures.
   - Jobs page pending bucket offers refresh evidence action where applicable.
   - Filter profile recompute result displays bucket counts.
   - Keep layout changes narrow; no visual redesign.

8. Validation
   - `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture`
   - `npm run test:review-workflow`
   - `npm run test:worker`
   - `npm run build`
   - `git diff --check`

## Risk Points

- `src-tauri/src/sidecar/mod.rs` handles several event types and can accidentally double count.
- `src-tauri/src/db/migrate.rs` must preserve existing DB compatibility.
- `packages/boss-crawler-worker/src/modes/auto/run.ts` should not increase Boss detail fetch volume except explicit refresh action.
- Frontend tests are contract-style; update them when wiring new commands.

## Rollback Points

- DB tables are additive, so code rollback leaves unused tables.
- Pending evidence refresh can be disabled independently from run summary.
- UI summary panels can be hidden without affecting persistence.
