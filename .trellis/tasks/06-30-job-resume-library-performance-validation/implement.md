# Performance Validation Implementation Plan

## Checklist

- [x] Read relevant performance boundary spec.
- [x] Snapshot current git state and avoid unrelated dirty files.
- [x] Collect real app DB row counts and payload sizes.
- [x] Ensure real DB schema/projection state can be inspected without mutating
      user data.
- [x] Capture `EXPLAIN QUERY PLAN` for representative Jobs hot paths.
- [x] Measure representative real DB query timings with repeated runs.
- [x] Add or create a reproducible synthetic large-data benchmark path.
- [x] Run synthetic 5k-row benchmark; optionally 10k if runtime is acceptable.
- [x] Compare offset/cursor or explain why only one path can be measured.
- [x] Run Resume overview/detail boundary validation.
- [x] Start local frontend dev server if possible and run browser smoke for Jobs
      and Resume routes.
- [x] Write `performance-report.md` with results and interpretation.
- [x] If a bottleneck is found, either fix the clear local issue or document the
      next focused task.
- [x] Re-run correctness checks after any code/test changes.

## Results

- Real DB temp-copy and synthetic 5k/10k backend query targets passed.
- Slowest 10k target queries:
  - FTS search p95 `19.408ms`
  - source filter p95 `12.960ms`
- Cursor next-page p95 on 10k was `0.360ms`; deep offset p95 was `1.394ms`.
- Full browser JS/console smoke was not available; Vite route reachability was
  verified and the coverage gap is recorded in `performance-report.md`.

## Validation Commands

Existing correctness gates:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml db::tests::job -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml commands::jobs::queries -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml resume_library -- --nocapture
node --test test/review-workflow-contract.test.js
npm run build
```

Likely measurement commands:

```bash
sqlite3 "$HOME/Library/Application Support/com.administrator.jobpilot/app.db" "<read-only SQL>"
npm run dev -- --host 127.0.0.1
```

If a benchmark script is added, include its command here before task completion.

## Risk Points

- Running migrations or write-side refresh against the real user DB could mutate
  data. Prefer read-only inspection or copy the DB first.
- Synthetic data that is too small can falsely prove the optimization.
- Browser smoke can be noisy if unrelated dirty files affect routes.
- Existing working tree contains unrelated WIP; do not commit it into this
  validation task.
- Query plans can differ between SQLite versions; record the local version.

## Rollback Points

- Delete synthetic DB files or temp directories.
- Revert benchmark-only scripts/tests if they become noisy.
- If a fix is required, keep it scoped and re-run the same benchmark before
  claiming improvement.
