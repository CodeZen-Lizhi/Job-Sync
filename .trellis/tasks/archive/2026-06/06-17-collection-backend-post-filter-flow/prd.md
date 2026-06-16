# 收口采集入库与采后筛选后台流程

## Goal

把后台流程收口到和已完成 UI 一致的产品事实：自动采集获得的岗位事实应优先进入统一职位库，默认采后判断规则再基于标题、列表字段、JD、帖子正文、原始 payload、黑名单和人工状态派生推荐、待确认、已过滤等行动视图。

本任务聚焦后台逻辑，不重新设计 UI。目标是让“岗位为什么最后留在职位库 / 推荐查看 / 已过滤”由一个 canonical 后台规则结果解释，而不是由 worker 采集阶段、页面查询、AI 下游各自形成第二套事实。

## Confirmed Facts

- 当前 UI 已按前序任务改为“采集意图 -> 平台适配器 -> 采后判断规则 -> 职位库分桶工作台”。
- Rust sidecar 收到 `JOB_DETAIL_CAPTURED`、`JOB_NORMALIZED_CAPTURED`、`JOB_LIST_CAPTURED` 后会 upsert `job` 并调用默认 Filter profile 重算。
- `job_filter_result` 已保存 `eligible` 和 `reason_json`，`list_job_candidates` 会补算缺失或过期的默认规则结果。
- `list_filtered_jobs` 已能从职位库中查询已过滤岗位。
- Boss worker 仍存在采集阶段 profile filter：不 eligible 的列表项会发 `JOB_FILTERED`，eligible 的继续抓详情；这会让被过滤岗位通常没有详情/JD。
- Rust Filter profile 的搜索文本目前会合并传入的 `job` JSON 和 Boss detail raw，但默认重算查询未显式包含 `job.jd_text` 与 `job.raw_payload_json`，这会影响 V2EX/normalized job 的正文规则判断。
- 后台目前没有独立的 `pending_confirmation` / `待确认` bucket。
- 后台目前没有稳定的 collection batch summary 模型来汇总 captured/inserted/updated/duplicate/recommended/pending/filtered。

## Requirements

1. 采集写入事实优先：
   - Boss 列表项、Boss 详情、V2EX normalized job 都必须进入统一 `job` 模型或明确记录无法入库的错误。
   - Filter profile 的 `sourcePlatforms` 只能影响候选派生结果，不应作为采集入库门禁。

2. Canonical 采后判断：
   - Rust Filter profile evaluator 是默认采后判断的唯一事实源。
   - 采后判断必须使用统一职位字段、`job.jd_text`、`job.raw_payload_json`、Boss detail raw、黑名单、沟通状态、人工审核状态和公司审核状态。
   - Worker 采集阶段过滤最多作为采集优化或证据标记，不能让岗位事实在职位库中不可见。

3. 正文/JD 规则可验证：
   - `mustKeywords`、`mustNotKeywords`、`requiredDirections`、`excludedDirections`、`requiredTechTags`、`excludedTechTags` 等规则必须能命中 JD 或帖子正文。
   - V2EX normalized job 的 `jd_text` 必须参与默认采后判断。
   - Boss list item 如果没有详情，也应至少基于列表 payload 得到可复算结果；如果证据不足，应支持进入待确认或带有弱证据说明。

4. 后台分桶：
   - 推荐查看：默认规则判定可行动且未处理。
   - 已过滤：默认规则判定不符合，原因可追溯。
   - 待确认：证据不足、缺少 JD/detail、来源字段不足或规则无法做强判断时，不应伪装成推荐或直接丢弃。
   - 全部入库：包含推荐、待确认、已过滤、已处理等所有已保存岗位。

5. 查询和解释：
   - 职位库查询应基于 canonical 规则结果，不在页面查询里重写另一套业务过滤。
   - 已过滤/待确认结果应返回可展示的 `reason_json`，包含规则类型、字段、命中值、原因和证据来源。
   - AI/简历下游继续消费同一份 `filter_reason`，不新增独立判断。

6. 兼容和迁移：
   - 不破坏现有 `job`、`job_filter_result`、`job_review_state` 数据。
   - 新增字段或 reason JSON shape 时保持向后兼容，旧结果可通过重算刷新。
   - 如果引入新 bucket 字段，应能从旧 `eligible` 结果安全推导。

## Acceptance Criteria

- [ ] Rust 默认 Filter profile 重算使用 `job.jd_text` 与 `job.raw_payload_json`，并有测试覆盖 V2EX JD/帖子正文命中 must/must-not 规则。
- [ ] Boss worker 的采集阶段 filter 不再成为职位入库事实源；被 worker 判定不 eligible 的列表项仍写入 `job` 并由 Rust canonical evaluator 重算。
- [ ] `sourcePlatforms` 仅阻止进入候选/推荐结果，不阻止 `job` upsert；有跨层测试或 Rust 测试覆盖。
- [ ] 后台能表达待确认 bucket，至少覆盖缺少详情/JD或证据不足的岗位，并提供查询入口或在现有候选查询中可过滤。
- [ ] 已过滤岗位继续可通过 `list_filtered_jobs` 或等价查询返回，并包含可解释 `reason_json`。
- [ ] `list_job_candidates`、已过滤查询和新增待确认查询不重复实现业务判断，只消费 canonical filter result。
- [ ] 现有前端合约测试、worker 测试和 Rust 相关测试通过。
- [ ] 没有新增自动投递、自动开聊或外部发送动作。

## Out of Scope

- 不重做已完成的 shadcn 风格 UI。
- 不引入 LLM 作为默认筛选器；本任务优先用确定性规则和结构化 reason。
- 不做自动投递、自动开聊、自动发送简历。
- 不把 AI 职位分析、简历优化、报告结果并入采集早期流程。
- 完整 collection batch summary 暂不纳入本轮。用户已确认本轮先收口 canonical 入库、采后判断和待确认 bucket，批次统计后续单独做。

## Notes

- 推荐切分为一个后台 MVP：先修 canonical evidence + worker 不丢事实 + 待确认 bucket，再考虑完整 collection batch summary。
- 如果实现过程中发现 `eligible` 布尔值无法自然表达待确认，优先扩展 reason JSON 或新增兼容字段，而不是破坏旧查询。
- 范围决定：本轮不做完整 batch summary；允许为了测试或 reason 解释保留最小计数/日志，但不新增完整批次模型。
