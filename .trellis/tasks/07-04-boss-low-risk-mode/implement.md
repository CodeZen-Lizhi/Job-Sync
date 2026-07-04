# Boss 低风控采集模式实施计划

## Checklist

1. Inspect current Boss auto flow
   - `src/lib/useCrawlPage.ts`
   - `src/pages/CrawlConfig.vue`
   - `packages/boss-crawler-worker/src/modes/auto/run.ts`
   - `packages/boss-crawler-worker/src/modes/auto/shared.ts`
   - `test/review-workflow-contract.test.js`

2. Frontend config
   - Add `bossLowRiskMode` state with default `true`.
   - Persist load/save in collection config.
   - Add Boss config UI toggle and concise warning copy.
   - Apply conservative caps when building Boss task payload.

3. Worker policy
   - Add Boss low-risk policy helper.
   - Cap `maxPages`, `maxJobs`, and delay values when enabled.
   - Ensure `bossDetailFetchLimit` stays `0` unless explicitly outside low-risk mode.
   - Add run logs describing effective low-risk limits.

4. Health check and cooldown
   - Reuse existing risk detection helpers.
   - Add preflight check before list capture starts.
   - Add module-level cooldown state for Boss risk events.
   - If cooldown active, emit clear `ERROR` and skip collection before network-heavy work.
   - On risk/verification detection during collection, set cooldown and stop this Boss run.

5. Tests
   - Worker tests for policy caps and cooldown.
   - Frontend/review contract test for `bossLowRiskMode`, payload flag, and UI text.
   - Update collection source contract spec.

6. Verification
   - `npm -w @job-sync/boss-crawler-worker run test`
   - `npm run test:review-workflow`
   - `npm run build`
   - `cargo test --manifest-path src-tauri/Cargo.toml` only if Rust command/session behavior changes.

## Risky Files

- `packages/boss-crawler-worker/src/modes/auto/run.ts`: avoid breaking normal Boss list capture and existing human verification recovery.
- `src/lib/useCrawlPage.ts`: scheduled collection uses this state; missing default can silently disable Boss.
- `src/pages/CrawlConfig.vue`: keep layout compact and mobile-safe.
- `.trellis/spec/boss-crawler-worker/frontend/collection-source-contracts.md`: update contract with the new Boss low-risk behavior.

## Review Gates

- No anti-captcha or stealth-browser logic.
- No automatic apply/chat/send behavior.
- Non-Boss platform payloads unchanged.
- Boss duplicate/update rows still do not trigger AI review or Telegram push.
