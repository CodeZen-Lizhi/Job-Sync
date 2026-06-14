# Job-Sync 二开需求覆盖审计

本文档审计 `docs/job-sync-remote-tech-jobs-requirements.md` 的当前实现覆盖情况。状态只基于当前仓库证据：代码、契约测试、Rust/worker 测试、已记录的运行结果和页面烟测。没有强证据的项不标为完成。

父级收口审计见 `docs/job-sync-final-acceptance-audit.md`。该文档按 Phase 0-10 和 19 条总体验收标准区分仓库内已闭环范围与仍需用户本机凭据/服务的外部依赖实测项。

状态说明：

- `已闭环`：有实现、测试或运行结果能证明需求成立。
- `部分闭环`：核心路径已实现，但仍缺端到端、实机、平台或数据覆盖。
- `待补`：当前只能看到规划或弱证据，不能证明需求已实现。

## Phase 覆盖矩阵

| Phase | 需求重点 | 当前状态 | 证据 | 待补事项 |
| --- | --- | --- | --- | --- |
| Phase 0：源码基线与 Mac Tauri 适配 | Mac Tauri 开发启动、Chrome 路径、sidecar、本机打包边界、命令清单、数据流图 | 部分闭环 | `docs/job-sync-phase0-baseline.md` 已记录架构、命令、Chrome 路径、sidecar、schema、数据流；`README.md` 记录 Mac Chrome 路径、`npm run tauri:dev`、`npm run tauri:build:app` 和 `npm run tauri:build`；`src-tauri/src/commands/auth.rs` 现在要求 Cookie 和 LocalStorage 都存在才返回已登录，并有 Rust 单测覆盖；`src-tauri/src/commands/settings.rs` 提供外部依赖诊断，能检查 Boss Cookie/LocalStorage 存在性和 JSON 可解析性且不回显内容；设置页可复制脱敏诊断摘要用于本机验收记录；`test/review-workflow-contract.test.js` 锁定 release 包装平台感知、app-only 构建入口、旧 target runtime 清理、外部依赖诊断入口和诊断摘要复制边界；`packages/boss-crawler-worker/test/sidecar-lifecycle.test.ts` 验证本机 Node worker 生命周期；`src-tauri/tauri.conf.release.json` 配置 macOS ad-hoc 签名；2026-06-14 本机 `npm run tauri:build:app` 已生成 `src-tauri/target/release/bundle/macos/job-sync.app`，并通过 `.app` 签名和包内 worker runtime 生命周期校验；2026-06-14 本机 `npm run tauri:build` 已生成 `src-tauri/target/release/bundle/macos/job-sync.app` 和 `src-tauri/target/release/bundle/dmg/job-sync_0.1.0_aarch64.dmg`，并通过 `.app` 签名、包内 worker runtime 生命周期和 `hdiutil verify`；2026-06-14 使用 `/tmp/job-sync-desktop-smoke` fixture 启动 release `.app`，Computer Use 验证采集页、职位库、设置页和简历工作区能通过 Tauri IPC 读取本地数据；2026-06-14 使用 `/tmp/job-sync-crawl-worker-smoke` fixture 启动 release `.app`，Computer Use 在采集页点击 `同步城市、行业与筛选项` 后观察到 UI `运行中` 状态和运行日志 `boss-crawler-worker started`、`同步 Boss 城市、行业与筛选项…`、`已同步城市、行业与筛选项。`、`任务已结束。`；2026-06-14 Vite 浏览器烟测确认设置页外部依赖诊断区域在桌面和 390px 移动宽度渲染，无控制台 warn/error；2026-06-15 `npm run tauri:dev` 复验完成 worker build、Vite `http://localhost:1430/`、Rust dev profile 编译并运行到 `target/debug/job-sync`，中断后确认 1430 端口和 Tauri/Vite 进程无残留；2026-06-15 `npm run test:worker` 通过，覆盖本机 Node worker 启动、`STOP received`、`FINISHED` 和 0 退出码。 | 真实 Boss 登录后的 Cookie/LocalStorage 仍需用户登录后通过设置页诊断确认。 |
| Phase 1：统一职位来源模型 | Boss 入库归一化，保留来源平台、URL、抓取时间、去重 key、原始 payload；其他平台预留 adapter | 已闭环 | `src-tauri/src/db/schema.sql` 有 `job`、`job_sources`、`job_source_link`；`src-tauri/src/db/models/source_adapter.rs` 注册 Boss 与手动导入 adapter；`src-tauri/src/db/tests.rs` 覆盖 Boss payload 和外部平台手动导入映射；`src-tauri/src/commands/jobs/mutations.rs` 的 `import_external_job_on_conn_accepts_every_manual_source_adapter` 逐个验证猎聘、智联、脉脉、V2EX、LinuxDo 手动导入可写入统一字段、来源链接和默认筛选结果；`test/review-workflow-contract.test.js` 覆盖 unified source registry 和每个 manual adapter 的导入回归守卫。 | 非 Boss 自动采集仍是后续扩展能力；首期需求明确当前版本只实现 Boss 自动采集，其他平台保留 adapter/字段并支持手动单条导入。 |
| Phase 2：筛选画像与硬限制规则 | 必须满足、必须排除、偏好加权；覆盖工作方式、方向、技术、薪资、时间、城市、经验、学历、公司、关键词、来源平台、沟通状态 | 已闭环 | `src-tauri/src/commands/filter_profile.rs` 负责画像规则、默认画像和重算；`src/lib/filterProfile.ts` 提供多画像状态和来源策略；`src/pages/Jobs.vue` / `src/pages/Crawl.vue` 提供编辑入口；Rust 测试覆盖维度规则、Boss-only 来源、沟通状态、公司条件和默认重算；contract 测试覆盖多画像、公司规模/融资/行业、过滤解释和 sidecar 过滤上下文。 | 后续可继续增强更多 UI 级交互测试，但核心规则链已有代码和测试证据。 |
| Phase 3：简历匹配与综合排序 | 硬限制后计算 Resume、Preference、Company、Final；按权重展示 Top 20 | 已闭环 | `.trellis/tasks/06-13-scoring-candidate-ranking/prd.md` 子任务验收已覆盖；`src-tauri/src/commands/jobs/models.rs` 计算评分投影；`src-tauri/src/commands/jobs/queries.rs` 查询 Top 20 并按 `final_score` 排序；`src/components/jobs/JobsJobItem.vue` 展示评分和原因；Rust 测试覆盖权重、无 AI 报告、中性偏好、公司风险和排序；contract 测试覆盖 score reason 和 Resume Match 证据。 | 无已知功能缺口；后续主要是端到端真实数据验证。 |
| Phase 4：黑名单与沟通状态过滤 | 公司、职位、关键词黑名单；已拒绝、手动不合适、默认过滤已读未回；变更后重算 | 已闭环 | `src-tauri/src/commands/jobs/mutations.rs` 提供黑名单增删和状态更新；`src-tauri/src/commands/jobs/queries.rs` 排除黑名单和负向沟通状态；`src-tauri/src/commands/filter_profile.rs` 将命中写入 `blocked_by`；Rust 测试覆盖关键词黑名单、手动不合适、公司不合适、恢复候选和重算；contract 测试覆盖黑名单管理、过滤解释和推荐队列排除。 | 无已知功能缺口；仍需真实 UI 数据验证。 |
| Phase 5：沟通记录管理 | 记录/修改沟通状态、上次打招呼时间、备注、公司/职位黑名单、公司级复用 | 已闭环 | `job_review_state` / `company_review_state` 存储沟通和公司判断；`JobsJobItem.vue` 支持沟通状态、备注、公司判断和拉黑操作；`useJobsPage.ts` 复制沟通回溯摘要；Rust 测试覆盖 last greeted、notes、公司负面沟通历史；contract 测试覆盖沟通回溯台和同公司负面沟通展示。 | 无已知功能缺口；平台页面自动读取沟通状态仍属于后续能力，不是当前闭环必需。 |
| Phase 6：Company Score | 风险识别、结构化输出、同公司复用 | 已闭环 | `src-tauri/src/db/models/company_score.rs` 本地启发式评分和缓存；`src-tauri/src/commands/ai/company_score.rs` AI 批处理；`packages/boss-crawler-worker/src/modes/ai/companyScore.ts` / `normalizeCompanyScore.ts` 处理 worker 评分；Rust 测试覆盖低信息、外包、培训、电话销售、中介风险和缓存复用；worker 契约测试覆盖 AI 公司评分 schema。 | AI 质量依赖模型，当前测试覆盖结构化链路而非真实模型质量。 |
| Phase 7：Top 20 审核队列 | 展示 Top 20、硬限制结果、简历匹配、偏好、公司风险、沟通状态、上次打招呼时间；审核状态 | 已闭环 | `src/pages/Jobs.vue` 有 Top 20、收藏、准备投递、沟通回溯等队列；`JobsJobItem.vue` 展示筛选画像、评分、公司风险和沟通状态；`useJobsPage.ts` 复制 Top 20 摘要并保持人工确认边界；contract 测试覆盖 Top 20 UI、评分展示、状态操作、恢复候选和无自动投递；`scripts/seed-desktop-smoke-data.mjs` 可生成隔离 SQLite fixture；2026-06-14 release `.app --data-dir /tmp/job-sync-desktop-smoke` 桌面烟测显示 Top 20 中 `Go SRE 平台工程师`、投递准备台中 `AI Infra 工程师`、每日岗位情报统计、沟通回溯和报告选择器。 | 后续主要是用真实 Boss 数据做人工验收，不影响 fixture 闭环。 |
| Phase 8：定制化打招呼 | 人工确认后生成短、具体、可编辑文案；引用 JD 和候选人技术交集；不自动发送 | 已闭环 | `src-tauri/src/commands/ai/greeting.rs` 限制只能在 `ready_to_apply` / `applied` 后生成，并要求候选人上下文；`packages/boss-crawler-worker/src/modes/ai/greeting.ts` 生成草稿；`src/components/jobs/JobsJobItem.vue` 提供可编辑 textarea；`useJobsPage.ts` 复制草稿只记录已打招呼未读；worker 契约测试覆盖 prompt 和 schema；contract 测试覆盖可编辑草稿、失败重试和禁止发送动作。 | 真实模型输出质量仍需人工样例回归，不影响当前功能边界。 |
| Phase 9：每日岗位情报 | 本地统计新增、高匹配、满足关键限制、推荐投递；至少一种通知渠道；不自动投递 | 已闭环 | `src-tauri/src/commands/jobs/queries.rs` 生成每日情报和推荐候选；`src/pages/Jobs.vue` 展示统计和候选预览；`useJobsPage.ts` 支持复制摘要、本机通知、邮件草稿和企业微信手动通知；`src-tauri/src/commands/jobs.rs` 发送企业微信 webhook；`src-tauri/src/commands/settings.rs` 诊断已保存企业微信 Webhook 是否存在和格式是否符合企业微信机器人地址，且不自动发送；设置页诊断摘要复制会记录企业微信状态但不回显 webhook；Rust 测试覆盖统计、通知文案和 Webhook 诊断不泄露 secret；contract 测试覆盖通知作为入口、外部依赖诊断手动触发、复制摘要脱敏且不自动投递。 | 企业微信外网发送仍需要用户本地配置 webhook 后手动实测；设置页已提供格式/保存状态诊断和脱敏摘要复制入口。 |
| Phase 10：模型供应商与本地化 | Ollama、DeepSeek、OpenAI Compatible；配置 temperature/prompt/schema；错误状态和重试；API Key 不明文 | 已闭环 | `src-tauri/src/commands/ai/config.rs` 解析供应商和有效配置；`src-tauri/src/settings.rs` 持久化设置；`src/pages/Settings.vue` 提供 OpenAI Compatible、DeepSeek、Ollama、Temperature、Prompt Extra、Schema Extra、外部依赖诊断和脱敏摘要复制；`src-tauri/src/commands/settings.rs` 对 API Key/Webhook 脱敏，并通过 `diagnose_external_dependencies` 复用模型列表请求验证 effective Base URL、API Key/环境变量或本地 Ollama dummy key；诊断复制摘要记录供应商、模型数量和样例但不读取原始 Key、Webhook 或 Base URL 表单值；`useJobsPage.ts`、`useResumeWorkspacePage.ts`、`src/pages/Ai.vue` 提供结构化输出失败提示和重试入口；Rust/contract/worker 测试覆盖供应商、脱敏、环境变量、schema extra 和诊断入口。 | 真实 Ollama/DeepSeek/OpenAI Compatible 服务连通性需要用户本地凭据和服务环境实测；设置页已提供可记录的手动诊断和脱敏摘要复制入口。 |

## 总体验收覆盖

| 编号 | 总体验收项 | 当前结论 |
| --- | --- | --- |
| 1 | 多来源岗位可以存入统一 SQLite-backed 模型 | 已闭环：Boss 自动采集写入统一模型；猎聘、智联、脉脉、V2EX、LinuxDo 可通过手动单条 JSON 导入写入同一 SQLite-backed `job` / `job_source_link` 模型并生成默认筛选结果。非 Boss 自动采集未实现，但属于需求声明的后续扩展能力。 |
| 2 | Mac 用户可以通过 Tauri 桌面端完成核心流程 | 部分闭环：Mac release `.app` 和 `.dmg` 已构建，并通过 `.app` 签名、包内 worker runtime 和 `hdiutil verify` 校验；fixture 数据下的职位库、Top 20、每日情报、投递准备和简历工作区已在 Tauri 桌面端渲染；采集页已在 fixture 桌面端触发 worker 并渲染运行日志；设置页已有 Boss 登录态、模型服务和企业微信配置诊断入口，并可复制脱敏诊断摘要；真实 Boss 登录仍需用户本机外部状态验收。 |
| 3 | `npm run tauri:dev` 可启动 Vue、Rust Tauri Shell 和 Node sidecar | 已闭环：2026-06-15 当前工作树复验 `npm run tauri:dev` 已完成 worker build、Vite `http://localhost:1430/`、Rust dev profile 编译并运行到 `target/debug/job-sync`；中断后确认无 1430 端口或 Tauri/Vite 进程残留；同轮 `npm run test:worker` 通过，验证本机 Node worker 生命周期。 |
| 4 | 当前版本只实现 Boss 来源，但统一模型和 adapter 边界支持扩展 | 已闭环。 |
| 5 | 支持可配置筛选画像 | 已闭环。 |
| 6 | 筛选维度覆盖薪资、远程、时间、方向、技术、不想做技术、城市、经验、学历、公司、关键词、来源、沟通状态 | 已闭环。 |
| 7 | 不满足硬限制或排除规则不进入推荐排序 | 已闭环。 |
| 8 | 排序岗位有四类分数 | 已闭环。 |
| 9 | Final Score 偏向简历匹配且权重可调 | 已闭环。 |
| 10 | 黑名单和自定义排除规则不进入推荐结果 | 已闭环。 |
| 11 | 已拒绝、手动不合适、默认过滤已读未回不进入推荐结果 | 已闭环。 |
| 12 | 已打招呼未读可重新进入并显示未读和上次时间 | 已闭环。 |
| 13 | 用户可手动标记公司或岗位不合适并影响下次筛选 | 已闭环。 |
| 14 | 展示 Top 20 人工审核队列 | 已闭环。 |
| 15 | AI 生成定制打招呼但不能自动投递 | 已闭环。 |
| 16 | 从本地数据生成每日岗位情报 | 已闭环。 |
| 17 | Ollama、DeepSeek、OpenAI Compatible 是一等模型选项 | 已闭环。 |
| 18 | 保留简历优化和 PDF 导出，并和筛选岗位联动 | 已闭环：简历工作区联动、最终稿和 PDF 状态已接入投递材料包；fixture 桌面烟测中 `AI Infra 投递烟测简历` 绑定 `smoke-ai-infra-ready`，4/4 模块确认、最终稿和 PDF 路径均存在并在 Tauri UI 显示。 |
| 19 | 产品文案围绕精准求职和岗位研究，避免自动投递机器人 | 已闭环。 |

## 下一步优先级

1. **外部依赖实测**：按 `docs/job-sync-final-acceptance-audit.md` 的用户本机外部依赖验收清单执行；在用户本地凭据可用时，通过设置页外部依赖诊断验证 Boss 登录 Cookie/LocalStorage 复用、企业微信 webhook 保存状态、Ollama/DeepSeek/OpenAI Compatible 实际连通性，并复制脱敏诊断摘要留证；真实企业微信发送仍需用户手动触发。
