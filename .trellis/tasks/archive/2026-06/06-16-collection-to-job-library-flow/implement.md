# Implement: Collection To Job Library UI Refactor

## Checklist

1. Add shadcn-style local Vue/Tailwind primitives where useful.
2. Refactor `/crawl-config` structure:
   - collection intent summary
   - explicit platform adapter section
   - post-collection rule groups
   - lifecycle actions for save/default/recompute
3. Refactor `/jobs` structure:
   - result bucket segmented control
   - operational summary
   - filter bar integrated with bucket model
   - clear empty states and filtered-job explanation copy
4. Keep existing actions wired:
   - collection intent sync
   - Boss/V2EX settings
   - save/default/recompute profile
   - job actions and AI/resume navigation
5. Run verification:
   - `npm run build`
   - if build succeeds, run a local browser smoke against `npm run dev`
   - inspect `/crawl-config` and `/jobs` desktop and mobile widths

## Validation Notes

- This is a frontend UI refactor. It should not require Rust or worker behavior changes in the first slice.
- If TypeScript errors reveal existing unrelated dirty work, inspect before changing and avoid reverting user changes.
- Browser smoke must verify pages render nonblank and controls do not overlap.

## Risk Points

- `useJobsPage` has many existing behaviors; avoid rewriting it unless needed for bucket state.
- Do not remove controls that are still wired to existing profile fields.
- Avoid claiming backend filtered-bucket support if current query APIs do not expose it.
