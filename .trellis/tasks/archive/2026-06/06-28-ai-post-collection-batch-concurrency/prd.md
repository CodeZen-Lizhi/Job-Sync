# AI 采后判断批量并发优化

## Goal

Improve the speed of AI post-collection judgement by replacing the current per-job serial AI execution path with a bounded batch-concurrency execution path, while preserving current filtering semantics, failure handling, and notification behavior.

## Confirmed Facts

- `recompute_ai_post_collection_judgement` currently loads candidate jobs and processes them with `for input in inputs`.
- Each non-hard-blocked job calls `run_worker_command(CommandIn::AiPostCollectionJudge(...))`.
- `run_worker_command` starts a new worker process for each call and waits for one `AI_RESULT`.
- Worker `runAiPostCollectionJudgeMode` performs one AI request and emits one result.
- During automatic collection persistence, sidecar recomputes local filter profile results, but does not directly call AI post-collection judgement.
- Frontend "recompute ordinary + AI" flows pass all visible job ids to `recompute_ai_post_collection_judgement`.

## Requirements

- Add a batch AI post-collection judgement path that starts one worker process for multiple jobs.
- Run AI requests with bounded concurrency inside the worker instead of serially in Rust.
- Keep hard-rule skipped jobs out of AI calls and preserve their current behavior.
- Keep SQLite writes in Rust and avoid concurrent database writes.
- Preserve existing `reason_json.ai_judgement` structure and bucket semantics.
- Preserve partial failure behavior: one job failure must not fail the whole batch.
- Preserve final count summary and Telegram summary behavior.
- Bound concurrency conservatively by default to avoid API rate-limit spikes.
- Keep the existing single-job AI command path available for compatibility.
- Do not add new runtime dependencies unless the existing code cannot support the concurrency pool cleanly.

## Acceptance Criteria

- [ ] Recomputing AI post-collection judgement for multiple jobs starts one batch worker command instead of one worker command per job.
- [ ] Worker processes multiple jobs with a configurable or computed concurrency cap.
- [ ] AI result mapping is keyed by `encrypt_job_id`; results are not applied to the wrong job if completion order differs.
- [ ] Hard-blocked jobs are counted as skipped and are not included in the batch payload.
- [ ] Failed AI calls persist the existing failed fallback judgement for that job only.
- [ ] Successful AI calls still merge into deterministic `reason_json` via the existing judgement rules.
- [ ] DB writes remain serialized through the existing Rust command path.
- [ ] Existing frontend result summary remains compatible.
- [ ] Tests cover all-success, partial-failure, and hard-skip behavior.
- [ ] Worker tests cover bounded batch concurrency or equivalent contract behavior.

## Notes

- Preferred default concurrency: remote API `3`, local Ollama `1`.
- Maximum concurrency should be capped to prevent accidental unbounded fan-out.
- This task is cross-layer and requires `design.md` plus `implement.md` before implementation.
