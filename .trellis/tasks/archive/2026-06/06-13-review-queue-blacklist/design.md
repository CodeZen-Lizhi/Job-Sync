# Design

## Scope

This task adds local review and blacklist state around existing jobs. It is intentionally query- and UI-first: it creates the data model and commands needed for a Top 20 review queue without implementing AI scoring yet.

## Data Model

Add `job_review_state`:

- `encrypt_job_id TEXT PRIMARY KEY`
- `review_status TEXT NOT NULL DEFAULT 'pending'`
- `communication_status TEXT NOT NULL DEFAULT 'not_contacted'`
- `last_greeted_at TEXT`
- `notes TEXT`
- `updated_at TEXT NOT NULL`

Add `job_blacklist`:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `kind TEXT NOT NULL` with `company` or `job`
- `value TEXT NOT NULL`
- `reason TEXT`
- `created_at TEXT NOT NULL`
- unique index on `(kind, value)`

Company blacklist value uses `brand_name`; job blacklist value uses `encrypt_job_id`.

## Query Contract

`JobRow` gains nullable review/communication/blacklist fields:

- `review_status`
- `communication_status`
- `last_greeted_at`
- `review_notes`
- `company_blacklisted`
- `job_blacklisted`
- `blacklist_reason`

The candidate query returns jobs that satisfy:

- `job_filter_result.eligible` is not `false`.
- job id is not blacklisted.
- brand name is not company-blacklisted.
- `review_status` is not `ignored`.
- `communication_status` is not `rejected` or `manual_not_fit`.

Default ordering is conservative until scoring exists:

1. jobs with explicit `eligible=true`
2. newest `last_seen_at`
3. stable `encrypt_job_id`

## Commands

Add Tauri commands:

- `list_review_candidates(limit?: u32)`
- `set_job_review_state(encryptJobId, reviewStatus?, communicationStatus?, lastGreetedAt?, notes?)`
- `add_company_blacklist(companyName, reason?)`
- `add_job_blacklist(encryptJobId, reason?)`

The update command validates enum values before writing. Missing optional fields keep existing values.

## UI

Jobs page adds a Top 20 review section above search/source groups. Each job item shows review metadata and exposes small action buttons:

- 收藏
- 准备投递
- 已投递
- 忽略
- 未读
- 已读未回
- 已回复
- 已拒绝
- 不合适
- 拉黑公司
- 拉黑职位

After any state-changing action, the candidates query and relevant job caches refresh.

## Compatibility

- Existing jobs without review rows are treated as `pending` / `not_contacted`.
- Existing jobs without filter result remain candidates unless later blacklisted or manually excluded.
- Additive SQLite changes do not modify existing job rows.

## Rollback

Revert command/UI code and leave the additive tables unused. Existing job data remains intact.
