# Design

## Boundaries

- Frontend plus the minimal sidecar/Tauri data path needed for V2EX public Feed collection. Keep the current Boss worker payload compatible.
- The collection page owns collection intent, collection source selection, Boss platform settings, and run controls.
- The existing filter profile state remains the post-collection candidate filter and stays persisted in the existing profile JSON format.
- Settings shows platform capabilities, enablement controls, and reserved platforms. Boss login is exposed on the Boss row by reusing the current login command; V2EX shows public-feed collection with no login; reserved platforms show login as not implemented yet.

## Data Flow

1. User edits collection intent fields.
2. User clicks "sync to platform settings".
3. Frontend maps intent into Boss platform settings using best-effort mapping.
4. Platform settings produce the `crawl_auto_start` payload shape:
   - `source_platform`
   - `keywords`
   - `filters.city/salary/experience/degree/industry/scale`
   - `limits.maxPages/maxJobs/delayMs`
   - `filters.profile`
5. Boss worker continues to collect jobs and emit existing events when `source_platform = "boss"`.
6. V2EX worker mode fetches the public Atom feed when `source_platform = "v2ex"`, emits source-normalized job events, and skips clear non-job discussions.
7. Filter profile remains post-collection and controls candidate eligibility/ranking, not raw job library persistence.

## Collection Intent Mapping

- Keywords and tech stack terms expand Boss keywords by OR semantics.
- Target cities map to the first matching Boss city option when available. Remaining values are reported as unmapped.
- Degrees map to the first matching Boss degree option when available. Remaining values are reported as unmapped.
- Salary range, experience range, work modes, and excluded keywords are intentionally reported as unmapped for Boss until reliable enum/range mapping is implemented.
- Existing Boss direct filter fields remain available inside a collapsible Boss section for manual adjustment.
- V2EX maps collection intent to feed-local matching only. Keywords and tech stack terms are OR matches over title/content; excluded keywords skip entries before入库; work modes, city, salary, experience, and degree stay as post-collection filter-profile signals until reliable extraction is implemented.

## UI Shape

- Boss login status is labeled as Boss-specific.
- Automatic collection shows:
  - collection intent section
  - collection source selection, initially Boss and V2EX when enabled
  - sync button and sync result
  - collapsible Boss collection settings
  - collapsible V2EX feed settings when V2EX is selected
  - collapsible post-collection filter profile
  - limits
- Settings source model becomes platform capability management:
  - Boss: collectable / supports browser-session automatic collection
  - V2EX: collectable / supports public Feed automatic collection
  - other manual-import platforms: reserved for automatic collection
- Platform enablement is persisted through the `job_sources.enabled` column. Migrations must preserve user enable/disable choices rather than resetting them to adapter defaults.
- Platform login belongs in Settings beside each platform. The collection page may still fail fast if Boss is not logged in, but it should not be the primary login surface.

## Compatibility

- Stored filter profiles remain compatible.
- Existing Boss automatic collection command remains compatible.
- V2EX uses the same sidecar event stream and SQLite `job` table. Its normalized event is distinct from Boss list/detail payloads to avoid making Boss parsers understand feed data.
- Existing manual collection remains unchanged.

## Rollback

- Revert `src/lib/useCrawlPage.ts`, `src/pages/Crawl.vue`, `src/pages/CrawlConfig.vue`, `src/components/ui/UiMultiSelect.vue`, and `src/pages/Settings.vue`.
- Revert V2EX worker mode/protocol and Tauri normalized feed job upsert additions.
- Revert `set_job_source_enabled` command changes if platform enablement persistence is rolled back.
- `CONTEXT.md` and Trellis task artifacts can remain as product notes if implementation is rolled back.
