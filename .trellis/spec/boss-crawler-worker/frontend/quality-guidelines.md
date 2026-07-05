# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

- Do not use app-wide `<KeepAlive>` around heavy route pages such as the jobs
  library or resume library. These pages create large DOM and accessibility
  trees from real user data; global route caching preserves that tree and can
  make sidebar navigation feel blocked while WebView restores it.
- Do not put full document bodies, raw job payloads, or large evidence JSON into
  list-row response models unless the list view renders that exact field. Use a
  summary/list item type for collections and fetch the selected record/detail on
  demand.
- Do not make every row component parse large JSON just to render badges or
  short labels. Compute stable row summary fields in the command/API layer, and
  keep full JSON for detail drawers, confirmation dialogs, and evidence views.

---

## Required Patterns

- Split heavy widgets out of primary route shells. Primary sidebar targets that
  users click repeatedly, such as crawl execution and crawl configuration,
  should keep their route shell cheap; move expensive editors/widgets into
  async components instead of making the user wait on them during the route
  click. Heavier non-primary pages may still use Vue Router dynamic imports.
- Do not auto-mount heavy optional editors in primary route shells with timers
  after the first paint. If an editor is not required for the default read path
  (for example the crawl schedule visual cron editor), keep a lightweight input
  visible and mount the async editor only after an explicit user action.
- Use route-level dynamic imports for page components in `src/router.ts` when a
  page owns substantial state or dependencies. Preserve existing route paths
  and redirects while letting Vite split pages into separate chunks.
- Route components with timers or polling must clean them up on unmount. If a
  page also supports `<KeepAlive>`, clean up in both `onDeactivated` and
  `onUnmounted`.
- List/detail APIs should use explicit contracts:
  - list item: ids, titles, timestamps, counts, status labels, short summaries;
  - selected/detail record: full Markdown/body/raw evidence/detail payload.
- If a row needs an AI/filter badge, expose fields such as
  `ai_audit_status` and `ai_audit_summary` from the backend row mapper instead
  of deriving them repeatedly in each rendered row.

---

## Testing Requirements

- After fixing a user-visible bug, do not stop at code review, type-check,
  compilation, or unit tests. Run at least one functional simulation through
  the real software path that users exercise, such as a desktop/browser flow,
  a Tauri command path, or the actual worker stdin/stdout command loop. The
  handoff must state the simulated action and the observed user-facing result.
- Add contract tests when changing route caching, list/detail payload shape, or
  row-summary fields. Tests should assert that heavy list item types do not
  contain full bodies and that heavy route pages are not globally cached.
- For performance fixes, include a real-data observation in the handoff or final
  response: database row counts, largest relevant payload sizes, and which layer
  was measured as the bottleneck.
- For route-click performance fixes, include a repeatable browser or desktop
  measurement command with before/after p50 and p95 timings. Browser-only
  measurements must be labeled as frontend route/render coverage, not Tauri IPC
  coverage.

---

## Code Review Checklist

<!-- What reviewers should check -->

- Does the change keep large Markdown, raw job payloads, and evidence JSON out
  of list hot paths?
- Does the page destroy or clean up heavy DOM/timers when leaving the route?
- Are status badges and short labels backed by lightweight response fields
  rather than per-row JSON parsing?
- For bug fixes, is there a functional simulation result from the real user
  path, not only compile/unit-test output?

(To be filled by the team)
