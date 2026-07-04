# UI/UX 优化重构

## Goal

Refactor the Tauri/Vue UI into a consistent, dense, work-focused desktop experience for JobPilot/Job-Sync without changing user-visible business behavior.

## User Value

- Users can scan collection, job library, resume, settings, and export workflows with less visual noise.
- Shared controls and panels feel like one product instead of several historical visual systems.
- The UI remains efficient for repeated desktop work and does not trade density for decorative layout.

## Confirmed Facts

- Frontend stack is Vue 3 + Vue Router + Tailwind CSS + Lucide icons.
- App shell already uses a sidebar, route-level content panel, shared `ui-*` utility classes, and light-mode tokens.
- `ui-ux-pro-max` design-system search recommended a dense dashboard / operations style: compact data visibility, clear hover/focus states, restrained motion, route/feature splitting, and WCAG AA contrast.
- Current UI has multiple visual languages:
  - Global workbench classes use 8px-ish panels and restrained borders.
  - Resume-specific classes use large rounded corners, gradients, shadows, and negative tracking.
  - Export page still uses older dark translucent classes that do not match the current light surface system.
  - Some Settings diagnostic badges use light text colors intended for dark backgrounds on a light interface.
- Tailwind theme defines `surface.DEFAULT`, `surface.alt`, and `surface.elevated`, but several templates reference `bg-surface-secondary/*`, which is not a configured semantic token.

## Requirements

- Keep all routes, commands, forms, model state, IPC payloads, and saved data behavior unchanged.
- Consolidate the visual system around a compact light desktop workbench:
  - consistent panel/card radius at 8px or less for common tool surfaces;
  - semantic color tokens for surfaces, muted backgrounds, borders, text, success/warning/danger;
  - visible focus states and clear disabled states;
  - Lucide or existing SVG icons for actions where useful;
  - no decorative gradients/orbs/bokeh and no marketing-style hero layout.
- Improve scan density and hierarchy for the main workflows:
  - app shell and navigation;
  - crawl runtime/configuration surfaces;
  - job library filters/list/detail/modal;
  - resume library list/editor/preview/link modal;
  - settings diagnostics/configuration;
  - export page.
- Replace stale or undefined visual classes with project tokens or shared `ui-*` classes.
- Respect reduced-motion and avoid layout-shifting animations.
- Preserve responsive behavior at desktop and narrow widths; no incoherent text overlap or horizontal scrolling in primary pages.

## Acceptance Criteria

- [ ] `npm run build` succeeds.
- [ ] Browser smoke test opens the app and verifies primary pages render non-empty.
- [ ] Desktop and mobile/narrow screenshots show no obvious overlap, clipped button labels, or horizontal overflow in the app shell and key pages.
- [ ] Export, Settings diagnostics, shared selects/action menus, resume surfaces, and job detail surfaces use the same light workbench visual language.
- [ ] Interactive controls keep visible hover/focus/disabled states and minimum practical hit areas.
- [ ] No business logic, IPC contracts, route paths, or persisted data formats are changed.

## Out of Scope

- Redesigning product flows or changing IA beyond visual hierarchy and layout density.
- Adding new dependencies or switching component libraries.
- Changing database, Rust IPC contracts, crawler behavior, or AI logic.
- Introducing dark mode in this task.

## Open Decision

- Confirm whether to proceed with the recommended broad but behavior-preserving UI consolidation across all current pages.
