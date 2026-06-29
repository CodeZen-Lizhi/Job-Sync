# 岗位库与简历库性能验收

## Goal

Prove whether the completed Jobs/Resume library architecture optimization is
actually fast under real local data and larger simulated data, instead of only
being structurally correct. The output should make it clear whether the app is
"optimized enough" now, and where the next bottleneck is if it is not.

## Confirmed Facts

- The previous task `06-29-job-and-resume-library-performance` is archived and
  committed as `f5e6be9`.
- The architecture optimization added:
  - `job_source_payload`
  - `job_detail_projection`
  - `job_search_projection`
  - `job_list_summary_projection`
  - cursor support on `list_job_candidates`
  - resume overview/detail split
  - performance boundary spec
- Current local app DB exists at:
  `~/Library/Application Support/com.administrator.jobpilot/app.db`.
- Current real DB snapshot:
  - `job`: 165 rows
  - `job_detail_raw`: 165 rows
  - max `job_detail_raw.zp_data_json`: 202,258 bytes
- `sqlite3` is available locally.
- Existing validation already covers structural correctness:
  - Rust jobs/query/projection/resume tests
  - `test/review-workflow-contract.test.js`
  - `npm run build`
- There is no dedicated performance benchmark or large-data simulation script
  in the repo yet.

## Requirements

- Measure the real local database after the migration/projection changes are
  applied.
- Capture row counts, largest relevant payload sizes, and projection table
  coverage/staleness.
- Capture `EXPLAIN QUERY PLAN` for common Jobs library paths:
  - first page ordered by `last_seen_at`
  - search / FTS path
  - source filtered path
  - cursor next page path
- Measure wall-clock timing for representative backend queries/commands.
- Create a reproducible large-data validation path that does not mutate the
  user's real database.
- Simulate enough data to expose row-width, deep pagination, and large JSON
  problems:
  - at least 5,000 jobs
  - preferably 10,000 jobs if runtime remains practical
  - large detail/source/evidence payloads on a meaningful subset
- Compare offset and cursor behavior where possible.
- Verify the frontend route is not obviously blank, broken, or doing duplicate
  body/detail loads after the optimization.
- Keep all test/benchmark writes out of production user data unless the command
  is explicitly read-only.
- Document results in the task directory so future optimization work has a
  concrete baseline.

## Proposed Performance Targets

- Real DB common list/search query timing: p95 <= 100ms on this machine.
- Simulated 5k Jobs list first-page backend query: p95 <= 200ms.
- Simulated 10k Jobs list first-page backend query: p95 <= 350ms, if the 10k
  fixture is used.
- Resume overview load should not serialize full resume body text.
- Jobs/Resume frontend smoke should render non-empty primary content with no
  obvious console/runtime errors.

These targets are proposed thresholds. If the measured values miss the target,
the task is still useful, but the output must name the bottleneck and recommend
the next fix.

Decision: accepted for this validation pass after user replied "继续".

## Acceptance Criteria

- [x] A read-only real-DB performance report is written under this task
      directory.
- [x] The report includes row counts, max payload sizes, projection coverage,
      query plans, timings, and interpretation.
- [x] A reproducible large-data benchmark or test fixture is added or documented
      so it can be rerun later.
- [x] Large-data results cover at least Jobs first-page list and one search path.
- [x] Cursor vs offset behavior is measured or clearly explained if not
      measurable with current APIs.
- [x] Resume overview/detail body boundary is verified with command/test
      evidence.
- [x] Browser/page smoke is run if a dev server can be started safely.
- [x] If measurements show a regression or obvious bottleneck, a follow-up fix
      plan is added instead of claiming success.
- [x] Existing correctness checks still pass after any benchmark/test code is
      added.

Note: the browser/page smoke was limited to Vite dev-server route reachability
because the full in-app browser automation runtime was not exposed in this
session. This coverage gap is documented in `performance-report.md`.

## Out Of Scope

- Destructive schema cleanup, such as dropping `job.raw_payload_json`.
- Changing app behavior based only on benchmark speculation.
- Mutating the user's real app DB for synthetic data.
- Packaging/release build. If packaging is requested later, increment version
  first per the user's standing rule.

## Open Decision

- None.
