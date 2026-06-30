# Job-Specific Optimized Resume Implementation Plan

## Checklist

- [x] Read task PRD and design before coding.
- [x] Read relevant Trellis specs and cross-layer guide.
- [x] Inspect current resume library, job card, AI worker, and Tauri command patterns.
- [x] Add worker protocol payload for `AI_OPTIMIZE_RESUME_FOR_JOB`.
- [x] Add Rust IPC protocol payload for `AiOptimizeResumeForJob`.
- [x] Add worker result schema for optimized resume output.
- [x] Add prompt builder `buildResumeOptimizePrompts`.
- [x] Add worker mode `runAiOptimizeResumeForJobMode`.
- [x] Register worker mode in `packages/boss-crawler-worker/src/modes/ai.ts` and `src/main.ts`.
- [x] Add Rust command `generate_optimized_resume_for_job`.
- [x] Resolve source resume by explicit id, linked resume, then default resume.
- [x] Load job detail and AI context using existing helpers.
- [x] Register the Tauri command in `src-tauri/src/commands/ai.rs` and `src-tauri/src/lib.rs`.
- [x] Add frontend types for optimized resume result.
- [x] Add `useJobsPage` state/actions for generation, preview, copy, save, and link.
- [x] Add job-card action to trigger generation.
- [x] Add preview modal in `Jobs.vue`.
- [x] Use existing `createResume` and `linkResumeToJobs` APIs for save-and-link.
- [x] Refresh resume status after save-and-link.
- [x] Add worker tests for prompt and schema.
- [x] Add Rust tests for resume resolution and missing resume error.
- [x] Add contract tests for UI entry, command wiring, no `/resume-workspace`, and no auto apply/send.
- [x] Run quality checks and update docs/specs only if new stable conventions are learned.

## Suggested Files

Worker:

- `packages/boss-crawler-worker/src/protocol.ts`
- `packages/boss-crawler-worker/src/ai/prompt.ts`
- `packages/boss-crawler-worker/src/modes/ai/schemas.ts`
- `packages/boss-crawler-worker/src/modes/ai/resumeOptimize.ts`
- `packages/boss-crawler-worker/src/modes/ai.ts`
- `packages/boss-crawler-worker/src/main.ts`
- `packages/boss-crawler-worker/test/ai-contract.test.ts`

Rust:

- `src-tauri/src/ipc/protocol.rs`
- `src-tauri/src/commands/ai.rs`
- `src-tauri/src/commands/ai/optimized_resume.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/resume_library.rs` only if existing public helpers are insufficient.

Frontend:

- `src/lib/useJobsPage.ts`
- `src/lib/resumeLibrary.ts` if result types are better shared there.
- `src/components/jobs/JobsJobItem.vue`
- `src/pages/Jobs.vue`
- `src/lib/jobs.ts` if a shared result type belongs with job UI types.

Tests:

- `packages/boss-crawler-worker/test/ai-contract.test.ts`
- `test/review-workflow-contract.test.js`
- Rust module tests under the new command file.

## Validation Commands

```bash
npm -w @job-sync/boss-crawler-worker run test
node --test test/review-workflow-contract.test.js
cargo test --manifest-path src-tauri/Cargo.toml optimized_resume
npm run test:worker
```

Completed checks:

- `npm -w @job-sync/boss-crawler-worker run test` passed.
- `npm run test:review-workflow` passed.
- `cargo test --manifest-path src-tauri/Cargo.toml optimized_resume` passed with existing dead-code warnings outside this feature.
- `npm run build` passed.
- Browser smoke for `/jobs` passed at desktop and 390px mobile widths with no console errors or horizontal overflow.

## Risk Points

- AI may fabricate unsupported experience unless prompt and schema make evidence/risk explicit.
- Saving must not overwrite the original resume.
- The feature must not recreate old Resume Workspace routes or commands.
- The modal should keep generated Markdown available if save/link fails.
- Large resumes and job details may increase token usage; MVP accepts this but should keep prompt concise.
- Existing dirty worktree files must be preserved and not reformatted unnecessarily.

## Rollback Point

This is additive. If implementation becomes risky, keep only worker/prompt experiments behind unused code or remove the new UI action and command registration. Existing resume library records remain compatible because saved optimized resumes are normal resumes.
