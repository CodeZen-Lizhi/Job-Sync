# Build Scripts

This directory contains local Node-based build helpers used by the desktop release workflow.

## Files

- `tauri-build.mjs` — runs the Tauri release build with `src-tauri/tauri.conf.release.json`, then runs release bundle verification; pass `--app-only` to build and verify only the macOS `.app` bundle for local desktop smoke tests.
- `release.mjs` — runs the current-platform Tauri release build and only adds the Windows portable ZIP step on Windows.
- `stage-worker-runtime.mjs` — stages the current-platform worker runtime into `src-tauri/bin/` for release packaging, including `node` on macOS/Linux or `node.exe` on Windows, `boss-crawler-worker/dist/`, `package.json`, and production `node_modules`.
- `verify-worker-runtime.mjs` — starts the staged worker runtime, waits for the startup log, sends `STOP`, and verifies `STOP received`, `FINISHED`, and a zero exit code.
- `verify-release-bundle.mjs` — on macOS, verifies the generated `.app` with `codesign`, verifies the bundled worker runtime inside `Contents/Resources/bin/`, and checks every generated DMG with `hdiutil verify`; pass `--app-only` to skip the DMG requirement. Other platforms skip this macOS-only gate.
- `boss-canary.mjs` — interactive Boss worker smoke test for the isolated visible-browser profile. Run login mode first, then collect mode; collect mode defaults to requiring `capture_source=natural` so fallback-only captures do not prove the normal search-page path. Pass `--allow-fallback-source` only when diagnosing DOM/API fallback behavior.
- `boss-db-canary.mjs` — read-only Boss App DB canary for a recent real Tauri collection run; checks `collection_run`, `job`, `job_source_link`, `job_detail_raw`, `job_filter_result`, and `collection_failure` instead of trusting worker `FINISHED` alone. It requires list-only detail evidence and a filter result updated after the source link so old detail/filter rows cannot mask a failed sidecar write.
- `seed-desktop-smoke-data.mjs` — creates an isolated SQLite + resume-workspace fixture for desktop UI smoke tests; pass a data directory argument or set `JOB_SYNC_DATA_DIR`, then launch the app with `--data-dir <path>`.
- `build-portable.mjs` — creates the portable Windows distribution by reusing the release build, copying `job-sync.exe`, `node.exe`, and the staged `boss-crawler-worker/` runtime into `release-portable/job-sync/`, and generating a portable zip archive; supports `--skip-build` to package from existing release artifacts.
- `export-resume-pdf.mjs` — renders resume HTML into a PDF using Puppeteer.
