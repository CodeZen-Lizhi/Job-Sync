# Design

## Scope

This task implements a narrow persistence layer for the existing Boss-only keyword profile filter. It does not attempt to implement the whole second-development PRD.

## Data Model

Add two SQLite tables:

- `filter_profile`
  - `id TEXT PRIMARY KEY`
  - `name TEXT NOT NULL`
  - `profile_json TEXT NOT NULL`
  - `is_default INTEGER NOT NULL`
  - `updated_at TEXT NOT NULL`
- `job_filter_result`
  - `encrypt_job_id TEXT PRIMARY KEY`
  - `profile_id TEXT NOT NULL`
  - `eligible INTEGER NOT NULL`
  - `reason_json TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`

Use a stable default profile id: `default`.

The JSON shape mirrors worker `profile` payload:

```json
{
  "mustKeywords": ["Go"],
  "mustNotKeywords": ["外包"],
  "preferenceKeywords": ["远程"]
}
```

## Data Flow

1. Vue crawl page loads `get_default_filter_profile`.
2. User edits profile fields in crawl page.
3. `start()` saves via `set_default_filter_profile`, then sends the same profile under `task.filters.profile`.
4. Worker evaluates Boss list items:
   - filtered items emit `JOB_FILTERED`;
   - eligible list is sent through `JOB_LIST_CAPTURED`.
5. Rust sidecar persists:
   - `JOB_FILTERED` -> `job_filter_result eligible=false`;
   - `JOB_LIST_CAPTURED` extracted jobs -> `job_filter_result eligible=true`.
6. Jobs queries left join `job_filter_result` and include status in `JobRow`.
7. Jobs UI renders a badge and reason for filtered jobs.

## Compatibility

- Migration is additive.
- Existing jobs without filter result return null filter fields.
- Worker payload remains backward-compatible because `profile` is nested under existing `filters`.

## Rollback

Revert code changes and leave the additive SQLite tables unused. Existing job data remains intact.
