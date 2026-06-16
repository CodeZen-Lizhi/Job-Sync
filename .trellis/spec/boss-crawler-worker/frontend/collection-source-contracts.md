# Collection Source Contracts

## Scenario: Collectable Platform Sources

### 1. Scope / Trigger

- Trigger: automatic collection can run through more than one platform adapter.
- Applies when changing collection source selection, `crawl_auto_start`, worker events, source registry rows, or normalized job writes.
- Keep collection source selection separate from filter profile allowed candidate sources.

### 2. Signatures

- Frontend selection state:
  - `selectedCollectionSources: JobSourcePlatform[]`
  - multiple collectable platforms may be selected in one automatic run
- Frontend task payload:
  - `keywords: string[]`
  - `source_platform: "boss" | "v2ex" | string`
  - `filters: object`
  - `limits: object`
  - `mode: "auto"`
- Tauri command:
  - `crawl_auto_start(task: SearchTaskPayload)`
- Worker event for non-Boss normalized jobs:
  - `JOB_NORMALIZED_CAPTURED`
- SQLite write target:
  - `job.encrypt_job_id`
  - `job.source_platform`
  - `job.source_url`
  - `job.dedup_key`
  - unified display fields
  - `job.raw_payload_json`

### 3. Contracts

- Boss:
  - `source_platform = "boss"`
  - requires Boss Cookie and LocalStorage session
  - emits Boss list/detail events already understood by sidecar
- V2EX:
  - `source_platform = "v2ex"`
  - does not require Boss session
  - uses `filters.feed_url`, defaulting to `https://www.v2ex.com/feed/tab/jobs.xml`
  - emits `JOB_NORMALIZED_CAPTURED`
  - stores `encrypt_job_id = "v2ex:<topicId>"`
  - stores `dedup_key = <topicId>`
  - skips `discussion` or `unknown` feed entries before writing to `job`
- Source registry:
  - Boss adapter kind is `boss`
  - V2EX adapter kind is `feed`
  - other non-Boss platforms remain `manual_import` until their automatic adapter exists
- Filter profile:
  - `sourcePlatforms` means allowed candidate sources after jobs are already in the library
  - it must not decide whether raw collectable jobs enter `job`
- Multi-source run:
  - UI stores all selected collectable sources, not a single `selectedCollectionSource`
  - starting automatic collection invokes `crawl_auto_start` once per selected source, sequentially
  - each invocation keeps its platform-specific payload and session requirement
  - the user action is still one button click; worker modes remain one source per command

### 4. Validation & Error Matrix

- Boss selected without stored session -> `crawl_auto_start` returns login/session error.
- V2EX selected without stored Boss session -> command still starts with an empty session payload.
- Boss + V2EX selected -> Boss validates keywords/session; V2EX still runs with optional Boss session.
- No collectable source selected -> frontend blocks start with a clear message.
- V2EX feed HTTP non-OK -> worker emits an explicit error and does not write partial fake success.
- V2EX feed entry lacks stable topic id or title -> skip that entry.
- V2EX entry is classified as discussion/unknown or matches excluded keywords -> log skip; do not insert `job`.
- Worker emits malformed normalized payload -> Rust IPC deserialization rejects it before DB write.

### 5. Good/Base/Bad Cases

- Good: user selects V2EX, worker reads Atom entries, classifies clear hiring posts, emits normalized jobs, sidecar upserts `source_platform = "v2ex"`, and default filter profile recomputes candidate eligibility.
- Good: user selects Boss + V2EX, frontend runs Boss then V2EX sequentially while each source keeps its adapter contract.
- Base: user selects Boss, existing Boss payload and browser-session collection keep working.
- Bad: UI shows V2EX as collectable but `crawl_auto_start` still requires Boss cookies.
- Bad: frontend collapses selected sources into one payload and loses platform-specific filters/session behavior.
- Bad: Feed entries are written as Boss jobs or without a topic-based dedup key.
- Bad: filter profile allowed candidate sources are used as a pre-ingest collection gate.

### 6. Tests Required

- Worker unit tests:
  - Atom parser extracts title, normalized topic URL, topic id, author, and text content.
  - HTML entity decoding handles `&nbsp;`.
  - classifier accepts clear hiring posts and blocks discussions or explicit excluded terms.
- Rust tests:
  - `job_sources` seeds Boss as `boss`, V2EX as `feed`, and reserved platforms as `manual_import`.
  - normalized V2EX upsert writes `source_platform`, `source_url`, `dedup_key`, display fields, and `jd_text`.
- Frontend/browser smoke:
  - collection config source selector can select Boss and V2EX together.
  - V2EX Feed section appears when V2EX is selected among selected sources.
  - execution page labels V2EX as the automatic source.
  - settings page shows V2EX automatic collection and no-login capability.

### 7. Wrong vs Correct

#### Wrong

```ts
if (selectedCollectionSource !== "boss") {
  throw new Error("当前版本只支持 Boss 自动采集");
}
```

#### Correct

```ts
await invoke("crawl_auto_start", {
  task: {
    keywords,
    source_platform: source,
    filters,
    limits,
    mode: "auto",
  },
});
```

#### Wrong

```rust
let session = load_session(sidecar.app_data_dir())?;
```

#### Correct

```rust
let session = if task.source_platform.as_deref() == Some("v2ex") {
    load_session_optional(sidecar.app_data_dir())
} else {
    load_session(sidecar.app_data_dir())?
};
```

## Scenario: Boss Chat Communication Status Sync

### 1. Scope / Trigger

- Trigger: syncing local `job_review_state.communication_status` from Boss communication history.
- Applies when changing Boss chat-page collection, `BOSS_CHAT_SYNC`, `BOSS_CHAT_STATUS_SYNCED`, or Jobs page communication-status sync UI.
- Boss chat page/API is the source of truth for communication status. Job list/detail payloads must not be used to infer communication status.

### 2. Signatures

- Tauri command:
  - `sync_boss_chat_status()`
- Worker command:
  - `BOSS_CHAT_SYNC`
  - payload: `{ session: SessionStatePayload, limits?: object }`
- Worker event:
  - `BOSS_CHAT_STATUS_SYNCED`
  - payload:
    - `encrypt_job_id: string`
    - `communication_status: "greeted_unread" | "read_no_reply" | "replied" | "rejected"`
    - `boss_name?: string`
    - `brand_name?: string`
    - `position_name?: string`
    - `message_status?: string`
    - `message_preview?: string`
    - `raw_payload?: unknown`
- SQLite write target:
  - `job_review_state.encrypt_job_id`
  - `job_review_state.communication_status`
  - `job_review_state.last_greeted_at`

### 3. Contracts

- `sync_boss_chat_status` requires stored Boss cookies and LocalStorage; without them it returns a login/session error.
- Worker opens `https://www.zhipin.com/web/geek/chat`, listens to Boss chat/relation API responses, and may inspect DOM links on the chat page.
- A status event is emitted only when a chat record can be safely associated to an `encrypt_job_id`.
- Sidecar writes only when the local `job` table already contains that `encrypt_job_id`.
- Status mapping:
  - `[送达]`, `[已送达]`, or `未读` -> `greeted_unread`
  - `[已读]` -> `read_no_reply`
  - explicit recruiter reply evidence -> `replied`
  - explicit rejection text such as `不考虑` / `不合适` -> `rejected`
- Unknown or unsupported status labels are skipped or rejected at the boundary; do not invent a local status.

### 4. Validation & Error Matrix

- Missing stored Boss session -> Tauri command returns `cookies not found` / `localStorage not found`.
- Boss API returns login-expired code -> worker emits `ERROR` telling the user to re-login.
- Chat item lacks `encrypt_job_id` -> skip; do not match by company, recruiter, title, or text.
- Chat item maps to a job id not present in local `job` -> sidecar skips; do not create review-only rows for unknown jobs.
- Worker emits unknown `communication_status` -> sidecar emits `ERROR` and does not write DB state.

### 5. Good/Base/Bad Cases

- Good: Boss chat row has job detail link and `[已读]`; sidecar updates that local job to `read_no_reply` and recomputes the default filter result.
- Good: Boss chat row has job id and rejection text; sidecar updates that local job to `rejected`.
- Base: chat row has `[送达]`; local status becomes `greeted_unread`.
- Bad: infer status from `/wapi/zpgeek/search/joblist.json` or `/wapi/zpgeek/job/detail.json`.
- Bad: match chat rows to jobs by `brand_name + boss_name + position_name`.

### 6. Tests Required

- Worker unit tests:
  - parse `[已读]` to `read_no_reply`
  - parse `[送达]` to `greeted_unread`
  - promote explicit reply evidence to `replied`
  - promote rejection text to `rejected`
  - skip job-info-only records without chat evidence
- Cross-layer contract tests:
  - Jobs page may invoke `sync_boss_chat_status` without adding automatic apply/send actions.
- Rust tests or review:
  - sidecar only writes known communication statuses
  - sidecar skips unknown local job ids

### 7. Wrong vs Correct

#### Wrong

```ts
const status = jobListItem.friendStatus === 1 ? "greeted_unread" : "not_contacted";
```

#### Correct

```ts
ctx.emit({
  type: "BOSS_CHAT_STATUS_SYNCED",
  payload: {
    encrypt_job_id,
    communication_status: mappedFromChatPage,
  },
});
```

#### Wrong

```ts
findLocalJob({ brandName, bossName, positionName });
```

#### Correct

```rust
if !local_job_exists(conn, &payload.encrypt_job_id) {
    continue;
}
```

## Scenario: Post-Collection Filter Buckets

### 1. Scope / Trigger

- Trigger: automatic collection writes jobs that are later grouped into job-library buckets.
- Applies when changing Boss worker `JOB_LIST_CAPTURED`, sidecar upsert/recompute paths, Rust Filter profile evaluator, `job_filter_result.reason_json`, or job-library bucket queries.
- Keep collection persistence separate from candidate actionability. Collection decides what facts were observed; Rust filter results decide what bucket a saved job belongs to.

### 2. Signatures

- Worker event:
  - `JOB_LIST_CAPTURED`
  - payload: `{ keyword?: string, filters?: object, raw: object }`
  - For Boss, `raw.zpData.jobList` must remain the full API list payload.
- Optional worker evidence event:
  - `JOB_FILTERED`
  - payload: `{ encrypt_job_id?: string, keyword?: string, filters?: object, reason: object, raw?: object }`
  - This is worker-side evidence/telemetry only; it is not the persistence truth.
- SQLite write target:
  - `job.jd_text`
  - `job.raw_payload_json`
  - `job_detail_raw.zp_data_json`
  - `job_filter_result.eligible`
  - `job_filter_result.reason_json`
- Tauri query:
  - `list_filtered_jobs(limit?: number) -> JobRow[]`
  - `list_pending_confirmation_jobs(limit?: number) -> JobRow[]`

### 3. Contracts

- Boss worker may use the lightweight profile filter to control detail-fetch priority and volume.
- Boss worker must still emit the original full job-list raw payload through `JOB_LIST_CAPTURED`; do not replace the list with only eligible jobs.
- Sidecar/Rust must upsert list-level jobs before final eligibility is decided.
- Rust default Filter profile recompute must build its searchable evidence from:
  - normalized job fields
  - `job.jd_text`
  - `job.raw_payload_json`
  - Boss `job_detail_raw.zp_data_json`
  - review / communication / company state
  - blacklist hits
- `reason_json.bucket` is the canonical bucket hint:
  - `recommended`
  - `pending_confirmation`
  - `filtered`
- `eligible` remains backward-compatible:
  - `eligible=true` means recommended unless later manual/communication/blacklist state excludes it.
  - `eligible=false` plus `bucket=pending_confirmation` means keep visible in pending confirmation, not filtered.
  - `eligible=false` without pending bucket remains filtered.
- `sourcePlatforms` is a post-ingest candidate rule. It must never block `job` upsert.

### 4. Validation & Error Matrix

- Boss API returns list items that fail worker profile filter -> still present in `JOB_LIST_CAPTURED.raw`, still upsertable into `job`, may additionally emit `JOB_FILTERED`.
- Job has required text rules but no JD/detail and only missing evidence-sensitive rules -> `reason_json.bucket = "pending_confirmation"` and `eligible = false`.
- Job JD or raw payload matches `mustKeywords` / `requiredTechTags` -> default recompute may mark recommended even if title/list fields do not contain those terms.
- Job raw payload or JD matches `mustNotKeywords` -> default recompute marks filtered with `blocked_by` reason.
- Existing rows without `reason_json.bucket` -> degrade through `eligible`: true as recommended-style, false as filtered-style.

### 5. Good/Base/Bad Cases

- Good: Boss list response has ten rows, worker detail gate keeps three rows for detail fetch, but `JOB_LIST_CAPTURED.raw.zpData.jobList` still contains all ten rows.
- Good: V2EX normalized job stores `jd_text`; Rust recompute can satisfy `mustKeywords` from the post body.
- Good: A weak Boss list-only job missing JD cannot prove required JD terms, so it enters pending confirmation instead of disappearing.
- Base: old filter result rows without a bucket still render using `eligible`.
- Bad: `withFilteredJobListRaw(jobListRaw, eligibleJobs)` before emitting `JOB_LIST_CAPTURED`.
- Bad: page queries re-implement profile matching instead of consuming `job_filter_result.reason_json`.

### 6. Tests Required

- Worker contract test:
  - assert `JOB_LIST_CAPTURED` emits `raw: jobListRaw`
  - assert worker can still set `jobsToCapture = eligibleJobs` for detail priority
- Rust filter tests:
  - `jd_text` satisfies required keyword/tag rules
  - `raw_payload_json` triggers must-not keyword filtering
  - missing JD/detail with strict text rules produces `bucket = "pending_confirmation"`
- Rust query tests:
  - `list_filtered_jobs` excludes pending-confirmation rows
  - `list_pending_confirmation_jobs` returns pending-confirmation rows

### 7. Wrong vs Correct

#### Wrong

```ts
ctx.emit({
  type: "JOB_LIST_CAPTURED",
  payload: {
    raw: withFilteredJobListRaw(jobListRaw, eligibleJobs),
  },
});
```

#### Correct

```ts
ctx.emit({
  type: "JOB_LIST_CAPTURED",
  payload: {
    raw: jobListRaw,
  },
});
```

#### Wrong

```rust
json_object(
  'position_name', j.position_name,
  'brand_name', j.brand_name
)
```

#### Correct

```rust
json_object(
  'position_name', j.position_name,
  'brand_name', j.brand_name,
  'jd_text', j.jd_text,
  'raw_payload_json', j.raw_payload_json
)
```
