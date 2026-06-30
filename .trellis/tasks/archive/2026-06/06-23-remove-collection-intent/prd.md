# 删除通用采集意图配置

## Goal

Remove the user-facing and payload-level "通用采集意图" layer from collection configuration. Users should configure each collection platform directly, and post-collection rules should remain in the dedicated default rule panel.

## Confirmed Facts

- `src/pages/CrawlConfig.vue` renders the generic intent fields: keywords, excluded keywords, cities, work modes, tech stack, degrees, salary range, and experience range.
- `src/lib/useCrawlPage.ts` stores those generic fields in `collection_config`, exposes the sync button state, and maps generic intent into Boss/V2EX/LinuxDo settings through `syncCollectionIntentToPlatforms`.
- V2EX and LinuxDo task payloads currently include `filters.collection_intent`; Boss uses platform-specific `bossKeywordsText` and Boss filter fields after syncing.
- The Tauri settings command stores `collection_config` as generic JSON; platform-specific collection config still needs this persistence path.
- Default post-collection rules are separate from the generic collection intent and must stay.

## Requirements

- Remove the generic "通用采集意图" UI fields from the collection configuration page.
- Remove the "同步到平台配置" action and mapped/unmapped sync feedback.
- Remove generic collection intent state, computed values, save/load fields, and sync mapping logic from the frontend collection state.
- Stop sending `filters.collection_intent` and generic excluded keywords from V2EX/LinuxDo automatic collection payloads.
- Keep platform-specific configuration:
  - selected collection sources
  - Boss keywords, city, salary, experience, degree, industry, company scale, and additional Boss filters
  - V2EX URL, keywords, sort, recent days, and page limit
  - LinuxDo category URL, keywords, sort, recent days, page limit, and job limit
  - default post-collection rule panel and save/recompute actions
- Keep backend `collection_config` persistence for remaining platform-specific settings.
- Existing saved generic intent fields may be ignored during load; no migration UI is required.

## Acceptance Criteria

- [ ] `CrawlConfig.vue` no longer renders generic intent fields or a sync-to-platform button.
- [ ] `useCrawlPage.ts` has no `collectionKeywordsText`, `collectionTargetCitiesText`, `collectionWorkModesText`, `collectionTechStackText`, `collectionExcludedKeywordsText`, `collectionDegreesText`, generic salary/experience refs, `collectionIntentSyncLabel`, `bossSyncMappedFields`, `bossSyncUnmappedFields`, `bossSyncMessage`, or `syncCollectionIntentToPlatforms`.
- [ ] `buildTaskForSource` sends only platform-specific filters and the current post-collection `profile`.
- [ ] `buildCollectionConfigPayload` and `applyCollectionConfigPayload` persist/load only remaining platform-specific fields.
- [ ] Existing collection source selection and platform panels still work.
- [ ] Relevant frontend/type-check/test commands pass.

## Out of Scope

- Removing default post-collection rules or filter profile evaluation.
- Deleting the `save_collection_config` Tauri command or `settings.collection_config` storage.
- Migrating old saved generic intent fields out of existing settings files.
