# Tauri fixture 桌面核心流程烟测

## Goal

用隔离 SQLite fixture 验证 Mac Tauri 桌面端能展示 Job-Sync 二开核心工作台，而不是只依赖浏览器模式或单元测试证据。

## Requirements

- 使用 `scripts/seed-desktop-smoke-data.mjs` 生成独立数据目录，不污染真实应用数据。
- 使用当前 release `.app` 或重新执行 app-only 构建，验证桌面端可以读取 fixture 数据。
- 至少检查 Jobs 页面中的 Top 20 候选、准备投递、每日岗位情报、打招呼/投递准备和筛选/评分证据入口。
- 如果发现桌面端 UI 或 fixture 数据无法支撑验证，优先做最小修复并补验证证据。
- 不触发真实 Boss 登录、外部 webhook、真实模型调用或任何自动投递/发送动作。

## Acceptance Criteria

- [x] app-only release 构建或可用 `.app` 校验通过。
- [x] fixture 数据目录生成成功，包含候选岗位、过滤岗位、AI 报告、Company Score 和简历工作区数据。
- [x] Tauri 桌面端以 fixture 数据目录启动后，Jobs 页面能看到 Top 20 候选、每日岗位情报和准备投递队列相关内容。
- [x] 烟测结果同步更新到 `docs/job-sync-requirements-coverage.md` 和 Phase 0 基线文档。

## Notes

- 这是验证型 lightweight task，PRD-only 即可。
