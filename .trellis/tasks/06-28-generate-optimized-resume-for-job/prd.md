# 岗位版简历生成

## Goal

Let users generate a job-specific optimized Markdown resume from one collected job and one existing resume, preview the result, then optionally save it as a new resume and link it to the job.

## Background

Job Sync already has:

- A unified job library and candidate review flow.
- A resume library for Markdown resumes, default resumes, and one primary job-resume link.
- AI resume-vs-job matching with structured evidence and rewrite suggestions.
- AI greeting generation that can load job facts, linked/default resume text, and job AI context.

This feature should extend the existing resume library and job-card workflow. It must not restore the removed standalone Resume Workspace model or route.

## User Story

As a job seeker, I want to generate a tailored version of my existing resume for a specific job so that I can manually review, save, and use a stronger resume for that role without losing my original resume or inventing unsupported experience.

## Confirmed Facts

- `CONTEXT.md` defines "Resume library" as the dedicated page for creating, editing, deleting, and selecting resumes, and says to avoid "Resume workspace".
- `CONTEXT.md` defines one primary job resume link per job and a default resume fallback.
- `src/lib/resumeLibrary.ts` already exposes `createResume`, `linkResumeToJobs`, and job-resume status APIs.
- `src-tauri/src/resume_library.rs` persists Markdown resume records and supports resolving a linked/default resume for a job.
- `src-tauri/src/commands/ai/greeting.rs` already demonstrates loading job detail, linked/default resume text, latest resume match report, and AI context for a job.
- `packages/boss-crawler-worker/src/ai/prompt.ts` already has resume-job matching prompt patterns and strict anti-fabrication language.

## Requirements

- Add a "generate job-specific resume" capability from the job review surface.
- Use the selected job's facts and the job's linked resume; if no linked resume exists, use the default resume.
- If no linked/default resume exists, show a clear user-facing error and do not call AI.
- Generate a complete Markdown resume, not just suggestions or bullet fragments.
- Return a structured result that includes the Markdown resume, title, change summary, used job keywords, evidence mapping, and risks.
- Show a preview before writing anything to the resume library.
- Saving must create a new resume record; it must never overwrite the source resume in MVP.
- Saving should optionally link the new resume to the current job; MVP default is "save and link current job".
- Keep the original resume library and job-resume link model as the source of truth.
- Do not restore `/resume-workspace`, resume workspace commands, or automatic application/submission behavior.
- AI must be constrained to reorder, rewrite, and emphasize existing resume facts only. Missing job requirements must be reported as risks, not fabricated into the resume.
- Reuse existing OpenAI settings, worker command infrastructure, debug tracing, and JSON schema validation patterns.

## Acceptance Criteria

- [ ] A job card exposes an action to generate a job-specific optimized resume.
- [ ] The backend resolves the source resume in this order: explicit `resume_id`, linked resume for job, default resume.
- [ ] The backend returns an error when no usable resume is available.
- [ ] The worker command returns a strict JSON result with `title`, `optimized_resume_markdown`, `change_summary`, `job_keywords_used`, `evidence`, and `risks`.
- [ ] `optimized_resume_markdown` is non-empty Markdown and represents a complete resume.
- [ ] The UI previews the generated result before save.
- [ ] Save creates a new resume via the existing resume library path and does not mutate the source resume.
- [ ] Save-and-link associates the new resume with the current job via the existing job-resume link path.
- [ ] The job card resume status refreshes after save-and-link.
- [ ] Prompt/test coverage verifies that the AI is told not to fabricate facts.
- [ ] Contract coverage verifies that `/resume-workspace` is not restored and no auto-apply/send flow is introduced.

## Notes

- MVP is single-job, single-resume, Markdown-only.
- PDF/DOCX export, batch generation, overwrite-in-place, and multi-turn resume editing are explicitly out of scope.
