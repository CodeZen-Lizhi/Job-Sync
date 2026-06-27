# Implement: Resume Library And Job Linking

## Preconditions

- Keep existing unrelated dirty work intact.
- Before editing code, run `trellis-before-dev` and read relevant frontend/shared specs.
- Java review is not needed unless Java files are touched.

## Checklist

1. Backend model and storage
   - Add a resume-library storage layer or adapt `resume_workspaces.rs` with resume-library concepts.
   - Add explicit `default_resume_id`.
   - Add explicit `job_links: job_id -> resume_id` relation.
   - Keep one job linked to at most one resume.
   - Do not migrate old workspace/settings resume text into the new library.

2. Backend commands
   - Add Tauri commands for list/state, create, update, delete, set default, link/unlink jobs.
   - Add status lookup for Jobs page display.
   - Add helper for resolving a resume for a job:
     - explicit request input
     - linked resume
     - default resume
     - none with clear error

3. Existing AI resume consumers
   - Update greeting generation to use linked resume first and default resume second.
   - Keep explicit caller-supplied resume text/files highest priority.
   - Avoid advertising settings resume text as an active editing source.

4. Frontend library API
   - Add `src/lib/resumeLibrary.ts` for typed Tauri contracts.
   - Add `src/lib/useResumeLibraryPage.ts` for page state and commands.
   - Avoid exposing legacy workspace names in new frontend contracts.

5. Resume library page
   - Add `src/pages/ResumeLibrary.vue`.
   - Implement empty state, list, editor, save, delete confirmation, set default.
   - Implement linked jobs list and jump back to Jobs page.
   - Implement route selection/highlight by `resumeId`.

6. Link jobs modal
   - Reuse existing job candidate query path where possible.
   - First version should show recommended-view jobs.
   - Support selecting multiple jobs and saving links to the current resume.
   - Make overwrite behavior clear when a job already has another linked resume.

7. Navigation and routing
   - Add `/resume-library`.
   - Replace main nav label/target with `简历库`.
   - Redirect `/resume-workspace` to `/resume-library`.
   - Remove Settings page resume text editing entry from the primary UI path.

8. Jobs page integration
   - Display linked resume status on job rows/cards.
   - Add action to jump to `/resume-library?resumeId=...`.
   - For unlinked jobs, provide a route/action that supports linking from the resume library.

9. Tests and verification
   - Add Rust tests for:
     - manual default resume
     - one job -> one resume link overwrite
     - one resume -> many jobs
     - delete resume clears default/link references
     - resume resolution falls back linked -> default
   - Add focused frontend contract/unit tests if the project has matching patterns; otherwise rely on build plus smoke.
   - Run `npm run build`.
   - Run targeted Rust tests for resume library/greeting helpers.
   - Browser smoke `/resume-library` and `/jobs` at desktop and mobile widths.

## Validation Commands

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml resume
```

If only frontend files change during an iteration:

```bash
npm run build
```

## Risk Points

- `src/lib/useJobsPage.ts` is large and currently has unrelated dirty edits; read diffs before editing.
- Settings still has resume fields in backend settings structs; remove or hide UI carefully without breaking deserialization.
- Existing route/query behavior for job-linked resume workspace should redirect rather than dead-end.
- Do not silently select a new default resume after deletion.

## Rollback Points

- Backend storage commands can be reverted without touching existing old workspace JSON.
- Router/nav changes can be reverted independently.
- Greeting fallback change should be isolated in a helper so it can be backed out cleanly.
