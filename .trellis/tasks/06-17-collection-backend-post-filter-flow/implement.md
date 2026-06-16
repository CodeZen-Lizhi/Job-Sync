# Implement: Collection Backend Post-Filter Flow

## Checklist

1. Evidence corpus fix
   - Update Rust filter recompute queries to include `job.jd_text` and `job.raw_payload_json`.
   - Ensure `build_search_text` receives those fields for all job sources.
   - Add Rust tests proving V2EX/normalized `jd_text` can satisfy required rules and trigger excluded rules.

2. Worker/sidecar persistence truth
   - Inspect Boss worker profile filter use.
   - Ensure every Boss list item with a stable id is emitted or upserted before canonical eligibility is decided.
   - Preserve worker filter result as optional evidence/priority, not final truth.
   - Add or update worker/contract tests to prove filtered list items still become persisted/recomputable jobs.

3. Pending confirmation bucket
   - Define MVP pending criteria:
     - missing detail/JD when profile rules require text evidence
     - no strong evidence for required semantic rules
   - Extend reason JSON with `bucket: "recommended" | "pending_confirmation" | "filtered"` and optional `evidence_quality`.
   - Add backend query support for pending confirmation, or extend candidate query filters if that is simpler.
   - Add tests for pending confirmation and backward compatibility.

4. Query alignment
   - Ensure recommended/default candidates exclude `filtered` and `pending_confirmation`.
   - Ensure filtered query keeps returning ineligible jobs with reasons.
   - Ensure all-library query still includes every persisted job.
   - Avoid duplicated business judgment in page queries.

5. Validation
   - Rust focused tests for `filter_profile` and job queries.
   - Worker tests for Boss filter/persistence contract.
   - `npm run test:review-workflow`
   - `npm run test:worker`
   - `npm run build`
   - If Rust test command is available in project scripts or docs, run the focused Rust tests as well.

## Suggested Order

1. Fix Rust evidence corpus first because it is the smallest high-value correctness gap.
2. Then adjust worker semantics so collection no longer owns canonical final eligibility.
3. Then add pending confirmation bucket because it depends on evidence-quality semantics.
4. Leave collection batch summary for a later task. Do not add a collection batch model in this slice.

## Risk Points

- `src-tauri/src/commands/filter_profile.rs` has many existing tests; keep changes localized and add tests close to existing evaluator tests.
- `packages/boss-crawler-worker/src/modes/auto/run.ts` controls crawl volume; do not accidentally remove page/job limits.
- `src-tauri/src/sidecar/mod.rs` already upserts `JOB_FILTERED` raw list items; avoid duplicating rows or creating second source-link semantics.
- `src-tauri/src/commands/jobs/queries.rs` is large; prefer helper functions and focused tests over broad rewrites.

## Rollback Points

- Evidence corpus changes can be reverted independently from worker changes.
- Pending bucket changes should be isolated so recommended/filtered behavior can remain stable if pending needs revision.
