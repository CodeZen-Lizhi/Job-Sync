# Design

## Product Direction

JobPilot is a desktop-first productivity workstation for job collection, filtering, AI matching, and resume work. The target style for this iteration is refined operational UI: dense enough for repeated work, but with stronger brand presence, warmer surface hierarchy, cleaner mobile behavior, and more deliberate interaction states.

## Boundaries

### In Scope

- `src/App.vue`: global shell, desktop sidebar, mobile navigation, active route treatment.
- `src/styles/tailwind.css`: design tokens and shared component primitives.
- `src/components/ui/*`: select/menu trigger sizing and surface treatment.
- Targeted page-level fixes only when needed for known accessibility or visual bugs, starting with `src/pages/Settings.vue`.

### Out of Scope

- Business logic, IPC calls, persistence, sidecar code, Tauri commands.
- Full dark theme.
- New dependencies or UI framework migration.

## Visual System

- Keep a light workbench base, but move from flat white/gray to layered surfaces:
  - app background: subtle cool-tinted workbench field;
  - panels: clean white with low-opacity border and soft elevation;
  - important bars: warm alert / brand accent treatment;
  - active nav: dark ink surface with vivid blue accent.
- Keep semantic CSS variables as the source of truth. Avoid spreading new raw colors through page components.
- Use shadows sparingly but consistently. Current `box-shadow: none` everywhere makes the UI too flat.
- Avoid decorative orbs and oversized marketing effects. This is an operational tool.

## Navigation

- Desktop (`lg` and above): keep persistent left sidebar.
- Mobile/tablet below `lg`:
  - replace full expanded sidebar with a compact top app bar;
  - expose primary routes as a horizontally scrollable nav row or compact menu so page content appears in the first viewport;
  - keep each nav item labeled with an icon for discoverability;
  - ensure touch targets are at least 44px high.

## Controls

- Raise global button/input/icon button minimum height from 36px to about 44px.
- Keep small text only for metadata/badges; avoid using 10-11px text for primary interaction labels.
- Keep focus-visible rings, disabled opacity/cursor, and 150-200ms transitions.
- Keep custom select menus teleported with fixed positioning, but use a consistent z-index token and larger trigger height.

## Accessibility

- Preserve one visible `h1` per page.
- Preserve visible focus styles.
- Fix Settings Model input by using a real `label` or `aria-label`.
- Do not introduce icon-only interactive controls without accessible names.
- Browser smoke script must report no unlabeled visible fields for covered routes.

## Responsive Contract

- Desktop content stays constrained (`max-w-5xl` / `max-w-6xl`) unless page already opts wider.
- Mobile content gets stable gutters and no horizontal overflow.
- Mobile first viewport must show current page header and at least the beginning of page-specific content below navigation.

## Validation

- `npm run build`
- Headless browser smoke at `1440x1000` and `375x812` for:
  - `/#/crawl`
  - `/#/crawl-config`
  - `/#/jobs`
  - `/#/resume-library`
  - `/#/settings`
- Manual screenshot inspection for desktop and mobile routes.

## Rollback

The changes are isolated to frontend shell/style/component files. Rollback can be done by reverting the task commit or, during development, reverting the touched frontend files.
