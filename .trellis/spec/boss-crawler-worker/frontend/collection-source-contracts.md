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
  - only uses positive hiring signals before writing to `job`; default discussion/exclusion keywords must not pre-filter V2EX entries
  - post-collection profile and AI judgement own soft exclusion decisions after V2EX entries are written
- Source registry:
  - Boss adapter kind is `boss`
  - V2EX adapter kind is `feed`
  - other non-Boss platforms remain `manual_import` until their automatic adapter exists
- Filter profile:
  - `sourcePlatforms` means allowed candidate sources after jobs are already in the library
  - it must not decide whether raw collectable jobs enter `job`
  - the default filter profile must include currently supported automatic collection sources (`boss`, `v2ex`) so a platform that can be collected is not hidden by source gating immediately after ingestion
  - Boss-only filtering remains an explicit user-selected narrowing mode, not the default
- Multi-source run:
  - UI stores all selected collectable sources, not a single `selectedCollectionSource`
  - starting automatic collection invokes `crawl_auto_start` once per selected source, sequentially
  - each invocation keeps its platform-specific payload and session requirement
  - the user action is still one button click; worker modes remain one source per command
- Boss multi-city run:
  - Boss city selection may be multi-select in the UI
  - if Boss API/browser search only accepts one city at a time, the worker must expand the selected city list into sequential job-list variants
  - variant runs share the same keyword set and dedup key space so repeated job ids across cities are skipped

### 4. Validation & Error Matrix

- Boss selected without stored session -> `crawl_auto_start` returns login/session error.
- V2EX selected without stored Boss session -> command still starts with an empty session payload.
- Boss + V2EX selected -> Boss validates keywords/session; V2EX still runs with optional Boss session.
- No collectable source selected -> frontend blocks start with a clear message.
- V2EX feed HTTP non-OK -> worker emits an explicit error and does not write partial fake success.
- V2EX feed entry lacks stable topic id or title -> skip that entry.
- V2EX entry lacks positive hiring signals -> emit `JOB_FILTERED` with `缺少招聘信号词`; do not insert `job`.
- V2EX entry matches default discussion words, collection excluded keywords, or profile `mustNotKeywords` -> do not pre-filter at feed stage; let post-collection rules and AI judgement decide after ingest.
- Worker emits malformed normalized payload -> Rust IPC deserialization rejects it before DB write.

### 5. Good/Base/Bad Cases

- Good: user selects V2EX, worker reads Atom entries, classifies clear hiring posts, emits normalized jobs, sidecar upserts `source_platform = "v2ex"`, and default filter profile recomputes candidate eligibility.
- Good: user selects Boss + V2EX, frontend runs Boss then V2EX sequentially while each source keeps its adapter contract.
- Base: user selects Boss, existing Boss payload and browser-session collection keep working.
- Bad: UI shows V2EX as collectable but `crawl_auto_start` still requires Boss cookies.
- Bad: frontend collapses selected sources into one payload and loses platform-specific filters/session behavior.
- Bad: Feed entries are written as Boss jobs or without a topic-based dedup key.
- Bad: filter profile allowed candidate sources are used as a pre-ingest collection gate.
- Bad: default filter profile allows only Boss while V2EX is an enabled automatic source; users see collected V2EX jobs blocked by "source not allowed".

### 6. Tests Required

- Worker unit tests:
  - Atom parser extracts title, normalized topic URL, topic id, author, and text content.
  - HTML entity decoding handles `&nbsp;`.
  - classifier accepts clear hiring posts from positive signals only.
  - classifier does not let search keywords alone make a feed entry a job posting.
  - classifier ignores excluded keywords at feed stage so post-collection rules and AI judgement can handle soft exclusion.
  - Boss city array filters expand into one job-list request body per city code while sharing the other filters.
- Rust tests:
  - `job_sources` seeds Boss as `boss`, V2EX as `feed`, and reserved platforms as `manual_import`.
  - normalized V2EX upsert writes `source_platform`, `source_url`, `dedup_key`, display fields, and `jd_text`.
  - default filter profile includes V2EX and legacy Boss-only default profile upgrades to Boss + V2EX.
- Frontend/browser smoke:
  - collection config source selector can select Boss and V2EX together.
  - Boss city selector supports multiple selected dictionary cities and explains that collection runs city variants sequentially.
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

## Scenario: Single User-Facing Post-Collection Rule Config

### 1. Scope / Trigger

- Trigger: changing collection config, collection execution controls, Jobs-page filter explanations, or post-collection rule UI.
- The database and commands may retain `filter_profile` compatibility, but user-facing flows must present one default post-collection rule config.

### 2. Signatures

- Frontend execution page:
  - automatic collection controls must not expose `activeFilterProfileId`, profile selection, or rule-set switching.
- Frontend config page:
  - exposes default post-collection rules only.
  - allowed actions: save config, save and recompute existing jobs.
- Backend compatibility:
  - default profile remains `DEFAULT_FILTER_PROFILE_ID = "default"`.
  - existing `filter_profile` commands can remain for migration and internal compatibility.

### 3. Contracts

- Collection always uses the current default post-collection rule config.
- Users must not choose, create, rename, or set a default profile from the main UI.
- UI copy should say "采后规则" or "筛选规则", not "画像" or "规则集".
- AI soft preferences live in the default post-collection rule config; deterministic hard rules remain in the same config.
- Saved historical profile fields may continue to round-trip so old data does not break.

### 4. Validation & Error Matrix

- User opens collection execution page -> no rule/profile select is rendered.
- User opens collection config -> default post-collection rule header and save/recompute actions render.
- Old database contains multiple profiles -> UI still edits the active default config only.
- Recompute fails -> surface the existing recompute error; do not fall back to another profile.

### 5. Good/Base/Bad Cases

- Good: automatic collection page shows max pages, max jobs, and delay, with no post-collection rule chooser.
- Good: config page shows "默认采后规则", "保存配置", and "保存并重算已有职位".
- Base: existing profile commands still compile and old default profile records load.
- Bad: UI restores "当前规则集", "新建规则集", or "设为默认".
- Bad: collection asks users to choose a profile before running.

### 6. Tests Required

- Frontend contract test:
  - `src/pages/Crawl.vue` does not contain `采后规则集`, `activeFilterProfileId`, or `selectFilterProfile`.
  - `src/pages/CrawlConfig.vue` contains `默认采后规则`, `保存配置`, and `保存并重算已有职位`.
  - `src/pages/CrawlConfig.vue` does not contain profile/rule-set management labels.
- Browser smoke:
  - switch collection page to automatic mode and verify no select is shown for post-collection rules.
  - expand post-collection rules in config and verify only the default config controls are present.

### 7. Wrong vs Correct

#### Wrong

```vue
<select v-model="activeFilterProfileId" @change="selectFilterProfile(activeFilterProfileId)">
  <option v-for="profile in filterProfiles" :value="profile.id">{{ profile.name }}</option>
</select>
```

#### Correct

```vue
<button @click="saveActiveFilterProfile">保存配置</button>
<button @click="recomputeDefaultFilterProfile">保存并重算已有职位</button>
```

## Scenario: Collection Run Summary and Pending Evidence Refresh

### 1. Scope / Trigger

- Trigger: automatic collection needs explainable batch results and recoverable pending-confirmation jobs.
- Applies when changing `crawl_auto_start`, sidecar job-write event handling, collection summary tables, bucket count responses, or pending evidence refresh.
- Collection run summary explains operational outcomes; it must not become a second filter evaluator.

### 2. Signatures

- Tauri command:
  - `crawl_auto_start(task: SearchTaskPayload)`
  - creates a local `collection_run` before sending the worker command.
- Worker command:
  - `CRAWL_AUTO_START`
  - payload includes optional `run_id`.
  - `REFRESH_JOB_EVIDENCE`
  - payload: `{ session, encrypt_job_id, source_url?, raw_payload? }`
- Tauri query commands:
  - `list_collection_runs(limit?: number) -> CollectionRun[]`
  - `list_collection_failures(limit?: number) -> CollectionFailure[]`
  - `refresh_pending_job_evidence(encrypt_job_id: string) -> { encrypt_job_id, status, message }`
- Default filter recompute:
  - `recompute_default_filter_profile() -> { updated, counts }`
  - `counts` has `recommended`, `pending`, `filtered`, `processed`, `all`.
- SQLite tables:
  - `collection_run(id, source_platform, keywords_json, filters_json, limits_json, status, started_at, finished_at, error_message, captured, inserted, updated, duplicate, recommended, pending, filtered, failed, processed, all_jobs)`
  - `collection_failure(id, run_id, source_platform, event_type, keyword, encrypt_job_id, reason, raw_payload_json, created_at)`
- SQLite init entry points:
  - `init_db(app_data_dir)` opens/migrates the database for normal commands and must not mutate active `collection_run` rows.
  - `init_db_for_app_start(app_data_dir)` is the only startup recovery entry point that may mark stale `status='running'` collection runs failed.

### 3. Contracts

- `collection_run` is created per automatic source invocation. The frontend may start Boss and V2EX sequentially from one button click; each source invocation owns one run.
- `captured`, `inserted`, `updated`, `duplicate`, and `failed` are run-operation counters.
- `recommended`, `pending`, `filtered`, `processed`, and `all_jobs` are refreshed from canonical DB/filter state after recompute/finish. They are not limited to only rows captured in that run.
- Upsert outcome is based on persisted DB fields before/after write. `last_seen_at` alone must not turn an unchanged row into `updated`.
- Sidecar records durable failures for missing stable job id, upsert failure, recompute failure, worker error, unsupported pending refresh, and missing Boss session.
- Running-run recovery is a startup-only concern. Query commands such as `list_collection_runs`, job queries, filter recompute commands, or sidecar event handling may open the DB while a collection is active; those paths must preserve `status='running'`.
- Pending evidence refresh reuses the worker `JOB_DETAIL_CAPTURED` event after fetching Boss detail. Rust sidecar performs the same upsert and filter recompute path as normal collection detail events.
- Non-Boss pending jobs or Boss jobs without usable session/path return a clear error and remain in the job library.
- No collection summary or evidence refresh path may add automatic apply, chat open, greeting send, or resume send behavior.

### 4. Validation & Error Matrix

- Boss selected without session -> run is marked `failed`, a `collection_failure` row is written, command returns the session error.
- Worker emits `ERROR` during active run -> failure row is written and run status becomes `failed`; later `FINISHED` may still refresh bucket counts but must not overwrite failed status.
- App process starts with stale `status='running'` rows from a previous crash -> `init_db_for_app_start` marks them `failed` with `error_message='app restarted before collection finished'`.
- Normal command opens DB while sidecar is running -> active `status='running'` rows remain running.
- List item lacks stable ID -> write `collection_failure(event_type='JOB_LIST_CAPTURED', reason='missing stable job id')`.
- Upsert or recompute fails for one item -> write item-level failure and continue processing other items where possible.
- `refresh_pending_job_evidence` for non-pending job -> return clear error; do not start worker.
- `refresh_pending_job_evidence` for unsupported source -> write failure and return `当前来源暂不支持自动补证据`.
- Successful Boss refresh -> worker emits `JOB_DETAIL_CAPTURED`; sidecar updates detail/JD/raw evidence and recomputes canonical filter.

### 5. Good/Base/Bad Cases

- Good: a Boss run captures 10 list rows, inserts 4, updates 3, sees 3 duplicates, records 1 missing-id failure, then refreshes canonical bucket counts.
- Good: a V2EX run writes normalized jobs through the same run summary and failure table as Boss.
- Good: a pending Boss job triggers `REFRESH_JOB_EVIDENCE`, receives a detail payload, and leaves pending if evidence is still insufficient.
- Base: old databases have no run history but can still query jobs and bucket counts after additive migration.
- Base: the collection page polls run history during an active run; polling must not mark the active run failed.
- Bad: using worker profile-filter eligibility as the final recommended/pending/filtered count.
- Bad: silently skipping malformed list rows without a durable failure record.
- Bad: calling stale-run cleanup from generic DB initialization used by normal commands.
- Bad: making pending refresh look successful when the source is unsupported or Boss session is missing.

### 6. Tests Required

- Rust DB tests:
  - migration creates `collection_run` and `collection_failure`.
  - run/failure helpers persist counters and raw failure payloads.
  - upsert outcome classifies inserted/updated/duplicate without counting `last_seen_at` only changes.
  - normal `init_db` preserves active `status='running'` rows.
  - `init_db_for_app_start` marks stale `status='running'` rows failed.
- Rust filter tests:
  - bucket counts are derived from `job_filter_result.reason_json.bucket`, review/communication/company state, and blacklist state.
- Worker tests:
  - command protocol accepts `REFRESH_JOB_EVIDENCE`.
  - Boss detail refresh emits existing `JOB_DETAIL_CAPTURED` on success.
- Cross-layer contract tests:
  - Tauri commands are registered.
  - Crawl page invokes run/failure queries.
  - Jobs page exposes pending evidence refresh without automatic apply/chat/send actions.

### 7. Wrong vs Correct

#### Wrong

```rust
let duplicate = conn.execute(upsert_sql, params)? == 0;
```

`last_seen_at` changes make SQLite report a write even when no meaningful job evidence changed.

#### Correct

```rust
let before = load_job_persistence_snapshot(conn, encrypt_job_id)?;
upsert_job_from_list_item(conn, encrypt_job_id, item)?;
let after = load_job_persistence_snapshot(conn, encrypt_job_id)?;
```

Compare persisted evidence fields and ignore `last_seen_at` for duplicate vs updated classification.

#### Wrong

```rust
pub fn init_db(app_data_dir: &Path) -> Result<Connection> {
    let conn = open_db(app_data_dir)?;
    fail_stale_running_collection_runs(&conn, "app restarted before collection finished")?;
    Ok(conn)
}
```

Normal commands call `init_db` while the sidecar is actively collecting, so this turns a live run into a fake restart failure.

#### Correct

```rust
pub fn init_db(app_data_dir: &Path) -> Result<Connection> {
    open_db(app_data_dir)
}

pub fn init_db_for_app_start(app_data_dir: &Path) -> Result<Connection> {
    let conn = open_db(app_data_dir)?;
    fail_stale_running_collection_runs(&conn, "app restarted before collection finished")?;
    Ok(conn)
}
```

#### Wrong

```typescript
if (job.source_platform !== "boss") return { status: "success" };
```

#### Correct

```typescript
ctx.emit({ type: "ERROR", payload: { message: "当前来源暂不支持自动补证据" } });
```

Unsupported evidence refresh must fail explicitly and preserve the pending job.

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
