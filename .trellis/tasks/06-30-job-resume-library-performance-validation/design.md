# Performance Validation Design

## Problem

The previous architecture work made the code structurally lighter, but structural
correctness is not the same as measured performance. This task should collect
evidence from the real app database and a reproducible large-data fixture, then
decide whether the current architecture is sufficient.

## Boundaries

- Real app DB checks are read-only.
- Synthetic data is created in a temporary SQLite database or test fixture.
- Browser validation uses local dev/build output only; it should not depend on
  external services.
- Any production code changes should be limited to reusable benchmark/test
  support or fixes discovered by measurement.

## Data Flow

```text
Real app.db / synthetic temp DB
  -> schema migration / projection refresh where needed
  -> query-plan and timing probes
  -> task-local performance report
  -> decision: optimized enough or follow-up bottleneck
```

Frontend smoke:

```text
Vite dev server
  -> Jobs / Resume routes
  -> browser smoke checks
  -> console/runtime observations
```

## Measurement Surfaces

### Real DB

- Row counts:
  - `job`
  - `job_detail_raw`
  - `job_source_payload`
  - `job_detail_projection`
  - `job_search_projection`
  - `job_list_summary_projection`
- Payload sizes:
  - `job.raw_payload_json`
  - `job_source_payload.raw_payload_json`
  - `job_detail_raw.zp_data_json`
  - `ai_report.result_json`
  - `company_score.evidence_json`
- Query plans:
  - common first-page list order
  - LIKE/search projection path
  - FTS path
  - source filter path
  - cursor next-page path
- Timings:
  - run each representative query multiple times
  - report min / median / p95 / max

### Synthetic DB

- Seed 5k rows minimum.
- Use large payloads that mimic the previous real maximums:
  - detail JSON around 200 KB for a subset
  - source payload around 100 KB for a subset
  - resume/evidence summaries on enough rows to exercise mappers
- Run projection refresh/backfill once, then benchmark hot queries.
- Keep the fixture deterministic so results can be compared later.

### Frontend

- Start a dev server if possible.
- Open Jobs and Resume routes.
- Verify primary content renders.
- Inspect console errors.
- Optional: capture simple interaction timings for route load, page switch, row
  expansion, and resume selection.

## Contracts To Preserve

- List hot paths must not reintroduce full raw/evidence JSON movement.
- Full detail/body remains available only through on-demand detail commands.
- Benchmarks must not hide failures with fallback success messages.
- Synthetic fixtures must not write into the user's production DB path.

## Reporting

Write task-local artifacts, for example:

- `performance-report.md`
- optional `benchmarks/` scripts or fixture notes if code is added

The report should include:

- environment/date/commit
- dataset description
- commands run
- query plan excerpts
- timing tables
- interpretation
- next bottleneck / follow-up recommendation

## Rollback

- Read-only real DB checks need no rollback.
- Synthetic temp DBs can be deleted.
- If benchmark code is added and later unwanted, remove the script/test without
  touching app data.

