# Implement: Crawl Schedule Cron Expression

## Preconditions

- 保留当前脏工作区内无关改动。
- 开始实现前读取 `trellis-before-dev` 和前端相关 spec。
- 不改动现有 `crawl_auto_start` 后端采集入口。

## Checklist

1. [ ] 更新调度配置模型
1. [x] 更新调度配置模型
   - [x] 在 `CollectionConfigPayload` 中新增 `crawlScheduleExpression`
   - [x] 保留旧 `crawlScheduleTime` 读取兼容
   - [x] 新增默认 cron 表达式常量并替换旧时间默认值语义

2. [x] 实现表达式归一化与迁移
   - [x] 添加 5 段式 cron 归一化/校验 helper
   - [x] 在 `applyCollectionConfigPayload()` 中把旧 `crawlScheduleTime` 自动迁移为等价 cron
   - [x] 保存配置时只写回 `crawlScheduleExpression`

3. [x] 用 `Croner` 替换每日调度计算
   - [x] 删除或停用 `computeNextDailyRunAt()` 路径
   - [x] 用 `Croner` 计算下一次触发和未来 3 次触发
   - [x] 非法表达式时阻止启用有效调度并清晰暴露错误
   - [x] 保留单 timer + 运行中跳过策略

4. [x] 改造定时采集 UI
   - [x] 安装并接入 `@vue-js-cron/light`
   - [x] 用 cron 编辑区替换 `type="time"` 输入
   - [x] 展示表达式说明、校验错误、未来 3 次触发
   - [x] 保持现有右侧状态卡结构

5. [x] 更新测试
   - [x] 更新 `test/review-workflow-contract.test.js` 中的 schedule 断言
   - [x] 如有必要，补充旧配置迁移和 cron 字段 contract 断言

6. [x] 验证
   - [x] `npm run build`
   - [x] `node --test test/review-workflow-contract.test.js`
   - [x] 启动本地前端并做桌面/移动端烟测
   - [x] 手工验证迁移逻辑存在：旧 `crawlScheduleTime` 会在读取层转成 `0 9 * * *`

## Validation Commands

```bash
npm run build
node --test test/review-workflow-contract.test.js
```

如需本地页面烟测，再启动：

```bash
npm run dev
```

## Risk Points

- `@vue-js-cron/light` 样式与当前页面视觉不完全一致。
- `Croner` 的默认 cron 解析规则需确认与“只支持 5 段式”一致。
- 旧字段迁移如果写错，可能导致老用户定时配置静默变化。
- watcher 依赖从 `crawlScheduleTime` 切换到 `crawlScheduleExpression` 后，别遗漏初始化或 reschedule 时机。

## Rollback Point

- 若 cron UI 集成效果差，可以保留新的表达式存储与运行时逻辑，先退回到文本输入形式。
- 若 `Croner` 集成出现问题，可以先保留旧每日时间路径并延后 cron 运行时替换，但这只应作为开发期临时退路，不作为最终交付。
