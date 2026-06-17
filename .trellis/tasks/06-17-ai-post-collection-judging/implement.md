# Implementation Plan

1. Add worker protocol and mode for AI post-collection judgement.
2. Add Rust protocol payload type and Tauri command to run AI judgement for selected jobs or a limited batch.
3. Add merge logic that preserves hard-rule filtered results and lets AI choose bucket for soft judgement.
4. Add frontend trigger on Jobs page / Crawl config where existing recompute action lives.
5. Update job item display to show AI judgement summary.
6. Validate with:
   - `npm run build`
   - Rust tests for hard-rule precedence and AI result merge
   - Worker tests for schema normalization

## Risk Points

- AI calls can be slow or fail; command must surface clear errors and preserve existing deterministic results.
- Low confidence should route to pending confirmation, not filtered.
- No automatic per-job AI storm on every collection in the first MVP.

