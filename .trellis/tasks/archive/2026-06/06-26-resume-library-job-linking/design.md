# Design: Resume Library And Job Linking

## Scope

This task replaces the user-facing resume workspace entry with a dedicated resume library page. The first implementation keeps storage local-first and builds on the existing Tauri JSON resume workspace infrastructure where useful, while changing the product model to resumes, default resume, and job resume links.

## Current Facts

- The app is Vue 3 + Tauri with local JSON storage for resume workspaces under `resume-workspaces/`.
- `src-tauri/src/resume_workspaces.rs` already supports multiple workspace records, draft persistence, titles, final resume text, and a legacy `linked_job_id` field.
- Existing `get_final_resume_text_for_job()` resolves the newest workspace linked to a job and is already used by AI greeting generation.
- Settings still stores `ai_resume_text` and `ai_resume_files`, and settings UI exposes pasted resume text through `AiProfileInputs`.
- Current router no longer imports `ResumeWorkspace.vue` in the visible routing table, while `src/App.vue` still has a `简历优化` nav item pointing at `/resume-workspace`.
- There are existing dirty changes from the previous "remove AI recompute current page" request; this task should not revert them.

## Product Model

### Resume Library

The resume library is the only user-facing resume management page. It shows a list of resumes, a detail/editor surface, and relation controls.

Suggested page name: `简历库`.

### Resume

A resume has:

- `id`
- `title`
- Markdown body text
- `created_at`
- `updated_at`
- `is_default`
- linked job summaries

Implementation can initially map Markdown body to `ResumeWorkspaceDraft.original_resume_text` and keep richer draft fields available for future resume optimization. The UI should not require users to understand workspace internals.

### Default Resume

The default resume is manually selected by the user. It is the fallback when a job has no job resume link.

Default resolution order for resume-aware actions:

1. Explicit resume text/files passed by the caller.
2. Job resume link.
3. Default resume.
4. No resume available, return a clear user-facing error.

### Job Resume Link

Each job has at most one primary linked resume. A resume can link to many jobs.

The storage layer should make this invariant explicit. The current draft-level `linked_job_id` allows one workspace to point at one job and multiple workspaces to point at the same job. The new model needs the inverse relation:

- Resume -> many job IDs for detail display.
- Job ID -> one resume ID for resolution.

Use a dedicated link map in the resume library index or a small adjacent JSON file rather than embedding a single `linked_job_id` in the draft.

## Storage Direction

Use local JSON in the same storage family as existing resume workspaces for the first slice.

Recommended shape:

```json
{
  "active_resume_id": "resume-...",
  "default_resume_id": "resume-...",
  "resumes": [
    {
      "id": "resume-...",
      "title": "后端工程师基础版",
      "created_at": "...",
      "updated_at": "...",
      "source_name": "Markdown 简历",
      "has_final_resume": false
    }
  ],
  "job_links": {
    "encrypt-job-id": "resume-..."
  }
}
```

Resume bodies can remain one JSON file per resume, using the existing `ResumeWorkspaceDraft` shape or a narrower new `ResumeDraft` shape. If reusing `ResumeWorkspaceDraft`, expose only title/body/default/link concepts in the library UI and keep module-diagnosis fields as internal compatibility.

No automatic migration from old `resume-workspace.json`, old workspace index, or settings `ai_resume_text` should run.

## Backend Contracts

Add or adapt Tauri commands around a resume-library vocabulary:

- `get_resume_library_state`
- `create_resume`
- `update_resume`
- `delete_resume`
- `set_default_resume`
- `link_resume_to_jobs`
- `unlink_resume_from_job`
- `get_resume_for_job` or `get_resume_status_for_job`

Existing commands may remain temporarily for internal compatibility, but page code should use resume-library names.

Resume resolution helper should replace `get_final_resume_text_for_job()` with a more general helper:

- resolve explicit input first
- then linked resume body/final text
- then default resume body/final text

For existing greeting generation, update the helper to use job link and default resume before settings resume text. Settings fallback may be removed from the UI but can remain as a final compatibility fallback only if it does not contradict "简历库是唯一入口"; if retained, do not advertise it.

## Frontend Design

### Navigation

- Add `/resume-library` route.
- Main nav label: `简历库`.
- Replace `/resume-workspace` as the main nav target.
- Route `/resume-workspace` should redirect to `/resume-library` to avoid dead old links.

### Resume Library Page

Operational layout, not a landing page:

- Left/list section: resume rows with title, default marker, updated time, linked job count, actions.
- Main/detail section: title input, Markdown textarea, save action, default toggle/action, linked jobs list.
- Top command row: new resume, save, delete, set default.
- Empty state: short copy plus new resume button.

### Link Jobs Modal

The association flow starts from a resume:

- Click `关联岗位`.
- Modal loads recommended jobs from the existing candidate query path.
- Select one or more jobs.
- Save creates links from selected job IDs to the current resume ID.
- If a selected job is already linked to another resume, overwrite to this resume and show this behavior in copy.

### Jobs Page Integration

Job cards should show resume link state:

- Linked: resume title plus a button to open resume library with `resumeId` query and highlight/select that resume.
- Unlinked: action to open resume library for linking, or a compact "关联简历" action if the link modal is easy to reuse.

Route query shape:

- `/resume-library?resumeId=...`
- optionally `/resume-library?jobId=...` to prefilter or open linking for a specific job later.

## Compatibility And Migration

- Do not auto-create a resume from old settings or old workspace data.
- Do not delete old local files during this first implementation; leave them inert for rollback.
- Existing resume PDF / diagnosis / rewrite internals can be reused after a resume is selected, but not required for the first Markdown-library MVP unless already trivial.
- If settings still returns `ai_resume_text`, the settings page should stop exposing that as the primary editor.

## Rollback

- Restore nav and route target to the previous resume workspace.
- Leave new resume-library JSON files unused.
- Revert greeting resume-resolution helper to the previous linked-workspace/settings fallback.

## Risks

- Reusing `ResumeWorkspaceDraft` may leak old workspace concepts into UI if not carefully hidden.
- Deleting a default resume needs a fallback rule: clear default and require the user to choose another, rather than silently picking one.
- Job link overwrite must be explicit enough that users understand a job can only point to one resume.
