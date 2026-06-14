# Job-Sync 二开最终验收审计

本文档用于收口 `docs/job-sync-remote-tech-jobs-requirements.md`。结论只基于当前仓库证据：代码、测试、构建记录、Tauri/Browser 烟测记录和 Trellis 子任务验收。需要用户本机登录态、API Key、模型服务或企业微信 Webhook 的项目，不在无凭据环境中冒充完成。

## 总体结论

- **仓库内实现闭环**：Boss-first 采集、统一职位模型、筛选画像、Top 20 审核、黑名单/沟通状态、Company Score、AI 打招呼、每日岗位情报、模型供应商配置、简历工作区和 PDF 联动，已有代码和自动化/烟测证据。
- **仍需用户本机实测**：真实 Boss 登录态复用、真实 Boss 数据采集、真实模型服务连通性与质量样例、企业微信外网发送。这些依赖用户账号、服务或 Webhook，当前仓库只能提供诊断入口和脱敏摘要复制。
- **安全边界保持成立**：当前实现不提供自动投递、自动群发、自动开聊或绕过平台风控能力；通知和打招呼都停留在人工确认、复制或手动触发。

## Phase 审计

| Phase | 当前结论 | 主要证据 | 剩余实测 |
| --- | --- | --- | --- |
| Phase 0：Mac Tauri 适配 | 部分闭环 | `docs/job-sync-phase0-baseline.md` 记录架构、命令、schema、Mac Chrome、sidecar、`.app` / `.dmg`、release 桌面烟测和 Tauri dev 复验；`src/pages/Settings.vue` 提供外部依赖诊断和脱敏摘要复制。 | 用户真实 Boss 登录态、真实模型服务、企业微信 Webhook 需要本机配置后诊断。 |
| Phase 1：统一职位来源模型 | 已闭环 | `src-tauri/src/db/schema.sql`、`src-tauri/src/db/models/source_adapter.rs`、`src-tauri/src/commands/jobs/mutations.rs` 覆盖 Boss 与手动导入平台统一入库；`test/review-workflow-contract.test.js` 有 registry 守卫。 | 非 Boss 自动采集仍是后续扩展，不属于首期实现范围。 |
| Phase 2：筛选画像与硬限制 | 已闭环 | `src-tauri/src/commands/filter_profile.rs`、`src/lib/filterProfile.ts`、`src/pages/Jobs.vue`、`src/pages/Crawl.vue`；Rust 和 contract 测试覆盖多维筛选、Boss-only、沟通状态和解释。 | 后续可补更多真实 UI 数据样例。 |
| Phase 3：评分与排序 | 已闭环 | `src-tauri/src/commands/jobs/models.rs` 和 `queries.rs` 计算/排序评分；`JobsJobItem.vue` 展示评分和原因；Rust/contract 测试覆盖权重、排序和 Resume Match 证据。 | 真实岗位数据下的排序人工验收。 |
| Phase 4：黑名单与排除 | 已闭环 | `mutations.rs`、`queries.rs`、`filter_profile.rs` 实现黑名单和排除；测试覆盖关键词、公司、职位、手动不合适和恢复候选。 | 真实 UI 数据回归。 |
| Phase 5：沟通记录 | 已闭环 | `job_review_state` / `company_review_state`、`JobsJobItem.vue`、`useJobsPage.ts`；测试覆盖上次打招呼、备注和同公司负面历史。 | 平台页面自动读取沟通状态仍属后续能力。 |
| Phase 6：Company Score | 已闭环 | `src-tauri/src/db/models/company_score.rs`、`src-tauri/src/commands/ai/company_score.rs`、worker `companyScore` 模块；测试覆盖外包、培训、电话销售、低信息和缓存复用。 | 真实模型质量样例需要用户本机模型服务。 |
| Phase 7：Top 20 审核队列 | 已闭环 | `src/pages/Jobs.vue`、`JobsJobItem.vue`、`useJobsPage.ts`；contract 测试和 release `.app --data-dir /tmp/job-sync-desktop-smoke` 桌面烟测覆盖 Top 20、投递准备台、每日情报和简历工作区。 | 真实 Boss 数据下人工验收。 |
| Phase 8：定制打招呼 | 已闭环 | `src-tauri/src/commands/ai/greeting.rs` 限制准备投递后生成；worker prompt/schema 和 contract 测试覆盖可编辑草稿、失败重试和禁止发送。 | 真实模型输出质量需人工样例回归。 |
| Phase 9：每日岗位情报 | 已闭环 | `queries.rs` 生成统计；`useJobsPage.ts` 支持复制、本机通知、邮件草稿和企业微信手动通知；设置页诊断 Webhook 状态且不回显。 | 企业微信真实发送需用户手动触发实测。 |
| Phase 10：模型供应商 | 已闭环 | `src-tauri/src/commands/ai/config.rs`、`settings.rs`、`src/pages/Settings.vue`、worker prompt extra/schema extra；测试覆盖供应商、脱敏、环境变量、schema extra 和诊断入口。 | Ollama/DeepSeek/OpenAI Compatible 实际连通性依赖用户服务和凭据。 |

## 总体验收标准审计

| 编号 | 当前结论 | 证据摘要 |
| --- | --- | --- |
| 1 | 已闭环 | Boss 自动采集写入统一模型；猎聘、智联、脉脉、V2EX、LinuxDo 可手动导入到同一 SQLite-backed 模型。 |
| 2 | 部分闭环 | fixture 数据已在 Mac Tauri release `.app` 完成核心页面和 worker 烟测；真实 Boss 登录、真实采集和外部服务仍需用户本机验证。 |
| 3 | 已闭环 | 2026-06-15 复验 `npm run tauri:dev` 启动 Vue、Rust Tauri dev shell 和 worker build 前置。 |
| 4 | 已闭环 | 当前 Boss-first，source adapter registry 支持后续平台扩展。 |
| 5 | 已闭环 | 多筛选画像、必须满足、必须排除和偏好加权已接入。 |
| 6 | 已闭环 | 薪资、远程/工作方式、时间、方向、技术、不想做技术、城市、经验、学历、公司、关键词、来源、沟通状态均在画像/测试中覆盖。 |
| 7 | 已闭环 | 硬限制和排除命中不会进入推荐排序。 |
| 8 | 已闭环 | 排序岗位具备 Resume、Preference、Company、Final 四类分数。 |
| 9 | 已闭环 | Final Score 默认偏向简历匹配，权重可随筛选画像调整。 |
| 10 | 已闭环 | 公司、职位、关键词黑名单和自定义排除规则参与推荐过滤。 |
| 11 | 已闭环 | 已拒绝、手动不合适、默认过滤的已读未回不会进入推荐。 |
| 12 | 已闭环 | 已打招呼未读可重新进入并显示状态和上次时间。 |
| 13 | 已闭环 | 用户可手动标记公司或岗位不合适，并影响下次筛选。 |
| 14 | 已闭环 | Top 20 人工审核队列已实现并在 fixture 桌面烟测中显示。 |
| 15 | 已闭环 | AI 可生成可编辑打招呼草稿；应用无自动投递入口。 |
| 16 | 已闭环 | 每日岗位情报可从本地职位数据生成。 |
| 17 | 已闭环 | Ollama、DeepSeek、OpenAI Compatible 均为设置页一等选项。 |
| 18 | 已闭环 | 简历工作区、最终稿和 PDF 路径可与准备投递岗位联动。 |
| 19 | 已闭环 | UI 和契约测试持续约束“精准求职/岗位研究”文案和无自动投递边界。 |

## 用户本机外部依赖验收清单

以下步骤必须在用户具备相应账号、服务或 Webhook 的本机执行。记录证据时使用设置页“复制诊断摘要”，不要粘贴密钥、Webhook URL、Cookie、LocalStorage 原文或平台个人信息。

### 1. Boss 登录态复用

前置条件：

- Mac 已安装 Chrome。
- 用户可人工登录 Boss。
- 使用 Tauri 桌面端运行应用。

操作：

1. 打开采集页，按当前应用流程完成人工登录。
2. 返回设置页，点击“运行诊断”。
3. 点击“复制诊断摘要”保存脱敏结果。

期望结果：

- Boss 登录复用状态为正常。
- Cookie 文件和 LocalStorage 文件均显示存在且 JSON 可解析。
- 摘要不包含 Cookie 或 LocalStorage 内容。

### 2. 真实 Boss 数据采集

前置条件：

- Boss 登录态复用已通过。
- 用户确认本次采集范围符合平台使用边界，不做刷取或绕过风控。

操作：

1. 在采集页手动触发小范围采集或元数据同步。
2. 观察运行日志和任务状态。
3. 打开职位库，确认新职位进入本地队列，并可看到来源、筛选解释或过滤结果。

期望结果：

- worker 正常启动并结束。
- 职位写入 SQLite-backed 本地模型。
- 不触发自动投递、自动开聊或批量发送。

### 3. 模型服务连通性

前置条件：

- 已配置 Ollama、本地兼容 API、DeepSeek 或 OpenAI Compatible 服务。
- 如使用远程服务，用户本机已安全保存 API Key 或设置环境变量。

操作：

1. 设置页选择模型供应商、Base URL、模型和必要参数。
2. 点击“运行诊断”。
3. 复制脱敏诊断摘要。
4. 在职位库或简历工作区手动触发一次 AI 分析/重试，保存成功或失败提示截图。

期望结果：

- 诊断能读取模型列表或给出明确错误。
- 成功时显示模型数量和少量样例；失败时保留可重试错误。
- UI 不回显已保存 API Key。

### 4. 企业微信手动通知

前置条件：

- 用户拥有企业微信机器人 Webhook。
- 已明确允许从本机向该机器人发送一条测试通知。

操作：

1. 设置页保存 Webhook。
2. 点击“运行诊断”并复制脱敏摘要。
3. 打开职位库每日岗位情报区域，手动点击企业微信通知入口。
4. 在企业微信中确认收到摘要。

期望结果：

- 设置页只显示 Webhook 已保存和格式状态，不回显 URL。
- 发送只发生在用户点击每日岗位情报手动通知入口时。
- 通知内容只包含摘要和入口，不触发投递。

### 5. 真实端到端人工流程

前置条件：

- Boss 登录态、至少一个模型服务、真实职位数据均可用。

操作：

1. 采集少量职位。
2. 用当前默认筛选画像重算。
3. 查看 Top 20，确认至少一个岗位展示硬限制、评分、公司风险和沟通状态。
4. 人工标记准备投递。
5. 生成或编辑打招呼草稿。
6. 打开联动简历工作区，确认最终稿/PDF 状态。
7. 复制投递材料包。

期望结果：

- 每一步都需要人工确认。
- 应用只生成建议、摘要、草稿和材料包，不自动发送或投递。
- 任何失败都有明确提示或可重试入口。

## 交付判断

- 可以归档的范围：当前仓库内二开实现、自动化测试、fixture 桌面烟测和手动验收入口。
- 不能在无用户凭据环境中归档为实测完成的范围：真实 Boss 登录态、真实 Boss 数据采集、真实模型服务质量、企业微信真实发送。
- 下一次需要用户参与时，优先执行“用户本机外部依赖验收清单”，并把脱敏诊断摘要、截图或日志结果补回覆盖审计。
