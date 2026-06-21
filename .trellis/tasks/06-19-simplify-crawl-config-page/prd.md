# 简化采集配置页

## Goal

让“采集配置”页更简洁、克制，减少视觉噪音和重复提示，同时保留采集配置保存、平台同步、采集运行和职位入库能力。

## Requirements

- 保留当前需要维护的配置项：采集意图、平台来源、Boss 配置、V2EX 配置、采后 AI 判断偏好。
- 减少页面上的说明文案密度，把长提示改成更短的辅助文案。
- 降低视觉花哨感，优先使用更平实的布局和更少的强调块。
- 不改动配置保存、平台同步、多来源采集启动和职位入库行为。
- `filter_profile.rs` 中旧的本地硬规则判断删除是本任务的有意简化范围，不得因为旧测试失败擅自恢复。
- V2EX 自动采集不应被通用 50 条上限截断，实际处理条数应按 feed 条数和 V2EX 相关上限决定。
- 不引入新的操作路径或新的复杂交互。

## Acceptance Criteria

- [ ] 配置页保留采集意图、平台来源、Boss 配置、V2EX 配置、采后 AI 判断偏好和保存操作。
- [ ] 页面首屏不再堆叠多层“说明卡”和重复的高亮提示。
- [ ] 关键文案更短、更直接，不再使用过多解释性段落。
- [ ] 页面视觉层级更平，整体更像工具页而不是说明页。
- [ ] 旧的本地硬规则过滤不被恢复，相关测试需要按新的采后判断边界更新。
- [ ] V2EX 采集不再固定停在 50 条。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
