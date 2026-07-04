# UI/UX Refactor Design

## Design Direction

Use a dense, work-focused light desktop workbench. The UI should feel like an operational tool for repeated scanning and decisions: quiet surfaces, consistent borders, compact controls, clear status colors, and readable data rows.

## Boundaries

- Frontend-only visual and component markup changes under `src/`.
- Shared Tailwind token and component-class changes may affect all pages and should therefore be conservative.
- No changes to composables, IPC command names, payload contracts, database schema, crawler logic, or AI behavior unless required to fix a UI-only bug caused by the refactor.

## Key Implementation Areas

### Foundations

- Extend Tailwind semantic tokens to include a real muted secondary surface (`surface.secondary`) so existing `bg-surface-secondary/*` references become intentional.
- Remove unused decorative animation tokens from `tailwind.config.ts` if they have no matching keyframes/usages.
- Normalize shared `ui-*` classes:
  - panels/cards: 8px radius, 1px border/ring, no heavy shadows;
  - controls: consistent min height, focus rings, disabled states;
  - status badges: readable light-mode foreground/background pairs.
- Add a reduced-motion media rule for any shared transition/transform effects that remain.

### App Shell

- Keep the existing sidebar route model.
- Tighten shell spacing and content sizing for dashboard use.
- Avoid a page-level card inside every route when the page already has its own panels if it creates nested-card visual weight. If retained, make it a neutral work surface.

### Pages

- `Export.vue`: replace legacy dark translucent classes with `ui-panel`, `ui-status-*`, and shared buttons.
- `Settings.vue`: fix diagnostic badge contrast, align section surfaces, and keep sensitive value masking unchanged.
- `Jobs.vue` / `JobsJobItem.vue`: keep filter/list behavior but improve row scanability, undefined background tokens, and modal surfaces.
- `ResumeLibrary.vue` and resume-specific CSS: reduce oversized radii, gradients, shadows, and negative tracking; keep markdown preview and modal behavior unchanged.
- `Crawl.vue` / `CrawlConfig.vue` / crawl components: align stats, logs, source chips, and schedule/config panels with shared workbench primitives.
- `UiSelect.vue`, `UiMultiSelect.vue`, `UiActionMenu.vue`: reduce style drift between variants while preserving menu positioning and keyboard/click behavior.

## Compatibility

- Route paths and redirects remain unchanged.
- The app remains light-mode only.
- Existing tests should continue to pass because behavior and contracts are unchanged.
- Tauri desktop behavior remains unchanged; browser mode warnings remain visible.

## Risks

- Shared CSS class changes can unintentionally alter dense pages. Mitigate with screenshot smoke checks across primary pages.
- Resume library has the most divergent visual language; keep edits in CSS utilities and template classes rather than rewriting the page state machine.
- Menu overlays use fixed positioning; visual changes must not break z-index or outside-click behavior.

## Rollback Shape

- CSS/token changes are isolated in `src/styles/tailwind.css` and `tailwind.config.ts`.
- Page-level visual changes are reversible per file.
- No data migration or persisted state rollback is required.
