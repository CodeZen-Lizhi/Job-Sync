# 审核队列与黑名单基础闭环

## Goal

在已实现的 Boss-only 筛选画像结果之上，补齐本地人工审核闭环：职位库可以展示 Top 20 候选岗位，用户可以维护审核状态、沟通状态、上次打招呼时间和备注，并能把公司或职位加入黑名单；候选队列默认排除黑名单、已拒绝和手动不合适的岗位。

## Confirmed Facts

- 主需求在 `docs/job-sync-remote-tech-jobs-requirements.md`。
- 当前已实现 `job_filter_result`，职位库可以看到筛选画像是否挡掉岗位。
- 职位库现有页面只有搜索、按关键词分组、展开详情、删除和跳转 AI。
- 现有 SQLite 还没有审核状态、沟通记录、公司黑名单或职位黑名单表。
- 当前版本仍坚持 human-in-the-loop，不能增加自动投递入口。

## Requirements

- SQLite 新增本地审核/沟通表，记录每个岗位的：
  - 审核状态：`pending`、`favorited`、`ready_to_apply`、`applied`、`ignored`。
  - 沟通状态：`not_contacted`、`greeted_unread`、`read_no_reply`、`replied`、`rejected`、`manual_not_fit`。
  - 上次打招呼时间、备注、更新时间。
- SQLite 新增黑名单表，至少支持：
  - 公司黑名单。
  - 职位黑名单。
- 职位库 `JobRow` 返回审核状态、沟通状态、上次打招呼时间、备注、黑名单命中信息。
- 新增 Top 20 候选查询：默认只返回未被筛选画像挡掉、未命中黑名单、未拒绝、未手动不合适、未忽略的岗位。
- 职位库页面展示 Top 20 候选区，显示审核状态、沟通状态、黑名单命中和上次打招呼时间。
- 用户能在职位项里执行：
  - 收藏。
  - 准备投递。
  - 标记已投递。
  - 忽略。
  - 修改沟通状态。
  - 更新上次打招呼时间。
  - 加入公司黑名单。
  - 加入职位黑名单。
- 标记为 `ignored`、`rejected`、`manual_not_fit` 或加入黑名单后，岗位应从 Top 20 候选队列中消失，但仍可在普通职位库中搜索或按来源查看。

## Acceptance Criteria

- [x] `job_review_state` 和 `job_blacklist` 表能通过 `schema.sql` 创建。
- [x] `list_review_candidates` 默认返回最多 20 个可审核岗位，并排除过滤失败、黑名单、拒绝、手动不合适和忽略状态。
- [x] `JobRow` 返回审核/沟通/黑名单相关字段。
- [x] `set_job_review_state` 可以更新审核状态、沟通状态、上次打招呼时间和备注。
- [x] `add_company_blacklist` 与 `add_job_blacklist` 可以写入黑名单。
- [x] 删除职位或清空职位时同步清理职位级审核记录和职位级黑名单。
- [x] 职位库页面有 Top 20 候选区，并能在操作后刷新候选结果。
- [x] 职位项展示审核状态、沟通状态和黑名单徽标。
- [x] `npm run build` 和 `npm run build:worker` 通过。

## Out of Scope

- AI Resume Match Score、Company Score、Final Score。
- 多平台来源接入。
- 定制化打招呼文案生成。
- 每日岗位情报通知。
- 自动发送消息或自动投递。
