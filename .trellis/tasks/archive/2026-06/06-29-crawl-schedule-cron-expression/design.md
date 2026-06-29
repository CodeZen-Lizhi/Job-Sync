# Design: Crawl Schedule Cron Expression

## Problem

当前“定时采集”只支持固定每日 `HH:mm` 触发，无法表达工作日、每周或间隔类规则。用户已经明确希望直接用 cron 风格表达式替换现有简单时间配置，但当前产品边界仍然保持为“仅在 App 打开时生效”。

## Scope

- 将采集配置页中的每日时间调度升级为 5 段式 cron 调度。
- 继续复用现有 `crawl_auto_start` 采集执行链路。
- 调度运行时仍由前端页面状态持有，仅在 Tauri App 打开时生效。
- 自动迁移旧版 `crawlScheduleTime` 配置为等价 cron 表达式。

不在本次范围内：

- 系统级调度器、后台常驻服务、App 关闭后触发。
- 多条定时任务。
- 秒级 cron、复杂时区配置、后端专用调度协议。

## Confirmed Product Decisions

- UI 直接替换现有“每天自动采集 + 时间”配置，不保留双模式。
- 采用 `@vue-js-cron/light` 作为 cron 编辑器。
- 采用 `Croner` 作为表达式校验和未来触发时间计算来源。
- 仅支持 5 段式 cron。
- 显示下一次触发和未来 3 次触发。
- 自动迁移旧版每日时间配置，如 `09:00 -> 0 9 * * *`。

## Current Facts

- [src/pages/CrawlConfig.vue](/Users/zhenglizhi/otherProjects/Job-Sync/src/pages/CrawlConfig.vue:177) 当前展示“每天自动采集”复选框和 `type="time"` 输入框。
- [src/lib/useCrawlPage.ts](/Users/zhenglizhi/otherProjects/Job-Sync/src/lib/useCrawlPage.ts:442) 通过 `buildCollectionConfigPayload()` 和 `applyCollectionConfigPayload()` 读写 `collection_config`。
- [src/lib/useCrawlPage.ts](/Users/zhenglizhi/otherProjects/Job-Sync/src/lib/useCrawlPage.ts:674) 当前通过 `computeNextDailyRunAt()` + `setTimeout()` 计算下次每日触发时间。
- 调度初始化已经从 [src/App.vue](/Users/zhenglizhi/otherProjects/Job-Sync/src/App.vue:57) 提前启动，因此新方案只需要替换调度表达方式，不需要新增 app 级入口。

## Architecture

```text
CrawlConfig cron editor
  -> cron expression state in useCrawlPage
  -> Croner validates expression and computes next runs
  -> useCrawlPage schedules one window.setTimeout for the next occurrence
  -> timer fires
  -> existing start() / crawl_auto_start flow
  -> persist last-run metadata and reschedule
```

## Data Model

### Persisted config

在现有 `collection_config` 上做向后兼容扩展：

- 保留 `crawlScheduleEnabled`
- 新增 `crawlScheduleExpression?: string`
- 保留 `crawlScheduleLastRunAt`
- 保留 `crawlScheduleLastStatus`
- 保留 `crawlScheduleLastMessage`
- 旧字段 `crawlScheduleTime` 继续读取一段时间用于兼容迁移，但新保存以 `crawlScheduleExpression` 为准

不需要 SQLite migration，因为配置仍然走现有 JSON 设置持久化。

### Runtime state

在 `useCrawlPage.ts` 中用 `crawlScheduleExpression` 替代 `crawlScheduleTime` 作为运行态主字段，并新增：

- `crawlScheduleDescription`
- `crawlScheduleUpcomingRuns`
- `crawlScheduleValidationError`

这些字段都属于前端派生态，不需要持久化。

## Migration

迁移放在 `applyCollectionConfigPayload()` 的归一化层：

1. 如果存在合法 `crawlScheduleExpression`，直接使用。
2. 否则如果存在旧 `crawlScheduleTime`，转成等价 5 段式 cron，如 `HH:mm -> m H * * *`。
3. 若两者都不存在，回退到默认 cron（建议保留与旧默认一致的 `0 9 * * *`）。
4. 用户下一次保存配置时，仅写回新字段 `crawlScheduleExpression`。

这样可以避免单独做一次“迁移命令”或后端版本升级逻辑。

## Scheduling Runtime

用 `Croner` 替换 `computeNextDailyRunAt()`：

1. 当 `crawlScheduleEnabled = false` 时，清空 timer 和未来触发预览。
2. 当表达式非法时，不设置 timer，并在 UI 展示错误。
3. 当表达式合法时，使用 `Croner` 计算下一次触发和未来 3 次触发。
4. 用最近的一次触发时间设置单个 `window.setTimeout()`。
5. timer 触发后，沿用现有 `runScheduledCrawl()` 逻辑：
   - 运行中则记录 skipped
   - 空闲则调用 `start()`
   - 完成后记录状态并重新计算下一次触发

依旧禁止并发排队，不引入 catch-up 机制。

## UI

保留现有“定时采集”面板位置和右侧状态卡，替换左侧内容为：

- 启用复选框
- `@vue-js-cron/light` 编辑器主体
- 当前 cron 表达式只读展示或同步展示
- 人类可读说明
- 表达式错误提示
- “未来 3 次触发”列表

UI 原则：

- 不额外引入大型 UI 框架风格
- 通过外层容器、文案和状态区把 `light` 组件收进现有页面语言
- 保持移动端可折行，不让 cron 区域撑爆卡片宽度

## Compatibility

- 手动采集逻辑不变。
- 已启用旧每日定时的用户升级后仍然保持原规则。
- 旧字段兼容读取，新字段作为唯一写入来源。
- 父任务中“app-open only”边界保持不变。

## Validation

- 前端构建通过。
- 契约测试更新为 cron 字段和新 UI 文案。
- 浏览器烟测验证桌面/移动端下 cron 面板可见、未来 3 次触发可见、无横向溢出。
- 至少验证一个旧配置样例能被正确迁移并显示。

## Risks

- `@vue-js-cron/light` 的默认视觉可能和页面略有差异，需要适度包裹与样式微调。
- cron 描述文案如果完全依赖编辑器自身，中文可读性可能不足；必要时补充本地说明映射或描述库。
- 调度精度仍受浏览器计时器和页面生命周期影响，但这与现有 app-open-only 模型一致。

## Rollback

- 可以回退为旧 `crawlScheduleTime` + 每日时间输入方案。
- 兼容读取旧字段会保留，因此回滚时不会丢失核心开关和执行状态。
- 不涉及数据库 schema 回滚。
