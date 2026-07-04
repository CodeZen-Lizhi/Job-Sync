# 全项目优化审计报告

## Executive Summary

本次只读审计没有发现需要立即阻断发布的 P0 问题。项目整体测试护栏较强：前端类型构建、review contract、canary、worker 测试、Rust 单测都通过。当前最值得优先优化的是：Jobs 热点查询的同公司历史关联缺少显式索引/投影、跨层协议仍有弱类型边界、外部依赖诊断 spec 与实现漂移，以及若干超大文件导致后续功能叠加风险上升。

建议后续不要一次性重构全项目，而是拆 4 个小任务：

1. Jobs 公司维度查询性能加索引或投影。
2. 收紧 worker/Rust/frontend 稳定事件字段的类型合同。
3. 更新外部依赖诊断 Trellis spec，使 Telegram 合同成为单一事实源。
4. 分阶段拆分 `useCrawlPage.ts`、`useJobsPage.ts`、`queries.rs` 与 worker feed 公共工具。

## Validation

| Command | Result | Notes |
| --- | --- | --- |
| `npm run build` | Pass | `vue-tsc --noEmit` 和 Vite production build 通过；主 bundle 约 424.26 kB，gzip 127.49 kB。 |
| `npm run test` | Pass | review workflow contract 60 项、Boss/Zhilian canary 与 DB canary、worker 87 项均通过。 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Pass | 无格式差异。 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass with warnings | 162 passed，1 ignored；有 dead code warnings，见 P3-1。 |

## Findings

### P1-1 Jobs 同公司历史查询缺少 `job.brand_name` 索引或预聚合投影

**Evidence**

- `src-tauri/src/commands/jobs/queries.rs` 的候选列表 SQL 对每个候选 row 执行 3 个同公司历史相关子查询，均通过 `company_job.brand_name = j.brand_name` 关联：`COUNT`、最新状态、最新更新时间。
- 相同模式在多个 list/query 分支重复出现，例如 `LIST_JOBS_LIKE_SQL` 和 source keyword 查询。
- `src-tauri/src/commands/filter_profile.rs` 的 `recompute_default_filter_profile_for_company_on_conn` 直接执行 `SELECT encrypt_job_id FROM job WHERE brand_name = ?1 ORDER BY encrypt_job_id ASC`。
- `src-tauri/src/db/schema.sql` 只看到 `idx_job_last_seen_id`、source link、projection、review status 等索引，没有 `job(brand_name)` 或 `(brand_name, encrypt_job_id)`。
- contract test 只确认同公司历史功能存在，没有检查查询计划或索引。

**Impact**

职位库扩大后，同公司负面沟通历史、公司 review 状态传播、按公司重算筛选结果可能退化为按页面/候选重复扫描 `job` 表。它属于用户会在 Jobs 页面频繁触发的热路径。

**Recommendation**

优先加迁移索引 `idx_job_brand_name_id ON job(brand_name, encrypt_job_id)`，并补 Rust query-plan/performance 测试。如果同公司摘要未来还要扩展，考虑把 `company_negative_communication_count/latest_*` 收敛进 `job_list_summary_projection` 或新的 company summary projection。

**Suggested Task**

拆独立 P1：`jobs-company-query-performance`。

### P2-1 外部依赖诊断 spec 仍写 WeCom，但实现和测试已经是 Telegram

**Evidence**

- `.trellis/spec/boss-crawler-worker/frontend/external-dependency-diagnostics.md` 第 8、29、33、45-58、67-68 行描述 Enterprise WeChat / `wecom` / `WecomDiagnostic`。
- `src-tauri/src/commands/settings.rs` 的 `ExternalDependencyDiagnostics` 返回 `telegram: TelegramDiagnostic`，且 `PublicAppSettings` 已红acted Telegram token/chat id。
- `src/pages/Settings.vue` 的前端类型和 UI 展示 `diagnostics.telegram`。
- `test/review-workflow-contract.test.js` 的 contract test 已经断言 `diagnostics.telegram`、不暴露 `telegramBotToken`/`telegramChatId`，并且不再包含 `send_daily_job_intelligence_wecom_notification`。

**Impact**

这不是运行时 bug，但 active Trellis spec 是后续开发的项目规范入口。文档写 WeCom、代码写 Telegram，会让未来对诊断、通知、红线检查的改动出现错误事实源。

**Recommendation**

更新 spec，把 WeCom 全部替换为 Telegram 当前合同：`has_bot_token`、`bot_token_valid`、`has_chat_id`、`chat_id_valid`，并补充“诊断不触发 Telegram 发送”的红线。

**Suggested Task**

可作为小型 docs/spec 任务直接处理。

### P2-2 worker/Rust/frontend 协议边界仍有弱类型不对称

**Evidence**

- `packages/boss-crawler-worker/src/protocol.ts` 用 Zod 限定 `JobListCapturedPayloadSchema.capture_source` 为 `"natural" | "dom_fallback" | "api_fallback"`。
- `src/lib/protocol.ts` 前端也把 `capture_source` 写成同样 union。
- `src-tauri/src/ipc/protocol.rs` 中 `JobListCapturedPayload.capture_source` 仍是 `Option<String>`。
- `test/review-workflow-contract.test.js` 还显式断言 Rust 侧是 `pub capture_source: Option<String>`，等于把弱类型固定进 contract。
- worker schema 中大量稳定边界字段仍是 `z.any()`，Rust 对应大量 `serde_json::Value`，例如 `filters`、`limits`、AI job detail/context、normalized raw payload。

**Impact**

raw payload 用 `Value` 是合理兼容层，但稳定枚举/跨层合同字段继续弱类型，会让错误值穿过 Rust 层才在业务逻辑里被发现，或者被 contract test 误保护。

**Recommendation**

先选小切口：把 `capture_source` 做成 Rust enum，并把 contract test 从“匹配 `Option<String>`”改为“匹配 enum/拒绝未知值”。随后再逐步为 `SearchTaskPayload.filters/limits` 的平台稳定字段建立 typed projection，而不是一次性消灭所有 `Value`。

**Suggested Task**

拆 P2：`typed-sidecar-event-contracts`。

### P2-3 `src-tauri/src/commands/jobs/queries.rs` 过大且 SQL 片段重复，后续维护成本高

**Evidence**

- 行数扫描：`src-tauri/src/commands/jobs/queries.rs` 约 4,859 行，是全仓库最大业务文件。
- 该文件内多个查询重复构造相同 row shape、keyword blacklist 判定、company negative communication subquery、projection joins。
- 当前 contract test 能保护“不读 raw 大 JSON”的关键边界，但大量 SQL 字符串仍需要人工同步字段顺序和 mapper。

**Impact**

继续添加筛选、排序、候选摘要字段时，很容易出现某个查询分支漏字段、字段顺序和 mapper 偏移、或者性能合同只在部分路径生效。

**Recommendation**

不要一次重写。先抽出单一 row select builder 或 SQLite view 风格的共享片段；再把 company negative communication 和 blacklist summary 迁入 projection/辅助 CTE；最后补 query-plan tests。

**Suggested Task**

拆 P2：`jobs-query-shared-row-projection`。

### P2-4 前端 Jobs/Crawl 组合逻辑承担整页状态机，新增功能容易漏同步点

**Evidence**

- `src/lib/useJobsPage.ts` 约 1,945 行，包含筛选、分页、AI 公司评分、打招呼、岗位版简历、日报通知、黑名单、删除、状态更新等多类行为。
- `src/lib/useCrawlPage.ts` 约 1,546 行，包含平台 payload 构造、平台校验、配置持久化、定时调度、runtime summary、Boss meta、采后 AI 判断等。
- `useCrawlPage.ts` 中 `buildTaskForSource` 和 `validateCollectionSource` 通过平台分支维护 Liepin/Zhilian/LinuxDo/V2EX/Maimai/Boss 的 payload 和校验。

**Impact**

当前测试通过，但新增采集源、修改某个平台字段、或调整定时采集时，需要同步 payload 构造、校验、配置应用、UI 面板、source registry 多处逻辑。复杂度集中在单文件里，review 难度高。

**Recommendation**

按行为拆而非按 UI 拆：

- `useCrawlSources`：source registry、selected sources、平台 label/capability。
- `useCrawlTaskPayloads`：各平台 payload builder + validator。
- `useCrawlSchedule`：cron、next run、scheduled start。
- `useJobsCandidateList`、`useJobsActions`、`useJobsAiTools`：把 Jobs 页数据流和动作流分开。

**Suggested Task**

拆 P2/P3 分阶段重构，先从 `useCrawlTaskPayloads` 开始，风险最小。

### P2-5 worker feed adapters 有重复工具和超大文件，适合沉淀公共 adapter toolkit

**Evidence**

- worker 源码约 11,989 行；最大文件包括 `linuxdo/feed.ts` 1,091 行、`zhilian/feed.ts` 1,070 行、`v2ex/feed.ts` 902 行、`maimai/feed.ts` 702 行、`liepin/feed.ts` 520 行。
- 多个 feed 文件重复定义 `htmlToText`、`normalizePositiveInteger`、分页/URL split/blocked-page detection/normalized payload emit 等模式。
- 这些文件都在发 `JOB_NORMALIZED_CAPTURED`、`JOB_FILTERED`、`ERROR`、`FINISHED` 风格事件，合同相似但实现分散。

**Impact**

采集源越多，重复的 HTML 清洗、输入限制、跳过原因、错误上报和 detail fallback 规则越容易分叉。长期会导致某个平台修了明确错误，另一个平台仍保留旧行为。

**Recommendation**

抽一个低侵入工具层：`feed/html.ts`、`feed/input.ts`、`feed/events.ts`、`feed/pagination.ts`。先搬纯函数并保持测试，避免改动采集策略。

**Suggested Task**

拆 P2：`worker-feed-adapter-toolkit`。

### P2-6 regex 型 contract test 很强，但也在固化实现细节

**Evidence**

- `test/review-workflow-contract.test.js` 约 1,935 行，覆盖 60 个 contract。
- 它有效防止了很多架构回退，例如 Jobs list 不读 raw JSON、Boss low-risk、canary、Settings redaction。
- 但它也断言具体源码形态，例如 `pub capture_source: Option<String>`，这会把可以改进的弱类型边界变成“受保护实现细节”。

**Impact**

regex contract 对防回退有价值，但越多越可能让重构成本升高，甚至保护旧实现。

**Recommendation**

保留高价值 contract，但把部分“源码字符串匹配”替换为语义测试：

- 对 IPC enum/unknown value 做 Rust deserialize 单测。
- 对 SQL hot path 做 EXPLAIN QUERY PLAN 测试。
- 对前端类型边界用 `vue-tsc` 和小型 fixture reducer tests 兜住。

**Suggested Task**

与 P2-2/P1-1 联动处理。

### P3-1 Rust 测试通过但存在 dead code warning 噪音

**Evidence**

`cargo test` 通过，但输出 warnings：

- `NormalizedFilterProfile` 多个字段 never read。
- `filter_profile.rs` 中 `rule_type_of`、`has_any`、`matching_rules`、`text_matches_rule`、`keyword_hits`、`missing_keywords`、`date_from_prefix`、`days_since_date` 等函数 never used。
- `settings.rs` 中 `send_telegram_message_from_settings` never used。
- `job_source_payload.rs` 中 `get_job_source_payload` never used。

**Impact**

warning 本身不影响运行，但会降低未来 CI/本地输出的信噪比，也可能意味着历史重构后留下的死逻辑。

**Recommendation**

做一次小清理：确认是否确实无调用；删除死函数或加明确 `#[allow(dead_code)]` 仅保留测试/未来扩展入口。不要顺手改业务行为。

**Suggested Task**

可作为 P3 小任务。

### P3-2 bundle 可考虑按路由拆分，但当前不是瓶颈

**Evidence**

`npm run build` 输出主 JS `dist/assets/index-*.js` 约 424.26 kB，gzip 127.49 kB。项目是 Tauri 桌面应用，不是公网首屏站点。

**Impact**

目前不是高优先级问题；但 Settings/Jobs/Crawl/Resume 页面逻辑都较重，未来如果桌面启动或路由切换变慢，可考虑 route-level dynamic import。

**Recommendation**

先不做。等有启动耗时或 route performance 数据，再配合 `npm run perf:crawl-routes` 或浏览器 smoke 截图/性能记录处理。

## Positive Findings

- 构建产物没有被 git 跟踪；`.gitignore` 覆盖 `dist`、`src-tauri/bin/*`、`.playwright-mcp/`。
- Jobs/Resume performance boundary 有实际 schema、projection、Rust tests 和 contract tests 保护。
- Resume library 已按 overview/detail 分离，正文按需加载，符合性能合同。
- 多来源采集合同大体落地：source registry 加载、selected sources 顺序执行、run inserted job ids 聚合、采后 AI 只处理本轮新增 job ids。
- Settings 敏感信息 redaction 已有实现和 contract：API Key、Telegram token/chat id 不回显，诊断摘要不读取原始 form secret。
- Worker 对 Boss low-risk、自然 joblist、空列表/风险页 false success 有较强测试覆盖。

## Recommended Task Split

1. `jobs-company-query-performance` - P1，新增 `job(brand_name, encrypt_job_id)` 索引或同公司 summary projection，补 query-plan/perf test。
2. `external-diagnostics-spec-sync` - P2，更新 Trellis spec 从 WeCom 到 Telegram。
3. `typed-sidecar-event-contracts` - P2，先把 `capture_source` 收紧到 Rust enum，调整 contract test。
4. `crawl-task-payload-module` - P2/P3，拆 `useCrawlPage.ts` 中平台 payload builder/validator。
5. `worker-feed-adapter-toolkit` - P2/P3，抽纯工具，降低 feed adapters 重复。
6. `rust-warning-cleanup` - P3，清理 dead code warnings。

## Notes

- 本报告未修改业务代码。
- 真实 Boss/Zhilian 外部登录态 smoke 未执行；本次只运行了仓库内 mock/contract/canary 单测。
- 当前另有活跃任务 `07-04-boss-low-risk-mode/`，Boss low-risk 相关后续实现建议继续交给该任务或单独拆分，避免范围交叉。
