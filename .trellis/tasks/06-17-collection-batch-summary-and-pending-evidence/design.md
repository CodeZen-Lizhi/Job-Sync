# Design: Collection Batch Summary and Pending Evidence Refresh

## Scope

This task extends the canonical post-collection flow with operational visibility and recovery actions:

```
automatic crawl command
  -> collection_run starts
  -> worker events
  -> sidecar writes jobs / failures / counters
  -> Rust canonical filter recompute
  -> run summary + bucket counts
  -> pending evidence refresh action
```

## Architecture Boundaries

### Worker

- Continues to emit existing events.
- Should include an optional `run_id` in command payload/event context when feasible.
- Does not own canonical bucket counts.
- Does not decide final job persistence truth.

### Tauri Crawl Command / Sidecar

- Owns creation and lifecycle of `collection_run`.
- Passes `run_id` to worker task payload or sidecar event context.
- Converts event handling outcomes into collection counters and failure records.
- Keeps per-event write errors visible instead of only logging.

### DB Models

Additive tables:

- `collection_run`
  - `id TEXT PRIMARY KEY`
  - `source_platform TEXT NOT NULL`
  - `keywords_json TEXT NOT NULL`
  - `filters_json TEXT`
  - `limits_json TEXT`
  - `status TEXT NOT NULL`
  - `started_at TEXT NOT NULL`
  - `finished_at TEXT`
  - `error_message TEXT`
  - counters: `captured`, `inserted`, `updated`, `duplicate`, `recommended`, `pending`, `filtered`, `failed`
- `collection_failure`
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `run_id TEXT`
  - `source_platform TEXT`
  - `event_type TEXT NOT NULL`
  - `keyword TEXT`
  - `encrypt_job_id TEXT`
  - `reason TEXT NOT NULL`
  - `raw_payload_json TEXT`
  - `created_at TEXT NOT NULL`

No existing table is changed destructively.

### Filter / Job Queries

- Add a bucket count helper that derives counts from `job`, `job_filter_result`, review state, blacklists, and `reason_json.bucket`.
- Default filter recompute should return `{ updated, counts }`, keeping `updated` for compatibility.
- `list_job_candidates` remains the paginated source for bucket rows.
- `list_collection_runs` and `list_collection_failures` expose operational history.

### Pending Evidence Refresh

Command:

- `refresh_pending_job_evidence(encrypt_job_id: String) -> PendingEvidenceRefreshResult`

Behavior:

- Loads local job and verifies `reason_json.bucket == pending_confirmation`.
- Boss automatic path:
  - Use stored Boss session.
  - Use `encrypt_job_id` plus optional raw/list payload link data to request detail.
  - Upsert detail/raw/JD using existing normalization path where possible.
  - Recompute filter result for that job.
- Unsupported source path:
  - Return a clear error such as `当前来源暂不支持自动补证据`.
  - Record failure.
- Missing session/path:
  - Return clear error and record failure.

Implementation detail:

- Prefer reusing existing worker detail fetch if already exposed. If not, create a narrow Rust/worker command only for one-job detail refresh.
- Do not add apply/send actions.

## Data Flow

### Collection Run

1. Frontend calls `crawl_auto_start(task)`.
2. Rust command creates `collection_run(status='running')`.
3. Command starts sidecar worker with task + run context.
4. Sidecar event handler:
   - increments captured for observed list/normalized/detail item facts
   - uses DB existence before/after upsert to classify inserted/updated/duplicate
   - records failure rows for item-level errors
   - recomputes canonical filter for affected job
5. `FINISHED` marks run finished and refreshes bucket counters from DB state.
6. `ERROR` marks run failed or records run-level error, depending on whether `FINISHED` follows.

### Bucket Counts

Counts are derived, not separately judged:

- recommended: eligible true, bucket recommended or absent, unprocessed, not blacklisted/terminal
- pending: `reason_json.bucket = pending_confirmation`
- filtered: ineligible/blacklisted/terminal and not pending
- processed: review or communication state indicates user action
- all: all persisted jobs

### Failure Recording

Failures should be written for:

- no stable job id in list item
- upsert function returns error
- filter recompute returns error
- detail refresh unsupported/missing session/detail fetch failed
- malformed normalized payload after IPC validation, where observable

## Compatibility

- Existing DBs get new tables through migration.
- Existing `recompute_default_filter_profile` consumers still read `updated`.
- Existing job rows simply have no historical collection run; bucket counts still work.
- Existing worker events remain accepted without `run_id`; sidecar may associate active run by process context.

## Rollback

- New tables are additive.
- If pending evidence refresh is unstable, disable command/UI entry while preserving run summary and failures.
- If run counters drift, recompute final bucket counters from DB state; operational inserted/updated counts remain historical best effort.

## Risks

- Detail refresh may require Boss session and anti-risk handling. MVP must fail explicitly instead of pretending to refresh.
- Counting updated vs duplicate can be approximate unless upsert returns changed fields. Use a conservative definition and test it.
- Query-level bucket logic must not become a second filter evaluator; it can only consume filter results and state flags.
