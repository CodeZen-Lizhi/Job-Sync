# 采集 cron 表达式支持

## Goal

让现有“定时采集”从固定每天一次的 `HH:mm` 配置，升级为支持 cron 风格表达式的可配置调度，同时保持当前产品边界仍然是“仅在 App 打开时生效”。

## Requirements

- 用户可以在采集配置页直接配置 cron 风格表达式，而不是只能填写每天固定时间。
- 定时采集继续复用现有采集配置、来源选择和 `crawl_auto_start` 流程，不引入第二套采集执行链路。
- 当前产品边界保持不变：调度仍然只在 App 打开时生效，不引入系统级 cron、后台常驻服务或操作系统任务计划。
- UI 直接以 cron 编辑器替换现有“每天自动采集 + 时间”配置，不保留简单模式 / cron 模式切换。
- UI 需要让普通用户可理解，不能只暴露一个裸 cron 文本框而没有辅助说明。
- 用户能预览表达式的人类可读说明，以及至少下一次触发时间。
- 用户能看到未来 3 次触发时间预览，用来确认 cron 规则是否符合预期。
- cron 表达式只支持常见的 5 段式分钟粒度，不开放 6 段式秒级表达式。
- 表达式非法时，界面需要即时给出明确错误，避免保存无效配置。
- 已有保存的每日定时配置需要在升级后自动迁移成等价的 5 段式 cron 表达式，避免老用户丢失既有定时能力。

## User Value

- 用户可以从“每天一次”扩展到工作日、每周、每月或更细粒度的采集规则。
- 不需要脱离应用额外写脚本，就能获得更灵活的触发方式。
- 仍然沿用已有采集配置和结果反馈，不增加额外学习成本。

## Confirmed Facts

- 当前实现位于 [src/lib/useCrawlPage.ts](/Users/zhenglizhi/otherProjects/Job-Sync/src/lib/useCrawlPage.ts:674)，使用前端 `setTimeout` 计算“下一次每天触发时间”，不是系统调度。
- 当前配置页位于 [src/pages/CrawlConfig.vue](/Users/zhenglizhi/otherProjects/Job-Sync/src/pages/CrawlConfig.vue:177)，UI 是项目自定义表单样式，不依赖 Element Plus、Naive UI 或 Ant Design Vue。
- 当前项目依赖栈是 `Vue 3 + Tailwind + 自定义 UI`，见 [package.json](/Users/zhenglizhi/otherProjects/Job-Sync/package.json:1)。
- 已有父任务 [.trellis/tasks/06-28-crawl-schedule](/Users/zhenglizhi/otherProjects/Job-Sync/.trellis/tasks/06-28-crawl-schedule/prd.md:1) 实现的是“每天固定时间、App 打开时触发”的第一版定时采集。
- 现有契约测试明确不希望第一版定时能力依赖 `cron` / `system scheduler` / `后台常驻`，见 [test/review-workflow-contract.test.js](/Users/zhenglizhi/otherProjects/Job-Sync/test/review-workflow-contract.test.js:570)。
- 当前规划偏好是使用 `@vue-js-cron/light` 作为 cron 编辑 UI，使用 `Croner` 做表达式校验与下一次/未来触发时间计算，并在页面补充人类可读说明与状态提示。
- 当前产品决策是直接替换现有“每天自动采集 + 时间”UI，不保留简单模式。
- 当前产品决策是展示未来 3 次触发时间，而不是只展示 1 次。
- 当前产品决策是只支持 5 段式 cron，不支持秒级表达式。
- 当前产品决策是自动迁移已有 `crawlScheduleTime` 日级配置，例如 `09:00 -> 0 9 * * *`。
- 从现有实现看，迁移最适合落在 `useCrawlPage.ts` 的配置读取/归一化层：当前 `buildCollectionConfigPayload()` 负责保存调度字段，`applyCollectionConfigPayload()` 负责读取并回填调度字段。

## Acceptance Criteria

- [ ] 采集配置页支持设置 cron 风格表达式，并直接替换现有固定 `HH:mm` 配置 UI。
- [ ] 用户在配置时可以看到表达式是否合法，以及对应的人类可读说明。
- [ ] 用户可以看到下一次触发时间，以及未来 3 次触发时间预览。
- [ ] 定时触发仍然复用现有采集执行链路，表达式只改变“何时触发”，不改变“如何采集”。
- [ ] 当表达式非法时，用户无法误保存为生效中的调度配置。
- [ ] 仅支持 5 段式 cron；输入秒级或其他不受支持格式时，界面给出明确错误。
- [ ] 旧版仅保存 `crawlScheduleTime` 的用户，在升级后仍能看到等价 cron 配置并继续按原定时规则触发。
- [ ] 本次改造不要求支持 App 关闭后仍然触发。

## Out Of Scope

- 操作系统级 cron / launchd / Windows Task Scheduler 集成。
- 后台常驻调度服务。
- 多条独立定时任务并存。
- 本次先不改采集执行后端协议，只讨论或实现调度表达方式与前端交互。

## Open Questions

- 当前无阻塞性开放问题；如进入实现，可按现有 PRD 直接展开。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
