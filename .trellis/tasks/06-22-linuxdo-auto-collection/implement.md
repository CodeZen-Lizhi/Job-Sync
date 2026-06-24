# LinuxDo 自动采集实现计划

## Ordered Checklist

1. Worker LinuxDo parser utilities
   - Add `packages/boss-crawler-worker/src/linuxdo/feed.ts` or equivalent.
   - Parse Discourse category JSON topic list.
   - Parse Discourse topic JSON first-post cooked HTML into text.
   - Detect Cloudflare challenge HTML.
   - Classify LinuxDo topic as job posting using hiring signals plus optional keywords.

2. Worker LinuxDo visible-browser mode
   - Add `runLinuxDoMode(payload, ctx)`.
   - Launch visible browser with `allow_domain_suffixes: ["linux.do"]`.
   - Navigate to configured `category_url`.
   - Wait for Cloudflare challenge to clear with clear runtime logs.
   - Fetch list/detail JSON in page context; fallback to DOM links/detail page text when JSON fails.
   - Insert title-level jobs when detail fetch fails but topic id/title/link are present.
   - Emit `JOB_NORMALIZED_CAPTURED` for accepted topics and `JOB_FILTERED` for skipped topics.
   - Respect `maxPages`, `maxJobs`, `delayMs`, `recentDays`, `sortBy`.

3. Worker routing
   - Update `packages/boss-crawler-worker/src/modes/auto/run.ts`.
   - Route `source_platform = "linuxdo"` to LinuxDo mode.
   - Ensure `FINISHED` emits exactly once for LinuxDo.

4. Frontend state and persistence
   - Extend `CollectionConfigPayload` in `src/lib/useCrawlPage.ts` with LinuxDo fields.
   - Add refs, sanitizers, build/apply config payload.
   - Add `linuxdoSelected` computed.
   - Build LinuxDo task payload with:
     - `source_platform: "linuxdo"`
     - `filters.category_url`, `filters.sort_by`, `filters.recent_days`, `filters.keywords`
     - `limits.maxPages`, `limits.maxJobs`, `limits.delayMs`
   - Remove temporary skip behavior for LinuxDo.

5. Frontend UI
   - Add LinuxDo section in `src/pages/CrawlConfig.vue`, parallel to V2EX.
   - Fields: category URL, keywords, recent days, page limit, job limit, sort mode.
   - Make sync intent populate `linuxdoKeywordsText`.

6. Tauri/Rust routing
   - Update `src-tauri/src/commands/crawl.rs` so `source_platform = "linuxdo"` uses optional session, not Boss session.
   - Update `src-tauri/src/sidecar/mod.rs` so LinuxDo FINISHED triggers `auto_recompute_ai_after_collection`.
   - Consider whether `job_sources` adapter kind should stay `manual_import` for this task or become a new collectable kind; if changed, update DB tests and source contracts.

7. Specs
   - Update `.trellis/spec/boss-crawler-worker/frontend/collection-source-contracts.md`:
     - LinuxDo visible-browser collection contract.
     - LinuxDo config fields.
     - Cloudflare handling and no hidden bypass.

8. Tests
   - Worker tests:
     - parse category topic JSON.
     - parse topic detail JSON/cooked HTML.
     - classify hiring vs discussion topics.
     - build normalized LinuxDo job payload.
     - title-level fallback emits normalized payload with `detail_status = "missing"` or `"blocked"`.
     - detect Cloudflare challenge.
   - Frontend tests / contract tests:
     - LinuxDo config section appears when selected.
     - LinuxDo config persists through collection config payload.
     - LinuxDo task payload uses `source_platform = "linuxdo"`.
   - Rust tests:
     - `crawl_auto_start` for LinuxDo does not require Boss session.
     - normalized LinuxDo job writes unified fields.
   - Regression:
     - Boss and V2EX builds/tests still pass.

9. Validation and packaging
   - `npm run build`
   - `npm run build:worker`
   - targeted worker tests
   - targeted Rust tests
   - `git diff --check`
   - Visible-browser smoke with LinuxDo:
     - select LinuxDo
     - complete browser verification if prompted
     - confirm collection run and at least one normalized job or explicit Cloudflare timeout error
   - Package app if requested after implementation passes.

## Risky Files

- `packages/boss-crawler-worker/src/modes/auto/run.ts`
- `packages/boss-crawler-worker/src/linuxdo/*`
- `src/lib/useCrawlPage.ts`
- `src/pages/CrawlConfig.vue`
- `src-tauri/src/commands/crawl.rs`
- `src-tauri/src/sidecar/mod.rs`
- `.trellis/spec/boss-crawler-worker/frontend/collection-source-contracts.md`

## Rollback Points

- If visible-browser LinuxDo mode is unstable, keep the UI config but gate start with a clear error and do not ship as collectable.
- If normalized入库 works but detail fetch is unreliable, ship title/list-level ingest only if product accepts lower detail quality; otherwise block release until detail is stable.
- If Cloudflare repeatedly blocks even visible browser mode, keep logs explicit and do not add stealth/bypass hacks beyond existing browser launch behavior.

## Follow-up Checks Before `task.py start`

- User approves visible-browser mode plan and LinuxDo config fields.
- User accepts MVP fallback behavior when detail JSON is blocked. Decision: accepted; title/link-level jobs may be inserted and later treated as low-info/pending.
- Current unrelated working-tree changes are either committed or deliberately carried into this task.
