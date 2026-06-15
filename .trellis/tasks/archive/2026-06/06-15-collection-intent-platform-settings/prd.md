# Refactor collection intent and platform settings

## Goal

Reshape the collection workflow so users can express a platform-neutral collection intent, sync that intent into runnable platform-specific collection settings, and keep post-collection filtering separate from collection setup.

The immediate user value is to avoid a Boss-shaped collection page before multi-platform collection exists. Users should understand which settings define this collection run, which settings belong to Boss, and which rules are post-collection candidate filtering.

## Confirmed Facts

- Current automatic collection is implemented for Boss only before this increment.
- V2EX already exists as a platform in the unified source list, but before this increment it is only a manual-import source.
- V2EX jobs exposes a public Atom feed at `https://www.v2ex.com/feed/tab/jobs.xml`; entries include title, link, published/updated time, author, and HTML content.
- V2EX jobs tab contains both recruiting posts and career/interview discussions, so source collection must identify obvious job postings before writing into the job library.
- The current global login status is really Boss Cookie + LocalStorage readiness.
- Existing filter profiles are post-collection rules over the unified job model. They should decide candidate eligibility, ranking, review queues, and Top 20 style flows, not whether raw jobs enter the job library.
- `CONTEXT.md` defines the product terms for collection intent, platform collection settings, collection intent sync, platform enablement, platform login state, collection source selection, allowed candidate sources, collectable platform, and reserved platform.

## Requirements

- The collection page must distinguish collection intent from filter profile.
- Collection intent must support broad sample expansion before collection. Multi-value collection intent fields use OR semantics by default; hard AND requirements belong in the filter profile.
- Initial collection intent fields:
  - keywords as multiple values
  - target cities as multiple values
  - work modes as multiple values
  - tech stack terms as multiple values
  - excluded keywords as multiple values
  - degrees as multiple values
  - salary range
  - experience range
  - max jobs, max pages, and delay
- The collection page must provide an explicit sync action from collection intent to platform collection settings.
- Sync must use best-effort platform mapping: map what a platform supports, expose unmapped fields, and do not silently pretend unsupported fields were applied.
- Sync must not live-bind or silently overwrite platform settings after the user adjusts them.
- Initial collection source selection must show only collectable platforms. Boss and V2EX are collectable after this increment; other non-Boss platforms remain reserved/manual-import.
- Boss platform settings must be shown as a collapsible platform-specific section, not as the primary generic collection model.
- The collection page must not present a single global login state. It should make clear that the current runnable login state is Boss-specific.
- Settings must represent platforms as capabilities:
  - Boss can be enabled, logged in, and diagnosed.
  - V2EX can be enabled and collected from the public jobs feed without login.
  - Reserved platforms can be visible as not yet supporting automatic collection, but must not appear as runnable collection choices.
- Settings must provide the platform enable/disable control. Platform login should live beside each platform in Settings; Boss uses the current login command, reserved platforms show login as reserved.
- The filter profile UI/wording should not use "source platform" ambiguously. In filter profile context, it should read as allowed candidate sources or equivalent post-collection wording.
- Jobs collected by a platform should still enter the job library even if the active filter profile later rejects them from candidate queues.
- V2EX collection must skip entries classified as discussion or unknown rather than polluting the job library.
- V2EX entries that pass source-level job-posting detection must write into the unified job model with `source_platform = "v2ex"` and a stable topic-id based dedup key.

## Acceptance Criteria

- [ ] Automatic collection UI has a "collection intent" area with the initial fields above.
- [ ] Boss-specific search settings are in a collapsible Boss platform section.
- [ ] A sync action maps collection intent into the Boss section and shows unsupported/unmapped intent fields.
- [ ] Collection source selection includes enabled collectable platforms: Boss and V2EX.
- [ ] The login panel no longer reads as global login; it is Boss-specific or platform-status based.
- [ ] Settings page shows platform capability status clearly, with Boss browser-login collection, V2EX public feed collection, and other platforms reserved/not implemented for automatic collection.
- [ ] Settings page lets users enable/disable each platform and exposes Boss login/refresh actions on the Boss platform row.
- [ ] Filter profile source wording is separated from collection source selection wording.
- [ ] Existing automatic Boss collection still starts with a payload compatible with the current worker.
- [ ] V2EX automatic collection starts without Boss login state, reads the public jobs Atom feed, skips clear discussion posts, and writes job postings into the unified job library.
- [ ] Existing filter profile persistence remains compatible with stored profile JSON.
- [ ] Frontend build/type-check passes.
- [ ] Browser smoke test confirms the collection page renders the new sections and sync behavior.

## Notes

- User explicitly approved creating a Trellis task and moving into development.
- Existing uncommitted changes before this task included a shallow source-platform multiselect change in `src/pages/Crawl.vue` / `src/lib/filterProfile.ts`, a `CONTEXT.md` glossary, and a `src/pages/Settings.vue` helper that treats empty JSON config as default. Work should reconcile those changes instead of reverting them blindly.
