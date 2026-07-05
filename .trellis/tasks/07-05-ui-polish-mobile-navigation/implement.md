# Implementation Plan

## Checklist

- [x] Load frontend specs with `trellis-before-dev` before editing.
- [x] Re-read target files before each edit:
  - `src/App.vue`
  - `src/styles/tailwind.css`
  - `src/components/ui/UiSelect.vue`
  - `src/components/ui/UiMultiSelect.vue`
  - `src/components/ui/UiActionMenu.vue`
  - `src/pages/Settings.vue`
- [x] Update global visual tokens and shared component primitives.
- [x] Refactor app shell so mobile no longer renders the full sidebar before content.
- [x] Increase primary control target sizes while keeping dashboard density acceptable.
- [x] Fix Settings Model field label/accessibility.
- [x] Run formatting/build validation.
- [x] Run browser screenshot smoke for desktop and mobile routes.
- [x] Review diff for accidental business-logic changes, raw color sprawl, text overflow risk, and regressions in focus/disabled states.

## Validation Commands

```bash
npm run build
```

Browser smoke will use the existing local Vite server plus headless Chrome because the project does not include Playwright as a dependency:

```bash
npm run dev -- --host 127.0.0.1
```

Then run a temporary Node/CDP script outside project source to capture screenshots and audit:

- horizontal overflow
- console errors
- h1 count
- unlabeled visible form fields
- unnamed visible buttons
- small interactive targets

## Risk Points

- Mobile navigation changes can accidentally hide routes or make current-route state unclear.
- Raising control heights can make dense settings/config pages feel too tall.
- Global token changes can affect every page; screenshots are required after implementation.
- Custom select/menu components use fixed positioning and z-index; menu layering should still work over panels and modals.

## Rollback Points

- If global token changes make too many pages regress, revert `src/styles/tailwind.css` first and keep only structural mobile navigation fixes.
- If mobile navigation behavior feels risky, keep desktop sidebar untouched and limit mobile change to CSS/template branching in `src/App.vue`.
