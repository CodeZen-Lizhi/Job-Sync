# Design

## Boundaries

- Frontend UI boundary: `src/pages/CrawlConfig.vue` should expose source selection, platform-specific panels, and default post-collection rules only.
- Frontend state boundary: `src/lib/useCrawlPage.ts` remains the owner of collection page state, but it should no longer carry a generic intent layer or sync-mapping state.
- Backend boundary: Tauri keeps `collection_config` as a JSON settings bucket for platform-specific configuration. No schema migration is required because unknown old fields can be ignored by the new frontend loader.
- Worker boundary: worker protocol should receive platform-specific `filters` plus `profile`. No `collection_intent` should be emitted by the frontend.

## Data Flow

Before:

1. User edits generic intent fields.
2. User clicks "同步到平台配置".
3. Frontend maps the intent into Boss/V2EX/LinuxDo fields.
4. Frontend also stores generic intent fields and sends `filters.collection_intent` for V2EX/LinuxDo.

After:

1. User edits selected platform panels directly.
2. Frontend saves selected sources and platform-specific fields in `collection_config`.
3. Automatic collection builds one task per selected source from direct platform config.
4. Post-collection judgement receives the saved default `profile` as before.

## Compatibility

- Old `settings.json` may still contain removed generic fields. The loader will ignore them.
- `save_collection_config` and `get_settings` remain compatible because the backend treats `collection_config` as `serde_json::Value`.
- `packages/boss-crawler-worker/src/boss/filters.ts` may keep `collection_intent` in reserved keys defensively, but new frontend code must not generate it.

## Tradeoffs

- We intentionally do not auto-migrate generic intent into platform fields. The user asked to remove the feature completely, and auto-migration would preserve the old abstraction in another form.
- Platform-specific keyword fields remain separate. This avoids hidden transformations such as appending work mode to Boss keywords.

## Rollback

- Revert `src/pages/CrawlConfig.vue` and `src/lib/useCrawlPage.ts` changes to restore the generic intent UI/state.
- No database or settings migration rollback is needed.
