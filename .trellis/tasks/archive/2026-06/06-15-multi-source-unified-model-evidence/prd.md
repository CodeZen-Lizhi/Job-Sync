# 多来源统一模型验证

## Goal

补强 `docs/job-sync-requirements-coverage.md` 中 Phase 1 和总体验收第 1 项的证据：证明 Boss 之外的首期手动导入来源（猎聘、智联、脉脉、V2EX、LinuxDo）都能进入统一 SQLite-backed 职位模型，并接入默认筛选结果。

## Requirements

- 只验证需求文档明确允许的首期范围：Boss 自动采集保持主路径，非 Boss 平台只做 adapter 和手动单条 JSON 导入。
- 增加本地回归测试，逐个覆盖已注册 `manual_import` adapter，而不是只测一个泛化平台。
- 测试需证明导入结果写入统一字段：`source_platform`、`source_url`、`dedup_key`、职位/公司/JD 等核心字段。
- 测试需证明导入后会生成默认筛选结果，使非 Boss 手动导入岗位可以参与本地筛选/排序链路。
- 更新覆盖审计，准确表达“多来源存入统一模型”已闭环；同时保留“非 Boss 自动采集未实现”作为范围边界，不把它包装成已实现。

## Acceptance Criteria

- [x] Rust 测试覆盖每个已注册非 Boss `manual_import` 平台都能通过 `import_external_job_on_conn` 写入统一职位模型。
- [x] 测试断言导入岗位包含来源平台、来源 URL、去重 key、职位标题、公司、JD 和默认筛选结果。
- [x] 覆盖审计中 Phase 1 / 总体验收第 1 项不再因为“非 Boss 不是自动采集”而否定“多来源存入统一模型”。
- [x] 文档仍明确首期不实现非 Boss 自动爬虫，后续自动采集属于扩展能力。
- [x] 不新增自动投递、自动开聊、自动群发或绕过平台风控行为。

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml commands::jobs::mutations::tests::import_external_job_on_conn_accepts_every_manual_source_adapter` passed.
- `cargo test --manifest-path src-tauri/Cargo.toml` passed.
- `npm run test:review-workflow` passed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
