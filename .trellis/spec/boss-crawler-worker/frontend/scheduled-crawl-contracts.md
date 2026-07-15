# Scheduled Crawl Contracts

## Scenario: App-Open Background Schedule

### 1. Scope / Trigger

- Trigger: changing the automatic crawl scheduler so a Tauri window can be minimized or hidden without losing the next Cron wake-up.
- Scope: frontend Cron calculation, Rust one-shot wake-up, Tauri command, and `crawl-schedule://due` event.
- The scheduler must keep the existing frontend collection orchestration; it is not an operating-system task runner.

### 2. Signatures

- Frontend command wrapper:

```ts
updateCrawlSchedule(nextRunAtMs: number | null, requestVersion: number): Promise<void>
```

- Tauri command:

```rust
update_crawl_schedule(
    next_run_at_ms: Option<i64>,
    request_version: u64,
) -> Result<(), String>
```

- Due event: `crawl-schedule://due`

```ts
interface CrawlScheduleDueEvent {
  version: number;
  generation: number;
  scheduled_at_ms: number;
}
```

### 3. Contracts

- `next_run_at_ms = null` cancels the pending wake-up.
- A non-null `next_run_at_ms` is an absolute Unix epoch millisecond timestamp calculated by the frontend `croner` instance; Rust does not parse the Cron expression.
- The frontend increments `requestVersion` for every replace/cancel request. Rust ignores requests older than the latest accepted version so asynchronous IPC calls cannot restore an obsolete schedule.
- Rust stores only one pending deadline and waits with a blocking `Condvar`; it must not run a fixed polling loop.
- Rust clears the deadline before emitting `crawl-schedule://due`, so one generation can emit at most once.
- The frontend decodes the event once in `src/lib/scheduler.ts`, ignores malformed payloads, ignores stale versions, and ignores generations already handled.
- A valid due event calls the existing `runScheduledCrawl()` path. Busy/sidecar conflict behavior remains the existing skip-and-record behavior.
- The scheduler is app-process scoped: minimizing or hiding the window keeps it alive; closing the app stops it; no tray or OS scheduler is implied.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| `next_run_at_ms = null` | Clear the pending deadline and wake the scheduler thread. |
| Older `request_version` | Ignore without replacing the current deadline. |
| Deadline in the future | Wait once until the deadline or a replacement/cancel signal. |
| Deadline already passed | Emit one due event immediately; do not replay multiple missed Cron periods. |
| Rust event payload malformed | Frontend drops the event without invoking collection. |
| Event version is stale | Frontend drops the event. |
| Event generation already handled | Frontend drops the event. |
| Tauri listener setup fails | Do not schedule a backend wake-up; write an explicit runtime error. |
| Collection already running at due time | Record the existing skipped status and schedule the next Cron time. |

### 5. Good/Base/Bad Cases

- Good: frontend computes local-time Cron `nextRun()`, sends its epoch milliseconds, Rust waits without polling, emits once, and the frontend reuses `runScheduledCrawl()`.
- Good: two rapid config edits send versions 4 and 5 out of order; Rust accepts only version 5 and the frontend ignores any due event for version 4.
- Good: the computer sleeps through the deadline; the wait returns after wake, wall-clock comparison marks the deadline due, and only one event is emitted.
- Base: the app is restarted after a missed deadline; startup loads the saved Cron config and computes the next future run. Restart catch-up is outside this contract.
- Bad: a `setInterval` or short repeated `setTimeout` loop checks `Date.now()` while waiting.
- Bad: a second Rust Cron parser is introduced with different timezone semantics from the frontend `croner` instance.
- Bad: the event consumer reads `event.payload` with a local cast in multiple components or starts collection without checking version/generation.

### 6. Tests Required

- Rust scheduler unit tests must assert:
  - older versions cannot overwrite newer deadlines;
  - a future deadline is not due early;
  - a due deadline is consumed once;
  - cancellation removes a pending due event.
- Frontend contract tests must assert:
  - the app shell initializes schedule state;
  - `useCrawlPage` uses `updateCrawlSchedule` and `listenToCrawlScheduleDue`;
  - the old `crawlScheduleTimer` field is absent;
  - the shared event module owns the payload guard and command name;
  - Rust registers `update_crawl_schedule`.
- Desktop smoke must start the Tauri app, open crawl configuration, minimize the window, and verify the app process remains alive. A real timed crawl should be run only with an isolated test profile/data directory because it writes local collection data and can contact external platforms.

### 7. Wrong vs Correct

#### Wrong

```ts
window.setTimeout(() => void runScheduledCrawl(), nextRun.getTime() - Date.now());
```

This depends on WebView timer behavior while the window is minimized or hidden.

#### Correct

```ts
await listenToCrawlScheduleDue((event) => {
  if (event.version !== currentVersion || event.generation <= lastHandledGeneration) return;
  void runScheduledCrawl();
});
await updateCrawlSchedule(nextRun.getTime(), nextVersion);
```

Rust owns the one-shot wait; the frontend owns Cron semantics and collection orchestration.
