# 全项目优化检查设计

## Scope

本任务只做只读审计报告，不修改业务代码。审计覆盖：

- Vue 前端页面、组合逻辑、IPC 调用、类型边界。
- Rust/Tauri 命令、SQLite 模型/迁移、sidecar 事件处理。
- Node worker 多来源采集、协议 schema、构建和测试。
- 发布、打包、runtime staging、canary 与性能测量脚本。

## Audit Axes

1. Trellis contract compliance
   - 对照 collection source contracts、performance boundary contracts、external dependency diagnostics 检查代码和测试是否守住关键约束。
2. Hot path and payload performance
   - 关注 Jobs/Resume list/detail 分界、SQLite 查询、projection 使用、大 JSON 搬运、前端列表状态。
3. Type and cross-layer safety
   - 检查 `any`、raw payload cast、IPC/worker schema、Rust serde 结构与前端类型之间是否存在第二事实源或弱校验。
4. Maintainability and verification
   - 识别超大文件、重复逻辑、测试脆弱性、发布脚本可靠性和缺失验证环节。

## Output Contract

输出一份 `audit-report.md`，包含：

- Executive summary.
- 优先级排序的优化清单。
- 每条建议的证据、影响范围、推荐处理方式、验证方式、是否建议拆任务。
- 已运行验证命令和结果。
- 不确定项与后续建议。

## Boundaries

- 不启动 destructive git 命令。
- 不改业务代码、不跑会修改数据库或真实应用数据的命令。
- 不把当前 `07-04-boss-low-risk-mode` 任务内容纳入直接修复；如发现相关风险，只记录依赖关系。
