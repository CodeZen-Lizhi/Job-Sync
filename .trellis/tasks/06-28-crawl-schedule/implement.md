# Implement: Scheduled Crawl Trigger

## Preconditions

- Keep unrelated dirty work intact.
- Use `trellis-before-dev` and the crawl/frontend spec docs before editing.
- Stay within the existing crawl pipeline; do not add a new backend scheduler.

## Checklist

1. [x] Extend crawl config state
   - [x] Add schedule fields to the crawl config payload and state.
   - [x] Add helpers to compute the next daily trigger time.
   - [x] Load / persist schedule metadata with the rest of `collection_config`.

2. [x] Add frontend scheduler
   - [x] Add a single timer in `useCrawlPage.ts`.
   - [x] Initialize scheduler from the app shell while the app is open.
   - [x] Reschedule when schedule settings change.
   - [x] Skip and record a busy result if a crawl is already running.
   - [x] Reuse the existing `start()` crawl flow for scheduled triggers.

3. [x] Add UI controls
   - [x] Add a schedule section to `CrawlConfig.vue`.
   - [x] Expose enable toggle, time input, next run preview, and last run status.
   - [x] Keep the panel compact and consistent with the existing config page.

4. [x] Validation
   - [x] `npm run build`
   - [x] Browser smoke test `/crawl-config` and `/crawl` at desktop and mobile widths.
   - [x] Verify the schedule panel renders, the config persists, and the page has no
     console errors or horizontal overflow.

## Rollback Points

- Scheduler logic can be removed without touching the crawl backend.
- UI controls can be removed without affecting manual crawl.
- No DB migration rollback is needed for the first slice.
