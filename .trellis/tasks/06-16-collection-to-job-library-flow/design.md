# Design: Collection To Job Library UI Refactor

## Scope

This implementation refactors the product UI for the path from automatic collection to the job library. It does not rewrite the canonical collection or filter engines in this pass.

The first implementation slice focuses on:

- `/crawl-config`: make the page read as Collection intent plus post-collection decision rules, instead of a keyword-heavy profile editor.
- `/jobs`: make the page read as a shadcn-style job-library workbench with explicit result buckets.
- Shared local UI primitives and CSS tokens that follow shadcn component language in Vue/Tailwind.

## Current Facts

- The project is Vue 3 + Tailwind + Tauri, not React.
- The shadcn registry is visible, but the repository has no `components.json` and no generated shadcn component files.
- Existing UI already uses local class utilities such as `ui-panel`, `ui-btn-primary`, `ui-input`, and `ui-textarea`.
- The current data model already stores unified jobs in `job`, including `jd_text`.
- Current canonical post-collection filtering writes `job_filter_result`.
- `sourcePlatforms` in the Filter profile means allowed candidate sources after jobs are already in the library. It must not become a pre-ingest collection gate.

## UI Direction

Use shadcn as a design language rather than importing React shadcn components:

- restrained panels, cards, alerts, badges, separators, segmented controls, and icon buttons
- compact operational density suitable for repeated job-review work
- clear hierarchy around “search broadly, decide after persistence”
- no landing-page hero treatment
- no decorative nested cards

## Page Model

### Crawl Config

The page is reorganized into these bands:

1. Collection intent
   - Broad search inputs.
   - Copy explains that values expand platform search and do not define final eligibility.
   - Selected collectable platforms stay visible.

2. Platform adapters
   - Boss and V2EX settings remain platform-specific.
   - Sync action remains explicit.
   - Reserved/manual-only platforms stay out of runnable choices.

3. Post-collection rules
   - Renames “筛选画像” to “采后判断规则”.
   - Groups rules by user outcome:
     - deal breakers
     - must-have evidence
     - preferences
     - source/status controls
     - uncertainty handling
   - Field labels mention JD/detail/post content where current evaluator already uses full search text.

4. Recompute / persistence controls
   - Save, set default, and recompute remain visible but read as rule lifecycle controls.

### Jobs

The page is reorganized into these result buckets:

- 推荐查看: default actionable candidate view.
- 待确认: UI bucket for uncertain/incomplete jobs. In this first slice it may use the same data source plus explanation copy until backend bucket support exists.
- 已过滤: filtered / not recommended jobs surface. If backend filtered query support is not currently exposed to the page, represent this as a planned empty state and keep the UI contract ready.
- 已处理: reviewed or terminal jobs.
- 全部入库: library-style historical view.

The first UI implementation may map buckets to existing query/filter controls where possible. New backend query contracts should only be introduced if required to avoid fake data.

## Data Flow

```
Collection intent UI
  -> explicit sync to platform collection settings
  -> crawl_auto_start per selected collectable source
  -> unified job write in SQLite
  -> default Filter profile recompute
  -> job library result bucket display
```

No UI copy should imply that filtered jobs are discarded before persistence.

## Compatibility

- Existing settings and stored profile JSON remain compatible.
- Existing labels in persisted data do not need migration.
- This pass does not remove existing fields; it reorganizes and relabels them.
- Existing AI analysis, reports, resume workspace, greeting, and application readiness actions remain accessible from job cards.

## Deep Module Candidates

- A local UI primitive layer under `src/components/ui/` for shadcn-style `UiCard`, `UiBadge`, `UiTabs`, `UiAlert`, and `UiField`.
- A job-library bucket helper in `src/lib/useJobsPage.ts` or a nearby helper module, so the page does not scatter bucket labeling and filter mapping.

## Rollback

Rollback is limited to UI files and task planning artifacts in this slice. Data persistence and worker behavior should remain unchanged.
