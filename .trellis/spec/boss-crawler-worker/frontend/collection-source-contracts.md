# Collection Source Contracts

## Scenario: Collectable Platform Sources

### 1. Scope / Trigger

- Trigger: automatic collection can run through more than one platform adapter.
- Applies when changing collection source selection, `crawl_auto_start`, worker events, source registry rows, or normalized job writes.
- Keep collection source selection separate from filter profile allowed candidate sources.

### 2. Signatures

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

### 4. Validation & Error Matrix

- Boss selected without stored session -> `crawl_auto_start` returns login/session error.
- V2EX selected without stored Boss session -> command still starts with an empty session payload.
- V2EX feed HTTP non-OK -> worker emits an explicit error and does not write partial fake success.
- V2EX feed entry lacks stable topic id or title -> skip that entry.
- V2EX entry is classified as discussion/unknown or matches excluded keywords -> log skip; do not insert `job`.
- Worker emits malformed normalized payload -> Rust IPC deserialization rejects it before DB write.

### 5. Good/Base/Bad Cases

- Good: user selects V2EX, worker reads Atom entries, classifies clear hiring posts, emits normalized jobs, sidecar upserts `source_platform = "v2ex"`, and default filter profile recomputes candidate eligibility.
- Base: user selects Boss, existing Boss payload and browser-session collection keep working.
- Bad: UI shows V2EX as collectable but `crawl_auto_start` still requires Boss cookies.
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
  - collection config source selector can show V2EX.
  - V2EX Feed section appears when V2EX is selected.
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
    source_platform: selectedCollectionSource,
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
