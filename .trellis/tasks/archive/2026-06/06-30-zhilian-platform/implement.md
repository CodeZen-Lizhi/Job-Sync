# 智联招聘平台功能执行计划

## Pre-Implementation

- [x] 初步调研智联当前公开入口和开源抓取方式：
  - `www.zhaopin.com` 当前环境触发 EdgeOne 安全验证。
  - 老开源项目常用 `fe-api.zhaopin.com/c/i/sou`，但当前常见参数只返回空列表。
  - 较新项目/Issue 指向 `search/positions`、`salesman-search/v2`、`jobs/{id}/info` 等需要 Cookie/CSRF/加密参数的新端点。
  - `m.zhaopin.com` 部分公开聚合页可匿名返回岗位列表 HTML。
- [x] 实现前用 worker/浏览器上下文再次确认智联当前可用搜索入口、详情 URL、稳定岗位 ID、列表字段和详情正文来源。
- [x] 读取相关代码上下文：
  - `src/lib/crawl.ts`
  - `src/lib/useCrawlPage.ts`
  - `src/pages/CrawlConfig.vue`
  - `packages/boss-crawler-worker/src/modes/auto/run.ts`
  - `packages/boss-crawler-worker/src/protocol.ts`
  - `src-tauri/src/commands/crawl.rs`
  - `src-tauri/src/db/models/source_adapter.rs`
  - `src-tauri/src/db/models/filter_results.rs`
  - `src-tauri/src/sidecar/mod.rs`
- [x] 复查 `.trellis/spec/boss-crawler-worker/frontend/collection-source-contracts.md`，确保新增平台仍遵守 collection source contract。

## Implementation Checklist

- [x] Worker：新增智联解析/采集模块。
  - [x] URL 归一化和详情 ID 提取。
  - [x] 公开 API/公开移动页面列表解析。
  - [x] 详情正文解析或列表级 `jd_text` fallback。
  - [x] normalized payload 构造。
  - [x] 空结果、缺稳定 ID、请求失败、EdgeOne/登录/验证码拦截的明确日志/错误。
- [x] Worker：在 `runAutoMode` 中路由 `source_platform === "zhilian"`。
- [x] Worker：新增单测覆盖解析和 normalized payload。
- [x] Frontend types：将智联加入可采集来源和自动 adapter option。
- [x] Frontend state：新增智联配置状态、持久化字段、sanitize/apply/build task/validate/open selected panel。
- [x] Frontend UI：在 `CrawlConfig.vue` 新增智联配置面板，遵循现有 V2EX/LinuxDo 面板风格。
- [x] Rust registry：将智联从 `manual_import` 注册为自动采集 adapter。
- [x] Rust crawl command：智联使用 optional session，必要时配置 profile path。
- [x] Storage：如果采用可见浏览器路线，新增智联专用 browser profile/cookie/localStorage 路径。
- [x] Rust filter defaults：默认允许来源加入 `zhilian`，并覆盖 legacy upgrade。
- [x] Tests：补齐 Rust/JS contract tests，确保平台列表、默认来源和 normalized upsert 一致。

## Validation Commands

- [x] `npm -w @job-sync/boss-crawler-worker run test`
- [x] `npm run build`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] 必要时运行更窄测试：
  - [x] `node --test test/review-workflow-contract.test.js`
  - [x] `node --test test/boss-canary.test.js`
  - [x] `node --test test/boss-db-canary.test.js`

## Manual Smoke

- [x] 启动前端/Tauri dev server 或至少运行前端构建。
- [ ] 打开采集配置页，确认选择智联后只显示智联专属面板，不误显示 Boss 字典。
- [ ] 使用低页数/低岗位上限进行智联采集烟测。
- [ ] 确认运行日志、采集记录、岗位列表来源标签和筛选结果正常。

## Review Gates

- [x] 代码修改后执行 `trellis-check`。
- [x] 如修改 Java：执行 `java-review`。本任务未涉及 Java。
- [x] 交付前检查 diff：无硬编码 secret、无无关重构、无静默 fallback、无第二套来源事实。

## Rollback Points

- Worker 智联模块独立，可单独移除路由和文件。
- 前端智联配置字段独立，可恢复为 manual import 预留来源。
- Rust registry/default filter 的智联自动来源改动可单点恢复。
