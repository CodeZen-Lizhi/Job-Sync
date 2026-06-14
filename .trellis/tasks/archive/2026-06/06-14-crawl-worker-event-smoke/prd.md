# 采集页 worker 事件闭环

## Goal

补齐 `docs/job-sync-requirements-coverage.md` 中 Phase 0 的采集页 worker 事件实测缺口：在本地安全条件下证明 Tauri 采集页可以通过 UI 启动 sidecar / worker 流程，并把 worker 事件渲染到运行日志，为 Boss-only 采集到筛选队列的核心链路补强桌面端证据。

## Requirements

- 验证入口必须从采集页 UI 或等价的 Tauri IPC 运行时路径触发，不能只证明底层函数单测通过。
- 烟测不得执行真实投递、真实开聊或对 Boss 账号产生不可逆操作。
- 若真实 Boss 登录态或网络环境不可用，优先使用项目已有的本地安全 worker 模式、fixture 或生命周期事件证明 sidecar 启动和事件渲染。
- 运行结果要能沉淀到覆盖审计文档，说明验证命令、数据目录和观察到的 UI/事件证据。

## Acceptance Criteria

- [x] 采集页可在 Tauri 桌面运行时触发 worker/sidecar 启动，并在 UI 运行日志看到至少一条来自 worker 的事件或生命周期消息。2026-06-14 使用 `/tmp/job-sync-crawl-worker-smoke` fixture 启动 release `.app`，点击 `同步城市、行业与筛选项` 后看到 `boss-crawler-worker started`、同步日志、完成日志和 `任务已结束。`
- [x] 若需要新增烟测或辅助脚本，必须保持本地隔离，不依赖用户真实 Boss 凭据，不写入生产数据目录。本轮复用 `scripts/seed-desktop-smoke-data.mjs` 生成隔离数据目录，未新增脚本，未使用真实 Boss 登录态。
- [x] `docs/job-sync-requirements-coverage.md` 更新 Phase 0 和总体验收对应证据，仍保留未实测外部依赖的待补说明。
- [x] 运行并记录相关验证命令；若某个外部依赖无法验证，明确标注为未覆盖而不是标为完成。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
