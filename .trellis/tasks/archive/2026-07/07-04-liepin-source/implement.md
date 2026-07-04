# 接入猎聘采集渠道实施计划

## Checklist

1. Update source contracts and constants
   - Add `LIEPIN_SOURCE_PLATFORM`.
   - Move `liepin` into collectable platforms.
   - Add `liepin` adapter kind in TypeScript and Rust source registry.
   - Add `liepin` to default filter profile source platforms.

2. Add Tauri session/profile support
   - Add Liepin storage paths.
   - Extend crawl session path/profile dispatch.
   - Extend login platform normalization, status, payload, and tests.

3. Add worker Liepin adapter
   - Create `src/liepin/feed.ts`.
   - Implement URL builders, city splitting, raw param merge, parser helpers, verification detection, normalized payload builder.
   - Add `runLiepinMode` and route from `runAutoMode`.
   - Add login mode support for Liepin profile connection if needed by settings UI.

4. Add frontend config and settings UI
   - Add Liepin state, computed values, config persistence load/save.
   - Add Liepin panel in `CrawlConfig.vue`.
   - Add validation for keywords, page cap, job cap.
   - Update Settings capability labels, login-capable set, hints, and status labels.

5. Add tests and canaries
   - Worker unit tests for parser, detail parser, verification detection, normalized payload, missing profile error.
   - Rust tests for source registry, profile path, optional session, login platform.
   - Frontend/review workflow contract tests for UI constants and settings capability.
   - If practical, add lightweight `liepin-canary` / DB canary scripts modeled after Zhilian; otherwise document as follow-up if live verification is unstable.

6. Verification
   - `npm -w @job-sync/boss-crawler-worker run test`
   - `npm run test:review-workflow`
   - Targeted Rust tests under `src-tauri`
   - `npm run build`
   - Browser smoke for `/crawl-config` desktop/mobile if frontend layout changes are non-trivial.

## Risky Files / Rollback Points

- `packages/boss-crawler-worker/src/modes/auto/run.ts`: wrong routing could make Liepin fall into BOSS path.
- `src-tauri/src/commands/crawl.rs`: wrong session/profile mapping could leak Boss/Zhilian cookies into Liepin.
- `src/lib/useCrawlPage.ts`: source list and config persistence changes can affect scheduled collection.
- `src-tauri/src/db/models/filter_results.rs`: default source platform changes affect candidate visibility.

Rollback is straightforward if changes are kept additive: remove `liepin` from collectable platforms/source registry and delete the worker route while leaving existing manual `liepin` job rows untouched.

## Review Gates

- Confirm no new source reads untyped event payload fields in more than one place.
- Confirm platform session files are fully separate.
- Confirm no catch-all fallback reports successful collection without at least one stable normalized job.
- Confirm BOSS/智联/V2EX/LinuxDo tests still pass.
