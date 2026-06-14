# 评分投影与候选排序基础闭环

## Goal

把 Top 20 人工审核队列从“按时间的新职位列表”推进为“按可解释分数排序的候选队列”：基于已有 AI 报告 `match_score`、筛选画像偏好命中和公司风险关键词，计算并展示 `resume_match_score`、`preference_score`、`company_score` 和 `final_score`。

## Confirmed Facts

- 主需求在 `docs/job-sync-remote-tech-jobs-requirements.md`，Phase 3 要求硬限制之后再计算排序分。
- 默认公式为 `0.6 * resume_match_score + 0.25 * preference_score + 0.15 * company_score`，并允许默认筛选画像覆盖权重。
- 当前 `ai_report.match_score` 已存在，可作为已有 Resume Match Score 来源。
- 当前 `job_filter_result.reason_json` 已记录 `matched_preferences` 和 `missing_preferences`。
- 当前还没有 Company Score 表或 AI 公司评分任务。
- 当前 Top 20 候选队列已排除画像过滤失败、黑名单、拒绝、手动不合适和忽略状态。

## Requirements

- `JobRow` 返回：
  - `resume_match_score`
  - `preference_score`
  - `company_score`
  - `final_score`
  - `score_reason_json`
- `resume_match_score` 优先读取同职位最新 resume 类型 AI 报告的 `match_score`；不存在时为 `null`，参与 `final_score` 时按 `0` 处理。
- `preference_score` 根据 `job_filter_result.reason_json` 中的偏好命中/缺失计算，命中越多分越高；没有偏好时给中性分。
- `company_score` 先用本地启发式实现：
  - 基础分 80。
  - 职位字段或详情中出现外包、驻场、培训、电话销售等风险词时扣分。
  - 生成风险标签和 evidence，写入 `score_reason_json`。
- `final_score` 使用需求文档默认权重计算；当默认筛选画像配置了 `scoreWeights` 时，使用画像权重并在原因 JSON 中输出实际归一化权重。
- Top 20 候选查询在完成硬限制/黑名单/沟通状态过滤后，按 `final_score DESC` 排序。
- 职位库页面展示四个分数和评分原因摘要。
- 职位库和自动采集页都可以编辑默认筛选画像的关键词和排序权重，并触发已有职位重算。
- 默认筛选画像开始覆盖非关键词硬限制：工作方式、城市、来源平台、沟通状态、薪资、最近采集天数、岗位方向、技术标签、经验、学历和公司条件。

## Acceptance Criteria

- [x] `JobRow` 返回四类评分字段和 `score_reason_json`。
- [x] Top 20 候选队列按 `final_score` 降序排序，再按 `last_seen_at` 降序兜底。
- [x] 没有 AI 报告的岗位仍能进入候选队列，但 `resume_match_score` 显示为空或待分析。
- [x] 偏好命中/缺失能影响 `preference_score`。
- [x] 外包、驻场、培训、电话销售等风险词能降低 `company_score`，并在原因 JSON 中可追踪。
- [x] 职位项能展示 Resume、Preference、Company、Final 四类评分。
- [x] 默认筛选画像可以配置 Resume、Preference、Company 权重，Top 20 按当前权重重新计算排序。
- [x] 默认筛选画像可以配置工作方式、城市、来源平台、沟通状态、薪资和最近采集天数，并在 `blocked_by` 中记录命中的规则和值。
- [x] 默认筛选画像可以配置岗位方向、技术标签、经验、学历和公司条件，并让硬限制进入 `blocked_by`、偏好条件进入 `matched_preferences` / `missing_preferences`。
- [x] `npm run build` 和 `npm run build:worker` 通过。

## Out of Scope

- 新增 AI Company Score 生成任务。
- 自动为所有岗位生成 Resume Match Score。
- 多画像策略切换。
- 自动投递或自动发送消息。
