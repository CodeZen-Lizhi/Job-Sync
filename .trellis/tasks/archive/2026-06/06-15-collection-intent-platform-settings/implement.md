# Implementation Plan

## Checklist

- [x] Update crawl page state with collection intent fields and Boss sync result.
- [x] Keep Boss worker payload compatible by deriving task payload from Boss platform settings.
- [x] Rework crawl page UI sections:
  - collection intent
  - collection source selection
  - sync action/result
  - collapsible Boss settings
  - collapsible filter profile
  - limits
- [x] Split dense collection setup into a standalone `采集配置` menu, leaving `采集` as the execution console with profile switching and runtime controls.
- [x] Share crawl setup state between `采集配置` and `采集` so route switching does not reset unsaved intent/platform/profile choices.
- [x] Rename/clarify source wording in filter profile context to allowed candidate sources.
- [x] Make login panel Boss-specific.
- [x] Update settings source model into platform capability wording and reserved automatic collection states.
- [x] Run `npm run build`.
- [x] Browser smoke test `http://[::1]:1430/#/crawl`.
- [x] Inspect diff for accidental unrelated changes.
- [x] Register V2EX as a collectable public Feed source while keeping other non-Boss platforms reserved/manual-import.
- [x] Add `source_platform` to automatic collection payload and route Boss/V2EX separately.
- [x] Add V2EX Feed worker mode that parses Atom entries, applies source-level job-posting detection, and emits normalized job events.
- [x] Add Tauri/Rust event handling and SQLite upsert for normalized V2EX jobs.
- [x] Update crawl config/execution/settings UI copy and controls for V2EX feed collection.
- [x] Add regression tests for V2EX feed parsing/classification and unified-model upsert.
- [x] Replace Top 20 copy/entry points in the Jobs page with one paginated all-candidate list, so extra collected jobs stay visible in the same job candidate library.
- [x] Add a clearer all-jobs browsing entry as a paginated flat list instead of keyword-grouped job details.
- [x] Remove the Jobs page top search toolbar shown above the queues; the redesigned all-jobs entry does not depend on that search-first workflow.
- [x] Replace "daily job intelligence" with a time-range filtered job intelligence view, using ranges like today, yesterday, last 7 days, last 30 days, last 90 days, and custom; do not include the notification/copy/email action toolbar shown in the second reference image.
- [x] Remove the Jobs page work-queue overview cards section shown in the reference image, including the review, favorite, ready-to-apply, communication follow-up, filtered audit, and blacklist entry cards.
- [x] Replace the Jobs page Top 20/recent-filter-explanation model with one paginated all-candidate jobs list. The list shows all job candidates from both manual and automatic collection, supports time-range filtering, and supports processed/unprocessed filtering; jobs become processed after user actions such as favorite, ready-to-apply, ignore/not-fit, communication updates, application, blacklist, notes, or similar review actions. Separate favorite, ready-to-apply, communication follow-up, and blacklist sections are modeled as multi-select list filters instead, including favorite, ready-to-apply, greeted, read-no-reply, replied, rejected, applied, and has-notes. A collection-method field is shown on each job row/card, with values manual and automatic, and the list has a multi-select collection-method filter.
- [x] Show each job candidate's source platform in the unified job list/card, so users can see which platform the job came from, such as Boss or V2EX.

## Validation

- `npm run build`
- `npm --workspace packages/boss-crawler-worker test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `git diff --check`
- `npm run test:review-workflow`
- `cargo test --manifest-path src-tauri/Cargo.toml list_job_candidates -- --nocapture`
- Browser smoke:
  - `采集配置` renders collection intent
  - sync button updates Boss settings
  - Boss section is collapsible on `采集配置`
  - filter profile section is separate/collapsible on `采集配置`
  - `采集` renders as execution console with profile switching and collection limits
  - settings page shows platform capability language
  - mobile viewport around `390x844` has no horizontal overflow on `采集配置` or `采集`
  - `岗位候选库` renders the unified list, filter controls, platform filter, collection-method filter, and pagination on desktop and `390x844`

## Risk Points

- `src/pages/Crawl.vue` is currently large; keep edits scoped and avoid changing worker behavior.
- Existing dirty changes in `Settings.vue` and the earlier shallow crawl-page edit must be reconciled, not blindly reverted.
