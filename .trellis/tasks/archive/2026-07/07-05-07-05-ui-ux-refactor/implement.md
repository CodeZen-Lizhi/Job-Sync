# UI/UX Refactor Implementation Plan

## Checklist

- [x] Load frontend pre-development guidelines before editing.
- [x] Normalize Tailwind tokens and shared `ui-*` component classes.
- [x] Update app shell spacing/surface treatment while preserving navigation behavior.
- [x] Refactor stale visual classes in `Export.vue`.
- [x] Fix Settings diagnostic/status contrast and section surface consistency.
- [x] Align Jobs filter/list/detail/modal visuals with shared tokens.
- [x] Align Crawl runtime/configuration surfaces and source chips.
- [x] Normalize Resume Library and resume-specific CSS away from oversized/ornamental styling.
- [x] Align shared select/action menu components.
- [x] Run build/typecheck.
- [x] Run browser smoke checks and screenshots for desktop plus narrow viewport.
- [x] Run final review pass for behavior drift, contrast, focus states, text overflow, and undefined Tailwind classes.

## Validation Commands

```bash
npm run build
npm run dev -- --host 127.0.0.1
```

Browser smoke pages:

- `/crawl`
- `/crawl-config`
- `/jobs`
- `/resume-library`
- `/settings`
- `/export`

## Risky Files

- `src/styles/tailwind.css`: shared primitives affect all pages.
- `src/components/ui/UiSelect.vue`, `src/components/ui/UiMultiSelect.vue`, `src/components/ui/UiActionMenu.vue`: overlays and focus behavior must be preserved.
- `src/pages/ResumeLibrary.vue`: state-heavy page; keep changes visual.
- `src/pages/Jobs.vue` and `src/components/jobs/JobsJobItem.vue`: dense interactive row controls; avoid behavior changes.

## Review Gates

- Diff should not include unrelated Rust, worker, database, or IPC changes.
- No new dependencies.
- No route, command, or payload contract changes.
- No secrets or local machine paths added to source.
- UI controls remain keyboard-focusable and disabled states remain semantic where currently present.
