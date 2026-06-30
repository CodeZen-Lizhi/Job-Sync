# AI Post-Collection Batch Concurrency Implementation Plan

## Checklist

- [x] Read project-specific guidance before code edits.
- [x] Inspect current protocol definitions in Rust and worker TypeScript.
- [x] Add batch command and payload/result types to worker protocol.
- [x] Add matching Rust IPC protocol variants and serde structs.
- [x] Implement worker batch mode using existing prompt builder, AI client, and schema validation.
- [x] Add a small bounded concurrency helper without introducing a dependency.
- [x] Register the batch mode in worker `main.ts`.
- [x] Add Rust batch runner helper that starts one worker command and reads one batch result.
- [x] Refactor `run_recompute_ai_post_collection_judgement` to call the batch helper for all non-hard-blocked inputs.
- [x] Preserve old single-job mode and merge/fallback behavior.
- [x] Add or update contract tests for protocol and batch behavior.
- [x] Run worker tests, frontend contract tests, and Rust tests for affected commands.
- [x] Run Java/Rust/TypeScript review-equivalent self-check; use Java review only if Java files change.

## Validation Commands

```bash
npm -w @job-sync/boss-crawler-worker run test
node --test test/review-workflow-contract.test.js
cargo test --manifest-path src-tauri/Cargo.toml ai:: post_collection
```

Adjust Rust test filters after inspecting actual test names.

## Risk Points

- Rust and TypeScript protocol drift.
- Applying AI results by vector order instead of `encrypt_job_id`.
- Accidentally making SQLite writes concurrent.
- Treating a worker-level failure as a total command failure without per-job fallback.
- Debug trace or API log run IDs colliding under concurrency.
- Existing dirty worktree files must be preserved.

## Rollback Point

The refactor should keep the old single-job path available. If batch mode fails verification, revert only the Rust call-site to the old per-job `run_worker_command` loop while leaving protocol additions unused.
