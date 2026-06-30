# 分析打招呼生成逻辑

## Goal

确认 Job Sync 中“打招呼”功能的真实生成链路、实际输入字段、补充提示的注入位置，以及各类上下文对文案生成质量与语气控制的作用；进一步检查当前实现是否存在逻辑矛盾、低价值上下文注入或可收敛的优化点。

## Requirements

- 基于仓库代码说明前端、Tauri 命令层、worker prompt、schema 校验之间的真实调用链。
- 确认设置页“打招呼文案补充提示”是否实际进入模型输入，以及进入的位置和约束。
- 解释 `job_detail`、`match_report`、`filter_reason`、`score_reason`、`source_context`、`review_context` 对打招呼生成的具体作用和相对重要性。
- 评估打招呼链路中是否存在前后约束不一致、无效分支、提示词噪音、内部信息泄露风险或可精简点。
- 输出结论必须引用仓库证据，不使用猜测性描述。

## Acceptance Criteria

- [ ] 能指出打招呼生成从前端触发到 worker 输出的实际入口文件与关键约束。
- [ ] 能说明设置页补充提示已被保存并注入打招呼 prompt。
- [ ] 能按字段逐项解释对文案内容、语气、证据引用和安全边界的影响。
- [ ] 能指出至少一个经代码证据支持的优化点，并区分功能缺陷与质量优化。
- [ ] 回答中不再使用“可能”“大概率”描述真实实现。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
