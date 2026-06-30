# 采集定时任务

## Goal

让用户可以给采集配置加定时任务，自动在指定时间触发采集。

## User Value

- 用户不用手动盯着时间点启动采集。
- 现有采集配置、来源选择和采集执行逻辑可以复用。
- 可以把“定时采集”作为采集工作台的一个常用能力，而不是额外脚本。

## Confirmed Facts

- 现有采集入口是手动触发的 `crawl_auto_start`，仓库里没有现成的 cron/interval 调度层。
- 采集配置页已经承载了来源选择、关键词和 Boss/V2EX/LinuxDo 配置。
- `useCrawlPage` 已经有前端状态和启动/停止逻辑，适合挂定时开关或调度配置。
- 当前应用没有后台常驻调度器；如果要“关掉 App 也跑”，需要额外明确实现方式。

## Requirements

- 用户可以开启/关闭某个采集定时任务。
- 用户可以设置每天固定的定时采集触发时间。
- 到点后系统会自动按当前采集配置触发采集。
- 定时采集应复用现有采集来源和参数，不重写采集业务。
- 用户能看到最近一次定时采集的执行结果或失败原因。

## Acceptance Criteria

- [x] 采集配置页或独立入口能查看/配置定时采集。
- [x] 开启后会在每天设定时间自动触发采集。
- [x] 关闭后不会再自动触发。
- [x] 定时触发复用现有采集逻辑，采集结果和手动触发一致。
- [x] 出现失败时能看到明确原因。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.

## Open Questions

- 已实现为只在 App 打开时生效；不引入系统级后台常驻。
