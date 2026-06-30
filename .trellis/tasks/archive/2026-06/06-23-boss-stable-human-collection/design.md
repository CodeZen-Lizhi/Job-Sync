# Design

## Current State

- `launchBrowser` already supports `user_data_dir`.
- LinuxDo login and collection already pass a persistent profile path through Tauri payloads.
- Boss login currently stores cookies/localStorage but does not receive a persistent profile path from Tauri.
- Boss auto collection currently launches a visible browser without `user_data_dir`, injects stored cookies/localStorage, then directly calls Boss joblist/detail APIs from page context.
- `waitUntilApiOk` and `waitUntilNoRiskUrl` already provide the desired pause-and-retry behavior, but the Boss auto path stops immediately on abnormal access.

## Target Flow

```text
Tauri start_login("boss")
  -> LoginStartPayload.user_data_dir = <app-data>/boss-browser-profile
  -> worker opens visible Chrome profile
  -> user logs in normally
  -> stored cookies/localStorage remain compatibility evidence

Tauri crawl_auto_start(source_platform="boss")
  -> CrawlAutoStartPayload.user_data_dir = same boss profile
  -> worker opens visible Chrome profile
  -> navigates normal Boss job pages
  -> listens for natural joblist responses
  -> if risk response/page appears, pauses for user verification and retries
  -> emits existing Boss JOB_LIST_CAPTURED events for list-first storage; optional detail capture can still emit JOB_DETAIL_CAPTURED
```

## Implementation Decisions

- Add `storage::boss_browser_profile_path(app_data_dir)` next to the existing LinuxDo helper.
- Pass Boss `user_data_dir` from both `auth.rs` and `crawl.rs`; keep V2EX without a profile unless it later needs one.
- Keep cookies/localStorage loading for compatibility and recovery, but let the persisted browser profile become the main continuity mechanism.
- Reuse existing `waitUntilApiOk` and `waitUntilNoRiskUrl` for Boss risk handling instead of creating a second retry loop.
- Add worker-side natural-response helpers inside the Boss auto mode boundary:
  - listen for `/wapi/zpgeek/search/joblist.json`
  - open normal search URLs for keyword/filter/page variants
  - use the natural response if it arrives with `code=0`
  - if natural response is missing, fall back to the existing page-context fetch
  - if either path returns abnormal access, pause and retry
- Details can still use existing detail endpoint fetches as an opt-in, low-volume enhancement guarded by the same retry behavior. The default Boss auto path must not depend on detail fetches for success; when enabled, the limit counts attempted detail ids instead of only successful captures. A later v2 can capture natural detail responses from user-clicked job cards if needed.
- `refresh_pending_job_evidence` remains the manual detail-enhancement path for weak/list-only evidence, and it must reuse the same Boss persistent browser profile so risk continuity does not regress.

## Data / Contract Boundaries

- Rust IPC structs already include `user_data_dir`; no new wire field is needed.
- Worker events remain the existing Boss events; no DB schema change is needed.
- Logs and `LOGIN_STATUS` events are the user-facing state for manual verification.

## Non-Goals

- No CAPTCHA solving.
- No `__zp_stoken__` reverse engineering.
- No proxy rotation or TLS impersonation work.
- No new generic collection intent UI.

## Rollback

- Revert Boss-specific profile path wiring to restore old temporary-browser behavior.
- Keep profile directory isolated from normal user Chrome so rollback does not touch the user's real browser profile.
