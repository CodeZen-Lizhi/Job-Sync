# Implementation Plan

## Steps

1. Wire Boss persistent profile:
   - add `boss_browser_profile_path`
   - pass it from Boss login and Boss auto collection
   - update Rust unit tests around login/crawl payloads
2. Update worker Boss auto launch:
   - pass `payload.user_data_dir` into `launchBrowser`
   - keep cookie/localStorage injection as compatibility fallback
3. Replace stop-on-risk with pause-and-retry:
   - use `waitUntilNoRiskUrl` before API attempts
   - use `waitUntilApiOk` around joblist and optional detail requests
   - keep explicit abort behavior for user stop
4. Add natural browser collection path:
   - navigate Boss search page for each keyword/filter/page variant
   - listen for natural joblist response
   - fall back to existing `fetchJsonFromPage` only when no natural response arrives
   - store list-item jobs first; keep detail endpoint fetches opt-in instead of required
   - count optional detail fetch limits by attempted detail ids so failures do not amplify retries
   - pass the Boss persistent profile into manual evidence refresh as the opt-in detail path
5. Tests:
   - worker contract tests for profile usage and risk retry
   - Rust tests for Boss profile path payload wiring
   - preserve current city variant and risk-control expectations by updating them to the new behavior
6. Validation:
   - `packages/boss-crawler-worker` build/typecheck/targeted node tests
   - relevant Rust tests or `cargo test` targeted commands
   - final diff review plus Java review only if Java files change

## Files Expected

- `src-tauri/src/storage/mod.rs`
- `src-tauri/src/commands/auth.rs`
- `src-tauri/src/commands/crawl.rs`
- `packages/boss-crawler-worker/src/modes/auto/run.ts`
- `packages/boss-crawler-worker/src/modes/auto/shared.ts`
- worker/Rust tests under existing test locations

## Review Focus

- No hidden second source of truth for profile path.
- No infinite retry when the user has stopped the run.
- No silent success when Boss never returns a valid list.
- No high-risk anti-detection or bypass code.
