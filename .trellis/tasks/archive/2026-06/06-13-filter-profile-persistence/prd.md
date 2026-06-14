# 筛选画像持久化与过滤结果回溯

## Goal

把需求文档 Phase 2 的 Boss-only 筛选闭环从“采集页临时输入”推进到本地可持久化、可回溯的最小闭环：用户配置的默认筛选画像会保存到本地，自动采集时会按该画像过滤 Boss 列表项，过滤结果和解释信息会写入 SQLite，并能在职位库中看到岗位当前是否被筛选画像挡掉。

## Confirmed Facts

- 项目主需求在 `docs/job-sync-remote-tech-jobs-requirements.md`，Phase 2 要求筛选画像支持必须满足、必须排除、偏好加权，并展示过滤原因。
- 当前应用是 Tauri + Vue + Rust + SQLite + Node worker。
- 当前 SQLite 已有 `job`、`job_detail_raw`、`job_source_link`、`ai_report`，还没有筛选画像或过滤结果表。
- 上一轮已在 worker 中加入 Boss 列表项关键词过滤，并发出 `JOB_FILTERED` / `filtered_job` 事件；但规则还来自采集页临时状态。
- 职位库查询目前返回 `JobRow` 基础字段，不包含过滤状态。

## Requirements

- 默认筛选画像必须保存到本地应用设置中，重启后仍可加载。
- 采集页必须从已保存的默认画像初始化三类关键词：必须包含、必须排除、偏好。
- 用户修改采集页画像并开始自动采集时，必须先保存为默认画像，再用于本次采集。
- 自动采集过程中，被过滤岗位必须写入 SQLite 过滤结果表，包含岗位 ID、画像 ID、eligible、解释 JSON、更新时间。
- 合格进入列表入库的岗位也应写入 eligible=true 的过滤结果，便于后续回溯。
- 职位库列表应展示当前岗位是否通过筛选画像；未通过时展示主要过滤原因。
- 删除职位或清空职位时，应同步清理该职位的过滤结果。

## Acceptance Criteria

- [x] 关闭/重开页面后，采集页能恢复默认筛选画像关键词。
- [x] 开始自动采集会保存当前画像，并把该画像传给 worker。
- [x] `JOB_FILTERED` 事件落库为 `eligible=false`，原因可在 SQLite 中追踪。
- [x] `JOB_LIST_CAPTURED` 中合格岗位落库为 `eligible=true`。
- [x] 职位库 `JobRow` 返回 `filter_eligible`、`filter_reason_json`、`filter_updated_at`。
- [x] 职位库列表对未通过岗位展示过滤徽标和原因。
- [x] `npm run build` 和 `npm run build:worker` 通过。

## Out of Scope

- 多画像管理 UI。
- 完整工作方式、薪资、城市、经验、学历、公司条件等结构化规则。
- 黑名单、沟通状态、审核状态。
- Resume Match Score、Company Score、Final Score、Top 20 审核队列。
- 多平台来源 adapter。
