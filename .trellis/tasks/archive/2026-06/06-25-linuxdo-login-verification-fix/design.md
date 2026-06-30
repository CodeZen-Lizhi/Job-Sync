# LinuxDo Login Verification Design

## Boundary

This task only changes LinuxDo login/readiness behavior. It keeps the LinuxDo collector API-first and keeps Cloudflare verification manual in a visible browser profile. It does not add hidden bypass automation.

## Current Root Cause

The LinuxDo login worker currently treats the `_t` cookie as the success signal. That is too weak for LinuxDo because Cloudflare verification and Discourse API readability are separate concerns. The collector already requires stronger evidence: the same browser profile must be able to fetch Discourse JSON from page context with `credentials: "include"`.

## Target Contract

- `LOGIN_STATUS captcha`: visible LinuxDo page still looks like Cloudflare / human verification.
- `LOGIN_STATUS invalid`: LinuxDo page is open, but the browser context cannot yet read category JSON.
- `LOGIN_STATUS valid`: the browser context can read LinuxDo Discourse category JSON, then cookies and local storage are emitted for persistence.

## Data Flow

1. Settings page calls `start_login({ sourcePlatform: "linuxdo" })`.
2. Tauri sends `LOGIN_START` with the LinuxDo profile path.
3. Worker opens a normal Chrome/Edge window using that profile, without Puppeteer control or remote debugging.
4. User completes LinuxDo Cloudflare verification and account login in that normal window, then exits that browser process.
5. Worker briefly reopens the same profile in controlled mode and probes `https://linux.do/c/job/27.json` from page context.
6. Once JSON is readable and the LinuxDo login cookie is present, worker emits `LOGIN_STATUS valid` and `COOKIE_COLLECTED`.
7. Tauri writes `linuxdo-cookies.json` and `linuxdo-local-storage.json`.
8. Settings refreshes platform status from the persisted session snapshot.

## Compatibility

- Boss login behavior stays unchanged.
- LinuxDo collection fallback keeps using the same browser profile and may reuse the same probe helper.
- Existing saved cookie snapshots remain compatible; this task improves when and why they are written.

## Rollback

Revert the LinuxDo login readiness probe changes in `packages/boss-crawler-worker/src/modes/login.ts` and any helper exports if the visible login flow regresses.
