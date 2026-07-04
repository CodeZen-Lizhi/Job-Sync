# 全项目优化检查执行计划

## Checklist

- [x] 读取 Trellis active contracts 和项目入口文档。
- [x] 盘点目录、脚本、测试、构建配置和高复杂度文件。
- [x] 审计前端热点：Jobs/Crawl/Settings/Resume 页面、组合逻辑、IPC 类型。
- [x] 审计 Rust/Tauri 热点：commands、DB projections、sidecar、settings diagnostics。
- [x] 审计 worker 热点：protocol schema、多来源 feed、auto run、stdio lifecycle。
- [x] 审计测试与发布脚本：contract tests、canary、runtime verification、bundle build scripts。
- [x] 运行本机合理的只读/基础验证命令。
- [x] 写入 `audit-report.md`，按优先级给出优化建议和后续拆分。

## Validation Commands

- `npm run build`
- `npm run test`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`

若命令耗时、依赖外部登录态或平台产物不可用，报告中记录跳过/失败原因和替代证据。

## Rollback

本任务只新增/修改 Trellis 任务文档和报告，不修改业务代码。如需回滚，仅删除或修订 `.trellis/tasks/07-05-project-optimization-audit/` 下的审计文档。
