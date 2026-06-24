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
  - collection configuration must not expose a generic collection-intent form or a sync-to-platform action; users configure each selected platform directly
- Frontend task payload:
  - `keywords: string[]`
  - `source_platform: "boss" | "v2ex" | string`
  - `filters: object`
    - Boss: `city`, `salary`, `experience`, `degree`, `industry`, `scale`, `stage`, and `jobType` are the user-facing platform filters known to map to `/wapi/zpgeek/search/joblist.json`; `position`, `multiSubway`, and `multiBusinessDistrict` may pass through internally if available, but must not be surfaced as generic unknown filters.
    - V2EX: `feed_urls?: string[]`, `sort_by?: "published_desc" | "updated_desc"`, `recent_days?: number | null`
    - LinuxDo: `category_url?: string`, `sort_by?: "latest" | "created"`, `recent_days?: number | null`, `keywords?: string[]`
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
  - `job_detail_raw.zp_data_json` for normalized non-Boss detail display

### 3. Contracts

- Boss:
  - `source_platform = "boss"`
  - uses an isolated persistent visible-browser profile (`boss-browser-profile`) as the primary login continuity source; stored Boss Cookie and LocalStorage remain a compatibility snapshot and may be empty when collection starts from an already logged-in profile
  - if the profile is not logged in or Boss presents a risk/login check, the worker keeps the visible browser open, emits `LOGIN_STATUS`, waits for the user to complete login/verification, then resumes collection
  - Boss API responses that arrive as login/security-check HTML, 401/403, or login/risk JSON codes are recoverable risk states; the worker must keep the browser open, emit `LOGIN_STATUS`, and retry after the user finishes login/verification instead of closing the run as a terminal JSON parse failure
  - natural Boss HTTP response readers must preserve non-JSON response text and content type before risk classification; otherwise `200 text/html` login/security pages can be misreported as terminal JSON parse failures
  - if a Boss visible-browser mode is stopped while the latest login state is `invalid`, `captcha`, or `denied`, the worker should disconnect from the browser instead of closing it so the user can finish the in-progress verification and rerun with the same profile
  - job list collection should prefer the natural `/wapi/zpgeek/search/joblist.json` response produced by normal Boss search-page navigation and fall back to DOM recovery or page-context API fetch only when the natural response is missing
  - natural job-list response matching must guard against wrong page/filter capture: if the response exposes `query`, `page`, or selected `city`, they must match the active request before the worker treats it as the current page's result
  - DOM job-list fallback must not parse a stale page after navigation failure or URL mismatch; only parse DOM when the current Boss search URL matches the active keyword/page/city request
  - `JOB_LIST_CAPTURED.payload.capture_source` is optional but, when present, must be one of `natural`, `dom_fallback`, or `api_fallback`; canary and diagnostics should prefer this structured field over parsing log text
  - a Boss run that finishes without any extracted job-list items or without any stable job ids must emit an explicit `ERROR`; `FINISHED` alone is not a success signal
  - emits Boss list/detail events already understood by sidecar
  - `query` is built from Boss search keywords; each keyword line is one Boss search request, so remote intent should be expressed as one line such as `Go 远程` rather than a separate standalone `远程` keyword.
  - supports `limits.maxPages` as the positive page cap per keyword/filter variant and `limits.maxJobs` as the optional positive inserted-job cap enforced by the sidecar run tracker; missing `maxPages` falls back to the worker default of 3 pages.
  - Boss automatic collection should not require per-job `/wapi/zpgeek/job/detail.json` fetches for success. The default path stores natural joblist/list-item data first; detail fetches are an opt-in enhancement through `limits.bossDetailFetchLimit` / `limits.detailFetchLimit`, defaulting to `0`. When enabled, the detail limit counts attempted detail ids, not only successful detail captures.
  - Boss pending-evidence refresh uses the same isolated persistent visible-browser profile (`boss-browser-profile`) as Boss login and auto collection; do not launch a fresh temporary profile for `REFRESH_JOB_EVIDENCE`.
  - platform-side filters must be limited to observed `joblist` parameters. Do not add visible controls for latest sorting or Boss active status unless a logged-in request proves stable API parameters.
  - Boss active status remains saved job evidence/display input and AI judgement evidence after collection, not an API pre-filter.
- V2EX:
  - `source_platform = "v2ex"`
  - does not require Boss session
  - only uses user-configured `filters.feed_urls`; empty or missing URLs must skip V2EX collection instead of falling back to a built-in default source
  - frontend URL input may contain multiple URLs split by newline, comma, Chinese comma, or Chinese enumeration comma
  - `feed/*.json` and `feed/*.xml` URLs are feed sources and must be fetched once without pagination parameters
  - `/go/*` node URLs and `/?tab=jobs` URLs are page sources and may paginate with `p=N` until the configured page cap or an empty page
  - `jobs`, `remote`, `meet`, `career`, `cv`, and `outsourcing` are all treated as job or collaboration information sources, without separate business buckets
  - results from all configured URLs are deduplicated by `topicId`, keeping the more complete parsed entry when duplicates appear
  - jobs-list pagination should prefer V2EX embedded `application/ld+json` `datePublished` as the post publish time; visible list timestamps may reflect recent activity/replies and must not silently replace publish time
  - supports `filters.sort_by = "published_desc" | "updated_desc"`; missing or invalid values default to `published_desc`
  - supports `filters.recent_days` as a positive day window applied to the same timestamp field selected by `sort_by`; null, missing, or non-positive values mean no time pre-filter
  - supports `limits.maxPages` as the optional positive page cap for V2EX jobs-list pagination; missing or non-positive values fall back to the frontend default
  - sorts parsed V2EX entries before recent-day filtering and optional entry limiting so old threads bumped by replies do not crowd out newer postings when `published_desc` is selected
  - emits `JOB_NORMALIZED_CAPTURED`
  - stores `encrypt_job_id = "v2ex:<topicId>"`
  - stores `dedup_key = <topicId>`
  - stores a `job_detail_raw.zp_data_json` projection whose `jobInfo.postDescription` contains the fetched topic detail body so `get_job_detail` can render the V2EX post without a Boss detail fetch
  - only uses positive hiring signals before writing to `job`; default discussion/exclusion keywords must not pre-filter V2EX entries
  - post-collection profile and AI judgement own soft exclusion decisions after V2EX entries are written
- LinuxDo:
  - `source_platform = "linuxdo"`
  - does not require Boss session
  - uses direct Discourse API collection by default; worker requests category JSON such as `/c/job/27.json` and topic detail JSON such as `/t/<topicId>.json`
  - when a LinuxDo login snapshot exists, API requests should carry the saved LinuxDo cookies, not Boss cookies
  - must not restore the old automated Puppeteer login flow or attempt hidden Cloudflare bypass
  - reads the configured category URL, default `https://linux.do/c/job/27`, and derives the matching Discourse JSON endpoint
  - supports `filters.sort_by = "latest" | "created"`; missing or invalid values default to `latest`
  - supports `filters.recent_days` as a positive day window applied to the selected timestamp field; null, missing, or non-positive values mean no time pre-filter
  - supports `limits.maxPages` as a positive category pagination cap and `limits.maxJobs` as inserted job cap
  - if list-level topic id, title, and URL are available but detail fetch is blocked or missing, may emit a normalized title-level job with `raw_payload.detail_status = "missing" | "blocked"` and `jd_text` containing `详情暂未抓取，需打开原帖确认。`
  - emits `JOB_NORMALIZED_CAPTURED`
  - stores `encrypt_job_id = "linuxdo:<topicId>"`
  - stores `dedup_key = <topicId>`
  - stores a `job_detail_raw.zp_data_json` projection whose `jobInfo.postDescription` contains the topic title plus detail text or the missing-detail marker
  - only uses positive hiring signals before writing to `job`; configured keywords may add matches but must not alone turn a discussion thread into a job
  - post-collection profile and AI judgement own soft exclusion decisions after LinuxDo entries are written
- Collection limits:
  - For normalized feed adapters, `limits.maxJobs` means the number of jobs that have been successfully inserted into the local job library, not raw captured entries and not merely classified candidates.
  - For the Boss adapter, `limits.maxJobs` follows the same inserted-job meaning and must not force detail endpoint requests. The sidecar stops the worker once inserted rows reach the cap.
  - the sidecar may stop a worker after counting an inserted job, and duplicate or updated rows must not consume the limit
- Post-collection AI judgement:
  - after Boss, V2EX, or LinuxDo automatic collection finishes, the sidecar may trigger `recompute_ai_post_collection_judgement`
  - persisted `reason_json.ai_judgement.status` is the UI status source when present: `passed`, `rejected`, `pending_confirmation`, or `failed`
  - missing `reason_json.ai_judgement` means the UI status is `pending_review`; in-flight frontend recompute may temporarily show `processing`
  - automatic AI judgement success must emit a runtime `LOG` summary with updated, AI-judged, hard-skipped, and fallback-failed counts
  - automatic AI judgement failure must emit a runtime `LOG` error with the failure reason; do not swallow background errors silently
  - every attempted job judgement should emit runtime `LOG` entries for start, skip, success, or failure with the job title/id
- Source registry:
  - Boss adapter kind is `boss`
  - V2EX adapter kind is `feed`
  - LinuxDo adapter kind is `feed`
  - other non-Boss platforms remain `manual_import` until their automatic adapter exists
  - enabled `manual_import` platforms may be shown in the collection source selector so users can save intended source scope, but automatic collection must skip them with a clear runtime log until an adapter exists
- Filter profile:
  - `sourcePlatforms` means allowed candidate sources after jobs are already in the library
  - it must not decide whether raw collectable jobs enter `job`
  - the default filter profile must include currently supported automatic collection sources (`boss`, `v2ex`, `linuxdo`) so a platform that can be collected is not hidden by source gating immediately after ingestion
  - Boss-only filtering remains an explicit user-selected narrowing mode, not the default
- Multi-source run:
  - UI stores all selected collectable sources, not a single `selectedCollectionSource`
  - starting automatic collection invokes `crawl_auto_start` once per selected source, sequentially
  - each invocation keeps its platform-specific payload and session requirement
  - the user action is still one button click; worker modes remain one source per command
  - platform-specific configuration panels must be rendered from the selected source set; selecting only LinuxDo must not show Boss-only filters, and selecting a platform should make its dedicated panel immediately visible/open
  - do not reintroduce a generic intent-to-platform synchronization layer; Boss, V2EX, and LinuxDo fields are edited and persisted directly
- Boss multi-city run:
  - Boss city selection may be multi-select in the UI
  - if Boss API/browser search only accepts one city at a time, the worker must expand the selected city list into sequential job-list variants
  - variant runs share the same keyword set and dedup key space so repeated job ids across cities are skipped

### 4. Validation & Error Matrix

- Boss selected without stored session -> `crawl_auto_start` still starts with the Boss persistent browser profile and the worker waits for login in the visible browser if needed.
- Boss selected with missing or invalid `limits.maxPages` -> frontend should fall back to the default positive page cap or block non-positive page values before start.
- Boss selected with non-positive `limits.maxJobs` -> frontend blocks start; empty `maxJobs` means no explicit inserted-job cap beyond page and dedup limits.
- Boss joblist/detail returns login HTML, security-check HTML, 401, 403, code 7, code 36, or code 37 -> worker emits a waiting login/risk status and retries after user action; it must not close the browser as a plain parse/API failure.
- Boss joblist natural response belongs to a different query, page, or selected city -> worker ignores it and waits for the matching response or fallback path.
- Boss run completes with zero parsed job-list items or zero stable ids -> worker emits `ERROR` so UI/canary do not report a false success.
- V2EX selected without stored Boss session -> command still starts with an empty session payload.
- V2EX selected with an empty URL input -> frontend blocks start with a clear URL-required message; if an empty payload reaches the worker, the worker logs that no URL was provided and skips collection.
- LinuxDo selected with an empty or non-linux.do category URL -> frontend blocks start with a clear URL-required message.
- LinuxDo Discourse API Cloudflare challenge / 403 / 429 -> worker logs that the API request was blocked or rate-limited and emits an explicit error when no stable topic list was collected.
- LinuxDo detail blocked but list topic data is stable -> worker may write a title-level normalized job with missing-detail evidence.
- Boss + V2EX selected -> Boss validates keywords and browser login readiness; V2EX still runs with optional Boss session.
- No collectable source selected -> frontend blocks start with a clear message.
- V2EX feed HTTP non-OK -> worker emits an explicit error and does not write partial fake success.
- V2EX feed entry lacks stable topic id or title -> skip that entry.
- V2EX feed entry timestamp is missing or invalid while `recent_days` is active -> it is not considered recent for that selected time field.
- Unknown V2EX `sort_by` values -> worker falls back to `published_desc`.
- Missing or invalid V2EX `limits.maxPages` -> worker falls back to the default V2EX page cap; do not use a hidden fixed job-count ceiling such as 50.
- V2EX feed URL -> worker must request only the feed URL once and must not append `p=N` or rewrite it to a node URL.
- V2EX page URL -> worker may append/update `p=N` and stop at the page cap or first empty parsed page.
- V2EX entry lacks positive hiring signals -> emit `JOB_FILTERED` with `缺少招聘信号词`; do not insert `job`.
- V2EX entry matches default discussion words, collection excluded keywords, or profile `mustNotKeywords` -> do not pre-filter at feed stage; let post-collection rules and AI judgement decide after ingest.
- Worker emits malformed normalized payload -> Rust IPC deserialization rejects it before DB write.
- Automatic post-collection AI request returns provider/model/network error -> runtime log shows `AI 采后判断失败：...` so the user can distinguish "not run" from "AI provider failed".
- Per-job AI provider/output failure -> persist `ai_judgement.status = "failed"` and show the job badge as `审核失败`; do not collapse this into ordinary `待确认`.

### 5. Good/Base/Bad Cases

- Good: user selects V2EX, worker reads Atom entries, classifies clear hiring posts, emits normalized jobs, sidecar upserts `source_platform = "v2ex"`, and default filter profile recomputes candidate eligibility.
- Good: user sets V2EX max pages to 3, and the worker can process all qualifying jobs from those pages instead of stopping at a hidden fixed count.
- Good: user enters `https://www.v2ex.com/feed/jobs.json` and `https://www.v2ex.com/go/meet`; the feed is fetched once, the page URL is paginated, and duplicated topic ids are inserted once.
- Good: AI provider fails after collection, and the run log shows the provider error instead of leaving only `AI 结果：未判定` in the job list.
- Good: user selects Boss + V2EX, frontend runs Boss then V2EX sequentially while each source keeps its adapter contract.
- Good: user selects LinuxDo, worker requests `https://linux.do/c/job/27.json` through the Discourse API, carries saved LinuxDo cookies when available, emits normalized `linuxdo:<topicId>` jobs, and post-collection AI judgement runs.
- Good: user selects only LinuxDo in collection config, the page shows the LinuxDo dedicated config panel with category URL/sort/page/job limits, and hides Boss-only dictionary/filter controls.
- Good: LinuxDo detail JSON is blocked after list parse, and the job is still inserted with a clear missing-detail marker for AI/pending confirmation.
- Base: user selects Boss, existing Boss payload and browser-session collection keep working.
- Base: user leaves Boss limits at defaults, the task sends `limits.maxPages = 3`, `limits.maxJobs = 100`, `limits.bossDetailFetchLimit = 0`, and the worker still keeps `pageSize = 15`.
- Good: user lowers Boss page cap to 1 or clears the job cap, and the payload changes only `limits` without adding unverified Boss sort/filter parameters.
- Bad: UI shows V2EX as collectable but `crawl_auto_start` still requires Boss cookies.
- Bad: UI uses Boss availability as the condition for rendering Boss settings, causing Boss-only config to appear when only LinuxDo or V2EX is selected.
- Bad: frontend collapses selected sources into one payload and loses platform-specific filters/session behavior.
- Bad: Feed entries are written as Boss jobs or without a topic-based dedup key.
- Bad: filter profile allowed candidate sources are used as a pre-ingest collection gate.
- Bad: default filter profile allows only Boss while V2EX is an enabled automatic source; users see collected V2EX jobs blocked by "source not allowed".
- Bad: V2EX collection runs `https://www.v2ex.com/go/jobs` when the URL input is empty.
- Bad: a V2EX feed URL is rewritten into a paginated node URL.

### 6. Tests Required

- Worker unit tests:
  - Atom parser extracts title, normalized topic URL, topic id, author, and text content.
  - Jobs-list parser extracts paged topic links, authors, timestamps, and fetches topic detail text before normalized job capture.
  - V2EX sorting and time-window filtering distinguish `published_desc` from `updated_desc`, including old posts bumped by recent replies.
  - V2EX jobs-list structured `datePublished` wins over visible activity timestamps for publish-time sorting and recent-day filtering.
  - V2EX `limits.maxPages` should bound page requests, while qualifying job count should come from the fetched pages instead of a hidden fixed cap.
  - V2EX empty URL input should not start collection.
  - V2EX multiple URL input should split by newline, comma, Chinese comma, and Chinese enumeration comma.
  - V2EX feed URLs should be fetched once without pagination.
  - V2EX page URLs should paginate to the page cap or empty page.
  - V2EX multi-source results should deduplicate by `topicId`.
  - HTML entity decoding handles `&nbsp;`.
  - classifier accepts clear hiring posts from positive signals only.
  - classifier does not let search keywords alone make a feed entry a job posting.
  - classifier ignores excluded keywords at feed stage so post-collection rules and AI judgement can handle soft exclusion.
  - LinuxDo category JSON parser extracts topic id, title, topic URL, author, excerpt, and timestamps.
  - LinuxDo direct API requester fetches category and topic JSON without launching a browser and carries the saved LinuxDo cookie header when provided.
  - LinuxDo topic JSON parser extracts first-post cooked text.
  - LinuxDo Cloudflare challenge detection recognizes common challenge HTML/text.
  - LinuxDo classifier accepts clear hiring posts and rejects keyword-only discussions.
  - LinuxDo title-level fallback builds normalized payload with `detail_status`.
  - Boss city array filters expand into one job-list request body per city code while sharing the other filters.
  - Boss natural job-list capture exposes `capture_source = "natural"`; DOM fallback exposes `"dom_fallback"`; page-context API fallback exposes `"api_fallback"`.
  - Boss HTML login/security-check responses are treated as recoverable risk/login states.
  - Boss empty-list / missing-stable-id runs emit `ERROR` before `FINISHED`.
- Rust tests:
  - `job_sources` seeds Boss as `boss`, V2EX/LinuxDo as `feed`, and reserved platforms as `manual_import`.
  - normalized V2EX upsert writes `source_platform`, `source_url`, `dedup_key`, display fields, `jd_text`, and `job_detail_raw.zp_data_json` with `jobInfo.postDescription`.
  - default filter profile includes V2EX and legacy Boss-only default profile upgrades to Boss + V2EX.
- Frontend/browser smoke:
  - collection config source selector can select Boss and V2EX together.
  - Boss city selector supports multiple selected dictionary cities and explains that collection runs city variants sequentially.
  - V2EX pagination section appears when V2EX is selected among selected sources.
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
  - user-facing post-collection controls expose AI judgement preferences only: what to prefer, AI soft exclusions, risk focus, and uncertain-result strategy.
  - legacy deterministic profile fields may continue to load, save, and round-trip internally for compatibility, but must not be shown as editable form groups in the default config page.
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

- Good: automatic collection page shows the runtime delay, with no post-collection rule chooser.
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
- Sidecar records durable failures for missing stable job id, upsert failure, recompute failure, worker error, unsupported pending refresh, and missing Boss session in session-required commands.
- Running-run recovery is a startup-only concern. Query commands such as `list_collection_runs`, job queries, filter recompute commands, or sidecar event handling may open the DB while a collection is active; those paths must preserve `status='running'`.
- Pending evidence refresh reuses the worker `JOB_DETAIL_CAPTURED` event after fetching Boss detail. Rust sidecar performs the same upsert and filter recompute path as normal collection detail events.
- Non-Boss pending jobs or Boss jobs without usable session/path return a clear error and remain in the job library.
- No collection summary or evidence refresh path may add automatic apply, chat open, greeting send, or resume send behavior.

### 4. Validation & Error Matrix

- Boss selected without stored session -> collection starts with the persistent Boss browser profile; the run is only marked failed if the worker emits an actual `ERROR` or the user stops before login/verification can complete.
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

- Boss worker may use the lightweight profile filter to control optional detail-fetch priority and volume.
- Boss worker must still emit the original full job-list raw payload through `JOB_LIST_CAPTURED`; do not replace the list with only eligible jobs.
- Boss worker must be able to collect and store list-item jobs when `limits.bossDetailFetchLimit` / `limits.detailFetchLimit` is missing or `0`; detail fetch must not be the success gate for automatic collection.
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

- Good: Boss list response has ten rows, the worker emits `JOB_LIST_CAPTURED.raw.zpData.jobList` with all ten rows and the sidecar inserts list-item jobs without requiring detail fetch.
- Good: `limits.bossDetailFetchLimit = 3` lets the worker optionally fetch at most three details after list capture, guarded by the same risk wait/retry path.
- Good: V2EX normalized job stores `jd_text`; Rust recompute can satisfy `mustKeywords` from the post body.
- Good: A weak Boss list-only job missing JD cannot prove required JD terms, so it enters pending confirmation instead of disappearing.
- Base: old filter result rows without a bucket still render using `eligible`.
- Bad: `withFilteredJobListRaw(jobListRaw, eligibleJobs)` before emitting `JOB_LIST_CAPTURED`.
- Bad: page queries re-implement profile matching instead of consuming `job_filter_result.reason_json`.

### 6. Tests Required

- Worker contract test:
  - assert `JOB_LIST_CAPTURED` emits `raw: jobListRaw`
  - assert worker can still set `jobsToCapture = eligibleJobs` for detail priority
  - assert Boss detail fetches are opt-in and default to `0`, so `maxJobs` is not used as a worker-side detail loop cap
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

## Scenario: Job Library AI Audit Filters

### 1. Scope / Trigger

- Trigger: the Jobs page exposes AI judgement status as a filter dimension.
- Applies when changing `Jobs.vue` filter controls, `useJobsPage.ts` candidate loading, `list_job_candidates`, or `job_filter_result.reason_json` bucket handling.
- Keep AI audit status separate from manual job status. Manual status describes user workflow; AI audit describes post-collection judgement.

### 2. Signatures

- Frontend state:
  - `selectedAiAuditFilters: Array<"ai_passed" | "ai_rejected" | "ai_pending">`
- Frontend request:
  - `list_job_candidates({ aiAuditFilters: selectedAiAuditFilters.value, ... })`
- Tauri command:
  - `list_job_candidates(..., status_filters: Option<Vec<String>>, ai_audit_filters: Option<Vec<String>>, source_platforms: Option<Vec<String>>, collection_methods: Option<Vec<String>>, ...)`
- SQLite source of truth:
  - `job_filter_result.reason_json.bucket`
  - fallback: `job_filter_result.eligible`

### 3. Contracts

- The Jobs page must render AI audit filters in a dedicated group labeled for AI review, not inside the manual job status group.
- Accepted filter values map to canonical buckets:
  - `ai_passed` -> `recommended`
  - `ai_rejected` -> `filtered`
  - `ai_pending` -> `pending_confirmation`
- Query code reads `reason_json.bucket` first.
- Legacy filter rows without a bucket fall back through `eligible`:
  - `eligible = 1` -> recommended-style match
  - `eligible = 0` -> filtered-style match
- Unknown AI audit filter values are ignored rather than broadening the query.

### 4. Validation & Error Matrix

- `aiAuditFilters` empty or missing -> do not add an AI audit SQL predicate.
- `aiAuditFilters` contains only unknown values -> do not add an AI audit SQL predicate.
- `reason_json.bucket = pending_confirmation` with `eligible = 0` -> matches only `ai_pending`, not `ai_rejected`.
- Legacy row with `eligible = 0` and no bucket -> matches `ai_rejected`.

### 5. Good/Base/Bad Cases

- Good: user selects “不通过” in AI 审核; query returns jobs whose canonical bucket is `filtered`.
- Good: user combines AI 审核 with platform and collection-method filters; all predicates apply together.
- Base: old rows without `reason_json.bucket` still appear under AI passed/rejected based on `eligible`.
- Bad: put `ai_passed` / `ai_rejected` / `ai_pending` into `status_filters`; this mixes AI review with manual workflow state and can shift positional command parameters.
- Bad: infer AI audit status from score labels or UI-only text.

### 6. Tests Required

- Frontend contract tests:
  - assert `AI_AUDIT_FILTER_OPTIONS`, `selectedAiAuditFilters`, and `toggleAiAuditFilter` exist.
  - assert `list_job_candidates` receives `aiAuditFilters` independently from `statusFilters`.
- Rust query tests:
  - assert `ai_rejected` returns `bucket = filtered`.
  - assert `ai_pending` returns `bucket = pending_confirmation`.
  - assert source-platform and collection-method filters still bind to their own parameters after adding `ai_audit_filters`.

### 7. Wrong vs Correct

#### Wrong

```ts
statusFilters: [...selectedJobStatusFilters.value, ...selectedAiAuditFilters.value]
```

#### Correct

```ts
statusFilters: selectedJobStatusFilters.value,
aiAuditFilters: selectedAiAuditFilters.value,
```

#### Wrong

```rust
list_job_candidates_on_conn(conn, bucket, query, start, end, processed, status, source, collection, limit, offset)
```

#### Correct

```rust
list_job_candidates_on_conn(conn, bucket, query, start, end, processed, status, ai_audit, source, collection, limit, offset)
```
