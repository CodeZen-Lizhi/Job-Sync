# Design: Scheduled Crawl Trigger

## Scope

Add a daily scheduled crawl trigger that runs only while the app is open.
The scheduler lives in the existing crawl page state and reuses the current
`crawl_auto_start` flow instead of introducing a second collection pipeline.

## Confirmed Product Decisions

- Schedule is app-open only.
- Trigger frequency is once per day.
- Scheduled crawl uses the current crawl configuration.
- If a crawl is already running, the scheduled trigger skips and records a
  busy result.
- The control surface belongs in the crawl configuration page.

## Current Facts

- `useCrawlPage.ts` already owns crawl state, config persistence, and the
  `start()` / `stop()` entry points.
- `collection_config` is already persisted as JSON in settings.
- The backend already runs collection through the existing `crawl_auto_start`
  command and the worker sidecar.
- The repo does not currently have a scheduler service or cron-style runtime.

## Technical Approach

### Storage

Persist schedule configuration inside `collection_config` so it travels with
the rest of the crawl settings.

Suggested fields:

- `crawlScheduleEnabled`
- `crawlScheduleTime`
- `crawlScheduleLastRunAt`
- `crawlScheduleLastStatus`
- `crawlScheduleLastMessage`

No SQLite migration is needed for the first slice.

### Runtime

Implement a single timer in `useCrawlPage.ts`:

1. Read schedule config during `loadCollectionConfig()`.
2. Compute the next local datetime from the configured `HH:mm` time.
3. Set a `setTimeout` to the next occurrence.
4. When the timer fires, check whether a crawl is already running.
5. If busy, mark the run as skipped and schedule the next day.
6. If idle, call the existing crawl `start()` flow.
7. After completion, update the last run metadata and reschedule.

The scheduler should never queue overlapping runs.

### UI

Add a compact schedule panel to `CrawlConfig.vue`:

- enable/disable toggle
- daily time input
- next trigger preview
- last run status / message

The panel should sit alongside the existing crawl configuration sections so the
user edits one shared set of crawl settings.

## Compatibility

- Existing manual crawl behavior stays intact.
- Existing collection configuration remains the source of truth.
- No background daemon or system task is introduced.

## Rollback

- Remove the schedule fields from `collection_config`.
- Remove the timer/watch logic from `useCrawlPage.ts`.
- Remove the schedule UI from `CrawlConfig.vue`.

## Risks

- Because the scheduler is app-open only, a closed app will miss the scheduled
  window. That is intentional for this first slice.
- If the app is open but a crawl is already running, the scheduled run will be
  skipped rather than queued.
