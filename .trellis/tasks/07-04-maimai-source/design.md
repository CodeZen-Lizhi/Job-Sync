# 接入脉脉招聘内容源设计

## Architecture

脉脉按 normalized feed adapter 接入，而不是按智联/猎聘标准职位搜索 adapter 接入：

1. Frontend source registry and config
   - 新增 `MAIMAI_SOURCE_PLATFORM = "maimai"`。
   - `maimai` 从 `MANUAL_IMPORT_SOURCE_PLATFORMS` 移入 `COLLECTABLE_SOURCE_PLATFORMS`。
   - `JobSourcePlatformOption.adapterKind` 增加 `maimai` 或复用 `feed`，推荐使用 `feed`，因为 MVP 是公开内容源，不是登录 profile 职位搜索 adapter。
   - `CrawlConfig.vue` 增加脉脉专属配置区：URL 列表、关键词、排序/时间窗口、页数、岗位数。

2. Tauri source/session/profile
   - `job_sources` 注册 `maimai` 为自动 adapter kind，推荐 `feed`。
   - `crawl_auto_start` 对 `maimai` 使用 optional session，不要求 Boss session。
   - MVP 不新增 `maimai-browser-profile`，除非实现阶段发现公开页面稳定性不足。若后续加登录兜底，必须独立使用 `maimai-browser-profile`、`maimai-cookies.json`、`maimai-local-storage.json`，不能复用其他平台。

3. Worker mode
   - 在 `runAutoMode` 中分流 `source_platform === "maimai"` 到新增 `runMaimaiMode`。
   - 新增 `packages/boss-crawler-worker/src/maimai/feed.ts`：
     - 分割用户配置 URL。
     - 识别文章详情 URL 与列表/搜索 URL。
     - 解析文章详情页。
     - 从列表/搜索页提取文章详情链接并按页数上限分页。
     - 检测登录/安全验证/不可读页面。
     - 用招聘信号分类，过滤非招聘内容。
     - 构建 `JOB_NORMALIZED_CAPTURED` payload。
   - 第一版以直接 HTTP fetch + HTML parser 为主；如果页面返回登录/验证 HTML，发出明确错误或日志，不尝试绕过。

4. Persistence and downstream behavior
   - 不新增 DB 表；复用 `JOB_NORMALIZED_CAPTURED` -> Rust normalized upsert -> `job` / `job_source_link` / `job_detail_raw`。
   - `source_platform = "maimai"`。
   - `encrypt_job_id = "maimai:article:<stableId>"`。
   - `dedup_key = "article:<stableId>"`。
   - `job_detail_raw.zp_data_json.jobInfo.postDescription` 使用 normalized detail projection。
   - 默认 filter profile 加入 `maimai`。

## Data Flow

```text
CrawlConfig maimai fields
  -> crawl_auto_start(SearchTaskPayload)
  -> Tauri creates collection_run with optional session
  -> worker runAutoMode dispatches runMaimaiMode
  -> Maimai URL/list/article parser finds article entries
  -> classifier accepts only clear hiring/referral content
  -> worker emits JOB_NORMALIZED_CAPTURED
  -> sidecar persists normalized jobs and run outcomes
  -> frontend runs post-collection filter + AI judgement for newly inserted jobs
```

## Contracts

- Frontend payload:
  - `keywords: string[]`
  - `source_platform: "maimai"`
  - `filters.feed_urls?: string[]`
  - `filters.article_urls?: string[]`
  - `filters.sort_by?: "published_desc" | "updated_desc"`
  - `filters.recent_days?: number | null`
  - `limits.maxPages?: number`
  - `limits.maxJobs?: number | null`
  - `limits.delayMs?: number`
- Worker normalized event:
  - `encrypt_job_id` starts with `maimai:article:`
  - `source_platform` equals `maimai`
  - `dedup_key` is stable across repeated crawls
  - `source_url` is a `maimai.cn/article/detail` URL when available
  - `raw_payload.detail_status` is `ok`, `missing`, or `blocked`
  - `raw_payload.classification` records hiring signal matches or skip reason

## Error Handling

- Empty URL input: frontend blocks start.
- Non-positive page/job limits: frontend blocks start.
- Configured URL is not `maimai.cn`: frontend or worker rejects with clear error.
- Article/list page returns login/verification/403/429: worker emits explicit `ERROR` when no stable article/job was produced; if some articles were already processed, log and stop that URL.
- Article lacks stable id or title: skip with structured reason.
- Article lacks positive hiring/referral signals: emit `JOB_FILTERED` or log skip; do not insert.
- Worker produces zero accepted jobs and zero parsed articles: emit `ERROR`, not `FINISHED` alone.
- Worker parses articles but all are non-hiring: finish with clear summary log and filtered counts; this is not a false success if filtering events/logs explain why.

## Compatibility

- Existing Boss, 猎聘, 智联, V2EX, LinuxDo behavior must remain unchanged.
- Existing manually imported `maimai` rows remain valid; adapter kind migration updates source registry going forward.
- Source filter profile remains post-ingest only; it must not block raw脉脉 articles before classification/ingest.

## Trade-offs

- Public article feed first is safer and closer to current content-source adapters, but may miss脉脉 App-only jobs.
- Login profile fallback can improve coverage later, but increases privacy, security, and anti-bot complexity; it is intentionally out of MVP unless public pages are unusable.
- We should not use open-source examples that scrape contacts or enterprise candidate recommendations for this MVP because they solve a different product problem and touch higher-risk data.

