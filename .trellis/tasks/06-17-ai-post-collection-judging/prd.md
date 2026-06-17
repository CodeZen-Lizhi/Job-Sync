# AI 采后判断

## Goal

让职位库的采后判断更接近人工判断，减少纯关键词规则带来的误判和重复信息展示。

## Requirements

- 保留确定性硬规则：黑名单、沟通状态、公司不合适、已投递/已忽略等必须继续稳定生效。
- 对岗位内容、JD、帖子正文、公司信息引入 AI 采后判断。
- AI 输出必须能落到现有 bucket：`recommended` / `pending_confirmation` / `filtered`。
- AI 判断结果需要可解释，至少包含原因摘要和可追溯证据。
- 现有职位库页面要能读到新的 AI 判断结果，不再依赖一堆原始机器标签阅读。
- 采用混合模式：确定性硬规则优先，AI 接管岗位内容相关软判断。

## Acceptance Criteria

- [ ] 职位库中的采后结果能区分硬规则命中与 AI 判断结果。
- [ ] AI 判断能把不确定岗位放入 `pending_confirmation`，而不是直接误杀。
- [ ] 职位详情页的展示不再出现重复的原始偏好机器标签堆叠。
- [ ] 用户可以触发 AI 采后重算，并看到更新后的推荐/待确认/过滤计数。
- [ ] 现有构建和相关测试通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## Open Questions

- 已决策：使用混合模式。硬规则保留，AI 负责软判断。
