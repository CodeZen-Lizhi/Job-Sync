# 接入猎聘采集渠道设计

## Architecture

新增猎聘自动采集按“智联式 normalized adapter”接入，而不是扩展 BOSS 专用分支：

1. Frontend source registry and config
   - 新增 `LIEPIN_SOURCE_PLATFORM = "liepin"`。
   - `liepin` 从 `MANUAL_IMPORT_SOURCE_PLATFORMS` 移入 `COLLECTABLE_SOURCE_PLATFORMS`。
   - `JobSourcePlatformOption.adapterKind` 增加 `liepin`。
   - `CrawlConfig.vue` 增加猎聘专属配置区，字段对齐智联：关键词、城市/地区、薪资/经验/学历等可选透传字段、原始参数、页数、岗位数。

2. Tauri source/session/profile
   - `job_sources` 注册 `liepin` 为自动 adapter kind。
   - 新增独立 storage path：
     - `liepin-cookies.json`
     - `liepin-local-storage.json`
     - `liepin-browser-profile`
   - `crawl_auto_start` 对 `liepin` 使用 optional session，并传入 `liepin-browser-profile`。
   - `auth` 允许 `start_login/get_login_status` 管理猎聘 profile，状态判断至少要求 profile 存在且 cookie/localStorage 快照可读。

3. Worker mode
   - 在 `runAutoMode` 中先分流 `source_platform === "liepin"` 到新增 `runLiepinMode`。
   - 新增 `packages/boss-crawler-worker/src/liepin/feed.ts`，职责与 `zhilian/feed.ts` 类似：
     - 构建搜索 URL。
     - 解析搜索 API/HTML/DOM 证据。
     - 解析详情页正文。
     - 检测登录/安全验证/反爬页。
     - 构建 `JOB_NORMALIZED_CAPTURED` payload。
   - 初期优先使用持久浏览器 profile 的 PC 搜索页 DOM 读取；公开 HTTP 请求只作为低成本探针。原因：2026-07-04 探测到猎聘 `/zhaopin/?key=Java&currentPage=0` 初始 HTML 只有 `#lp-search-job-box` 容器，职位由 `search-jobs.58584717.js` 渲染，且响应设置 `acw_tc` / `XSRF-TOKEN` cookie。

4. Persistence and downstream behavior
   - 不新增 DB 表；复用 `JOB_NORMALIZED_CAPTURED` -> Rust normalized upsert -> `job` / `job_source_link` / `job_detail_raw`。
   - `source_platform = "liepin"`、`encrypt_job_id = "liepin:<stableId>"`、`dedup_key = <stableId>`。
   - `job_detail_raw.zp_data_json.jobInfo.postDescription` 由 existing normalized detail projection 构造。
   - 默认 filter profile 加入 `liepin`，避免采集后被默认 sourcePlatforms 过滤掉。

## Data Flow

```text
CrawlConfig liepin fields
  -> crawl_auto_start(SearchTaskPayload)
  -> Tauri creates collection_run and loads liepin session/profile
  -> worker runAutoMode dispatches runLiepinMode
  -> Liepin search/detail parser builds normalized job events
  -> sidecar persists normalized jobs and run outcomes
  -> frontend refreshes collection runs / inserted ids
  -> post-collection filter + AI judgement runs for newly inserted jobs
```

## Contracts

- Frontend payload:
  - `keywords: string[]`
  - `source_platform: "liepin"`
  - `filters.city?: string[]`
  - optional pass-through fields: `salary`, `experience`, `degree`, `industry`, `company_type`, `company_scale`, `job_type`, `publish_date`, `sort_by`, `raw_params`
  - `limits.maxPages?: number`
  - `limits.maxJobs?: number | null`
  - `limits.delayMs?: number`
- Worker normalized event:
  - `encrypt_job_id` must start with `liepin:`
  - `source_platform` must equal `liepin`
  - `dedup_key` must be stable across repeated crawls
  - `source_url` should be a `liepin.com` detail URL when available
  - `raw_payload.detail_status` is `ok`, `missing`, or `blocked`

## Error Handling

- Empty keywords: frontend blocks start.
- Missing `liepin-browser-profile`: worker emits `ERROR` telling user to connect Liepin from Settings.
- Login/security verification detected before any stable job: worker emits terminal `ERROR`, not `FINISHED` alone.
- Search page returns no stable id/title: emit explicit `ERROR` when no normalized job was produced.
- Detail blocked after stable list evidence: insert list-level normalized job with missing/blocked detail marker.

## Compatibility

- Existing BOSS, 智联, V2EX, LinuxDo payloads must remain unchanged.
- Existing manual `maimai` behavior remains unchanged.
- Existing rows where `liepin` is a manual source remain valid; adapter kind migration updates the source registry going forward.

## Trade-offs

- Recommended MVP does not implement投递、沟通状态同步或猎聘站内消息；这些能力需要单独协议和 UI，不属于“像智联/BOSS 一样采集入库”的核心路径。
- DOM/profile-first 比纯 HTTP API 更慢，但更符合猎聘当前前端渲染与 cookie/安全策略，也更接近智联的抗失败路径。
