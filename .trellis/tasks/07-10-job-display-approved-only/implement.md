# 实施计划

1. 读取前端、Rust/SQLite 相关 Trellis 规范，确认 schema 幂等迁移与 Vue 状态风格。
2. 为 `collection_run` 增加可空 `batch_id`，扩展创建、查询模型和 Tauri payload/command。
3. 增加按批次刷新新增岗位最终分桶的后端入口，并补 Rust 数据层测试。
4. 自动采集开始时生成批次 id，传给各平台 run；AI 判断完成后刷新批次统计并重新加载 collection summary。
5. 将顶部卡片改为聚合最新批次，修正为“总搜到 / 未新增 / 新入库 / 通过”的一致口径，并补多平台聚合测试。
6. 运行受影响单测、类型检查/构建和最小页面烟测。
7. 使用 `trellis-check` 和 `code-review-and-quality` 做修改后审查；若涉及 SQL 审查，再追加 `sql-code-review`，修复当前范围内明确问题后复验。

## 重点验证命令

- `cargo test --manifest-path src-tauri/Cargo.toml`（相关测试可先定向运行，最终按风险扩大）
- `npm run test:review-workflow`
- `npm run build`
- 项目现有 worker 测试中与 collection run 生命周期相关的子集

## 风险点

- schema 迁移必须兼容已有用户数据库。
- 多平台 run 的批次聚合不能误合并历史任务或定时任务。
- “通过”只能统计本批次新增岗位，不能使用全库推荐总数。
