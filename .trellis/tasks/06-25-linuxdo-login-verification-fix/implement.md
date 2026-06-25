# LinuxDo Login Verification Implementation Plan

## Checklist

- [x] Reuse or add a browser-context Discourse JSON probe for LinuxDo login readiness.
- [x] Change LinuxDo login mode so `_t` cookie is not the success criterion.
- [x] Keep Cloudflare verification as an explicit waiting state.
- [x] Emit LinuxDo session data only after the browser profile can read category JSON.
- [x] Make Settings status messaging reflect "可采集" rather than cookie-only login.
- [x] Add focused worker tests for the LinuxDo readiness probe and challenge state where practical.
- [x] Launch LinuxDo login with the same persistent real-browser profile strategy used by collection fallback.
- [x] Run worker build/tests and frontend/Rust checks that are feasible on this machine.
- [x] Run a real smoke against the local LinuxDo profile: browser page-context fetch must return JSON or report verification still blocked.

## Smoke Result

- Before manual login completion, the local LinuxDo profile still returned `HTTP 403` / `Just a moment...`, with no `_t` login cookie. This is now reported as a blocked verification state, not as success.
- Manual login verification was started in a normal browser window, but the window was not completed/closed during this session, so end-to-end "logged in and JSON readable" remains unverified.

## Validation Commands

- `npm run build:worker`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml auth`
- Real smoke script using the LinuxDo profile path under the app data directory.

## Risk Points

- Cloudflare behavior can change between runs; smoke results must report actual HTTP/status evidence.
- If the user has not completed verification in the visible browser, the correct result is "still blocked", not "login code failed".
