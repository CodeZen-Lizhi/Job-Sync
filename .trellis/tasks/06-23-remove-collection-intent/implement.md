# Implement

## Checklist

1. [x] Remove generic intent fields and sync button from `src/pages/CrawlConfig.vue`.
2. [x] Remove generic intent state, computed lists, sync label, sync feedback, and `syncCollectionIntentToPlatforms` from `src/lib/useCrawlPage.ts`.
3. [x] Update `buildTaskForSource` so V2EX/LinuxDo filters no longer include `excluded_keywords` from generic intent or `collection_intent`.
4. [x] Update `buildCollectionConfigPayload` and `applyCollectionConfigPayload` to persist/load only platform-specific fields.
5. [x] Update frontend contract tests if they mention the removed sync/intent behavior, and add assertions that the removed UI/state stays absent.
6. [x] Run validation:
   - `npm run test:review-workflow`
   - `npm run build`
   - focused grep for removed symbols.

## Risk Points

- `useCrawlPage.ts` exports many refs through object spread; removed refs must also be removed from `CrawlConfig.vue` destructuring.
- `saveCollectionConfig` is still used before collection start; it must continue saving selected sources and platform-specific settings.
- Boss keywords validation copy currently tells users to fill generic intent and sync to Boss; update that message.

## Rollback Points

- If platform-specific config no longer saves, revert `buildCollectionConfigPayload` / `applyCollectionConfigPayload` first.
- If the page fails type-checking, inspect destructuring in `CrawlConfig.vue` and the `return` block in `useCrawlPage.ts`.
