# 完善采集批次汇总与待确认补证据流程

## Goal

把上一轮已经打通的“采集入库 -> Rust 后置筛选 -> 职位库分桶”继续补完整：用户一次自动采集结束后，能看到这一轮到底采到了多少岗位、多少新增/更新/重复、多少推荐/待确认/已过滤、多少入库失败；对待确认岗位，用户可以触发补证据并重新判断；无法入库的岗位事实不能静默丢失。

## User Value

- 用户不只看到“采集完成”，还能知道这次采集结果质量如何。
- 待确认岗位不再只是一个静态分桶，可以通过补抓详情/JD 变成推荐或已过滤。
- 出现平台 payload 异常、缺稳定 ID、单条 upsert 失败时，用户和开发者都有可追踪证据。
- 重算筛选画像后，用户能看到推荐、待确认、已过滤数量变化，理解规则调整效果。

## Confirmed Facts

- 上一轮已实现：Boss `JOB_LIST_CAPTURED` 保留完整 raw；Rust default Filter profile 使用 `job.jd_text`、`job.raw_payload_json`、Boss detail raw；`reason_json.bucket` 支持 `recommended`、`pending_confirmation`、`filtered`；职位库分页支持 bucket 参数。
- 当前 SQLite schema 没有 collection run / batch summary 表，也没有 collection item failure 表。
- Sidecar 处理 worker 事件的位置在 `src-tauri/src/sidecar/mod.rs`。
- Worker events 已包含 `PROGRESS`、`JOB_LIST_CAPTURED`、`JOB_DETAIL_CAPTURED`、`JOB_NORMALIZED_CAPTURED`、`JOB_FILTERED`、`ERROR`、`FINISHED`。
- `job_source_link` 可以判断岗位是否来自自动采集，但不能表达一次 run 的汇总。
- `list_job_candidates` 可以按 canonical bucket 查询职位库，但没有返回桶数量汇总。
- 现有前端采集页和职位库页已有采集配置、职位库分桶、重算筛选画像入口。

## Requirements

1. 采集批次汇总
   - 每次自动采集应创建一个本地 collection run 记录。
   - run 需要记录 source platform、keywords、filters/limits、started_at、finished_at、status、错误信息。
   - run 需要汇总 captured / inserted / updated / duplicate / recommended / pending / filtered / failed。
   - Boss 和 V2EX 自动采集都应进入同一个 run summary 模型。

2. 入库结果可计数
   - Sidecar upsert list/detail/normalized job 后，应能判断至少新增、更新或重复。
   - 被 worker 轻量筛掉的 Boss item 仍按真实 job upsert 结果计数。
   - 统计应基于实际 DB 写入和 canonical filter result，不基于 worker 的临时 eligible 判断。

3. 无法入库错误持久化
   - 缺稳定 job id、payload 解析失败、单条 upsert 失败、filter recompute 失败等不能只写日志。
   - 每条失败至少保存 run_id、source_platform、event_type、keyword、reason、raw_payload_json、created_at。
   - UI 或查询命令能读取最近失败记录，便于用户理解“为什么没入库”。

4. 待确认补证据
   - 用户可以对 pending_confirmation 岗位触发补证据动作。
   - Boss 岗位优先尝试通过已有 source/detail URL 或 list raw 标识补抓详情；非 Boss 或无法自动补抓时应返回明确错误，不假成功。
   - 补证据成功后必须更新 `job_detail_raw`/`job.jd_text` 或相关 raw payload，并重新执行 Rust canonical filter。
   - 补证据失败也应被记录，不影响原岗位保留在职位库。

5. 批量重算/分桶刷新
   - 默认筛选画像重算后返回 updated 数量和 recommended / pending / filtered / processed / all 的最新数量。
   - 职位库或筛选配置页面能显示重算后的分桶数量变化。
   - 不新增自动投递、自动开聊、自动发送简历。

6. 兼容性
   - 新表和字段必须 additive migration，不破坏已有 job、filter result、review state。
   - 旧数据库升级后，无 collection run 历史也能正常打开职位库。
   - 如果补证据需要登录/session，缺 session 时要显式报错。

## Acceptance Criteria

- [ ] 自动采集开始会创建 collection run；结束会标记 finished/failed/stopped，并可查询最近 run summary。
- [ ] Sidecar 对 list/detail/normalized/job filtered 事件的入库结果能统计 inserted / updated / duplicate / failed。
- [ ] 推荐、待确认、已过滤、已处理、全部入库数量来自 canonical DB/filter state。
- [ ] 缺稳定 ID、payload 解析失败或单条 upsert/recompute 失败会写入 collection failure 表，并有查询命令覆盖。
- [ ] 待确认 Boss 岗位可触发补证据；成功后重新筛选并离开或保留 pending bucket；失败会返回明确错误并记录。
- [ ] 非 Boss 或缺详情抓取条件的 pending 岗位不会假成功，会保留并提示原因。
- [ ] 重算默认筛选画像返回 bucket counts，前端能展示本次重算结果。
- [ ] Rust 单测覆盖 migration、run summary、failure record、bucket counts、pending evidence refresh。
- [ ] Worker/前端合约测试覆盖 collection run summary 与无自动投递/开聊约束。
- [ ] `cargo test`、`npm run test:review-workflow`、`npm run test:worker`、`npm run build` 通过。

## Out of Scope

- 不做自动投递、自动开聊、自动发送简历。
- 不把 LLM 引入默认筛选器。
- 不重做整个 UI 视觉风格；只补必要的数据显示和操作入口。
- 不实现所有平台的详情补抓；本轮以 Boss pending 岗位为自动补证据 MVP，其他来源必须明确不可自动补证据。

## Notes

- 这次是结构性扩展，优先保证数据模型和 canonical 事实源稳定。
- collection run summary 应该是“解释采集结果”的运营数据，不应该反过来决定岗位是否保留。
