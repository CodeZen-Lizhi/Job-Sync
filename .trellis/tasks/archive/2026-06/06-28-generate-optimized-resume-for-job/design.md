# Job-Specific Optimized Resume Design

## Product Shape

This feature belongs to the existing job review and resume library flows:

- Primary entry: a job card action named "生成岗位版简历".
- Secondary entry, optional after MVP: resume library linked-job list.
- Output handling: preview first, then save as a new resume and link to the current job.

It must not recreate a standalone Resume Workspace. The terms to use in UI and code are "optimized resume", "job-specific resume", or "岗位版简历".

## Data Flow

```text
JobsJobItem action
  -> useJobsPage.generateOptimizedResume(job)
  -> invoke("generate_optimized_resume_for_job")
  -> Rust loads job detail + resume + AI context
  -> worker AI_OPTIMIZE_RESUME_FOR_JOB
  -> frontend preview modal
  -> create_resume(title, optimized_resume_markdown)
  -> link_resume_to_jobs(new_resume_id, [encrypt_job_id])
  -> refresh job resume status
```

## Backend Command

Add a Tauri command:

```rust
generate_optimized_resume_for_job(
    app: AppHandle,
    encrypt_job_id: String,
    resume_id: Option<String>,
    context_text: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_mode: Option<String>,
    debug: Option<bool>,
) -> Result<Value, String>
```

Responsibilities:

- Resolve app data dir and OpenAI request settings.
- Load job detail raw JSON for the job.
- Load job AI context with filter, score, source, and review context.
- Resolve source resume:
  - explicit `resume_id`, if provided;
  - linked resume for the job;
  - default resume.
- Return a clear error if no resume exists.
- Send one worker command.
- Return the generated result only; do not save automatically.

Saving is intentionally left to existing commands:

- `create_resume(title, body)`
- `link_resume_to_jobs(resume_id, [encrypt_job_id])`

This keeps generation side-effect-free until the user confirms.

## Worker Command Contract

Add command:

```ts
AI_OPTIMIZE_RESUME_FOR_JOB
```

Payload:

```ts
{
  resume_text: string;
  job_detail: unknown;
  context_text?: string;
  filter_reason?: unknown;
  score_reason?: unknown;
  source_context?: unknown;
  review_context?: unknown;
}
```

Result:

```ts
{
  title: string;
  optimized_resume_markdown: string;
  change_summary: string[];
  job_keywords_used: string[];
  evidence: Array<{
    resume_fact: string;
    job_requirement: string;
    rewrite_location: string;
  }>;
  risks: string[];
}
```

## Prompt Rules

System prompt must require:

- Strict JSON output only.
- Complete Markdown resume output.
- No fabricated companies, projects, metrics, education, certificates, skills, or responsibilities.
- Only existing resume facts may be rewritten, reordered, condensed, or emphasized.
- Job requirements not supported by the resume must go into `risks`.
- Job/company facts must not be presented as candidate experience.
- Evidence items must map a resume fact to a job requirement and a rewrite location.

## Frontend State

Add state to `useJobsPage` or a focused helper imported by it:

```ts
optimizedResumeGenerating: Ref<boolean>;
optimizedResumePreview: Ref<OptimizedResumeResult | null>;
optimizedResumeTargetJob: Ref<JobRow | null>;
optimizedResumeError: Ref<string | null>;
```

Main actions:

```ts
generateOptimizedResume(job: JobRow): Promise<void>;
copyOptimizedResumeMarkdown(): Promise<void>;
saveOptimizedResumeAndLink(): Promise<void>;
closeOptimizedResumePreview(): void;
```

## UI Design

Job card:

- Add a compact action button: "生成岗位版简历".
- Disable while generation is in progress for that job.

Preview modal:

- Editable title input, defaulting to AI `title`.
- Markdown preview area for `optimized_resume_markdown`.
- Sections for change summary, job keywords used, evidence, and risks.
- Actions: cancel, copy Markdown, save and link current job.

Do not add a new page route for this MVP.

## Compatibility

- Existing resume library data format stays unchanged.
- Existing job-resume link format stays unchanged.
- Existing AI resume-match report stays available and can be passed as `score_reason`.
- Existing greeting generation should continue resolving linked/default resumes after this feature saves and links a new resume.

## Error Handling

- Missing job: "未找到职位，无法生成岗位版简历。"
- Missing resume: "请先在简历库为该岗位关联简历，或设置一份默认简历。"
- Empty/invalid AI output: explicit schema error surfaced in UI.
- Save failure: preview remains open so the user can copy Markdown manually.

## Rollback

The feature is additive. Removing the new command, worker mode, and UI action leaves existing resume library and job review flows unchanged. Generated resumes are normal resume library records and require no migration rollback.
