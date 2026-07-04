# 接入脉脉招聘内容源实施计划

## Checklist

1. Update source contracts and constants
   - Add `MAIMAI_SOURCE_PLATFORM`.
   - Move `maimai` into collectable platforms.
   - Register `maimai` as automatic feed adapter in TypeScript and Rust source registry.
   - Add `maimai` to default filter profile source platforms.
   - Update collection source spec for Maimai contracts.

2. Add frontend config
   - Add Maimai state, computed values, config persistence load/save.
   - Add Maimai panel in `CrawlConfig.vue`.
   - Validate non-empty Maimai URL input and positive limits.
   - Update Settings capability labels and Jobs source labels where needed.

3. Add worker Maimai adapter
   - Create `packages/boss-crawler-worker/src/maimai/feed.ts`.
   - Implement URL splitting and normalization.
   - Implement article id extraction from `fid`, `efid`, URL path/query, or stable canonical URL fallback.
   - Implement article HTML parser.
   - Implement list/search page link discovery and pagination.
   - Implement hiring/referral classifier based on positive signals, not keyword-only matches.
   - Implement normalized payload builder.
   - Route `source_platform === "maimai"` from `runAutoMode`.

4. Add tests
   - Worker unit tests for article id extraction, URL splitting, detail parser, list discovery, hiring classifier, normalized payload, empty config / blocked page behavior.
   - Rust tests for source registry, optional session behavior, default filter profile migration.
   - Frontend/review workflow contract tests for collectable source constants, settings capability, config panel and labels.

5. Verification
   - `npm -w @job-sync/boss-crawler-worker run test`
   - `npm run test:review-workflow`
   - `cargo test --manifest-path src-tauri/Cargo.toml`
   - `npm run build`
   - Browser smoke for `/crawl-config` and `/settings` desktop/mobile if UI changes are substantial.

## Risky Files / Rollback Points

- `packages/boss-crawler-worker/src/modes/auto/run.ts`: wrong routing could make Maimai fall into BOSS path.
- `packages/boss-crawler-worker/src/maimai/feed.ts`: classifier too broad could ingest ordinary discussion posts.
- `src/lib/useCrawlPage.ts`: config persistence changes can affect scheduled collection.
- `src-tauri/src/db/models/filter_results.rs`: default source changes affect candidate visibility.
- `src-tauri/src/db/models/source_adapter.rs`: adapter kind changes affect settings UI and source registry.

Rollback is additive: remove Maimai from collectable platforms/source registry and worker route while leaving existing manual `maimai` job rows untouched.

## Review Gates

- Confirm no private/contact/candidate endpoints are used.
- Confirm keyword-only articles cannot enter `job`.
- Confirm worker emits explicit error or filtered/log reason for zero accepted jobs.
- Confirm `maxJobs` remains sidecar inserted-job cap, not raw article count.
- Confirm BOSS/猎聘/智联/V2EX/LinuxDo tests still pass.

