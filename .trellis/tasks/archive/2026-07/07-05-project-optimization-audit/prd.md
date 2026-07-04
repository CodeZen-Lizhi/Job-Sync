# 全项目优化检查

## Goal

对 Job-Sync 仓库做一次证据驱动的全项目优化审计，找出最值得优先处理的结构、性能、稳定性、安全、类型契约、测试与发布流程问题，并输出可执行的优化清单。默认本任务先产出审计结论和后续拆分建议，不在同一轮里做大范围重构。

## Confirmed Facts

- 项目是 Tauri + Vue + Rust + Node sidecar/Puppeteer 的桌面采集器。
- 前端代码位于 `src/`，Tauri/Rust 位于 `src-tauri/`，worker 位于 `packages/boss-crawler-worker/`。
- 根脚本包含 `npm run build`、`npm run test`、`npm run tauri:build`、worker runtime staging/verification、Boss/Zhilian canary 和 crawl route performance measurement。
- 当前 Trellis 状态是 `no_task`，另有活跃任务 `07-04-boss-low-risk-mode/`；创建本任务前 git 工作区干净。
- Trellis active 规范主要覆盖 collection source contracts、Jobs/Resume performance boundary contracts、Settings external dependency diagnostics。
- 初步行数扫描显示若干高复杂度/高影响文件：`src-tauri/src/commands/jobs/queries.rs`、`src-tauri/src/commands/filter_profile.rs`、`src-tauri/src/sidecar/mod.rs`、`src/lib/useJobsPage.ts`、`src/lib/useCrawlPage.ts`、多来源 worker feed 文件。
- 初步关键词扫描显示跨层协议和前端解析路径存在大量 `any`/弱类型边界，需结合契约判断哪些是合理兼容层、哪些是可优化风险。

## Requirements

- 审计必须覆盖项目的主要运行边界：
  - Vue 前端页面、组合逻辑、IPC 调用和类型契约。
  - Rust/Tauri 命令、SQLite 模型/迁移、sidecar 事件处理。
  - Node worker 的多来源采集、协议 schema、构建和测试。
  - 发布/打包/runtime staging 脚本与现有验证命令。
- 每个优化建议必须有仓库证据支撑，例如文件、行数、测试、规范、命令输出或具体代码片段；不得凭经验泛泛建议。
- 输出需要按优先级区分：
  - P0/P1：明显影响正确性、数据一致性、安全、发布或主要性能边界的问题。
  - P2：维护性、类型安全、测试覆盖、可观测性和局部复杂度改进。
  - P3：清理、文档、开发体验类改进。
- 对每个建议说明：
  - 问题或机会点。
  - 影响范围。
  - 推荐修复方向。
  - 验证方式。
  - 是否适合在本任务内直接修、或应该拆成后续 Trellis 子任务。
- 审计必须特别检查 Trellis active contracts 是否仍被代码守住，尤其是 collection source、Jobs/Resume performance boundary、external dependency diagnostics。
- 不把 Boss 低风控相关进行中的实现任务混入本任务直接修改；如发现相关问题，只记录并建议交给对应任务或新子任务。

## Non-Goals

- 不在本任务里一次性重构全项目。
- 首个交付物不顺手修复代码问题，只输出只读审计报告与后续拆分建议。
- 不做数据库 schema 迁移，除非后续单独子任务明确要求并完成设计。
- 不改变采集平台行为、登录策略、AI 判断策略或发布流程，除非用户明确批准进入实现阶段。
- 不删除或回滚用户/其他任务已有改动。

## Acceptance Criteria

- [ ] 形成一份全项目优化审计报告，覆盖前端、Rust/Tauri、worker、DB/数据流、测试/构建/发布脚本。
- [ ] 报告中的每条主要建议都有证据引用和优先级。
- [ ] 至少运行能在本机合理完成的基础验证命令，并记录通过/失败/跳过原因。
- [ ] 对发现的高优先级问题给出后续任务拆分建议或明确的低风险直接修复建议。
- [ ] 若进入实现阶段，必须先补充 `design.md` 与 `implement.md`，并经用户确认后 `task.py start`。

## Open Questions

- 已决策：首个交付物只做只读审计报告，不顺手修复代码。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
