# 全站产品 UI 重设计实施计划

## Checklist

- [x] 加载 `trellis-before-dev`、设计 skills 与前端规范，确认现有行为和工作区边界。
- [x] 重建全局 token、应用外壳和共享 primitives。
- [x] 彻底重构职位库的视图导航、搜索、渐进筛选、结果工具栏和职位行。
- [x] 重构采集页与采集配置的信息架构和运行反馈。
- [x] 重构简历库 master-detail/editor 工作区。
- [x] 重构设置页为类别导航、单一内容 surface 和统一保存入口。
- [x] 运行格式与类型构建检查，修复模板或响应式问题。
- [x] 启动本地页面，验证 1280×800、390×844、类别切换、URL 和控制台。
- [x] 执行 `trellis-check` 与 `code-review-and-quality`，修复当前范围内明确问题。

## Validation Commands

```bash
npm run build
npm run test:review-workflow
git diff --check
```

## Review Gates

- 设置页业务事件、状态判断和 IPC 调用未改变。
- 默认首屏不同时渲染所有设置类别。
- 没有第二个保存入口、巨型字号、长说明墙或多层嵌套卡片。
- 桌面与移动端均无页面级横向溢出。
- 保留并整合 `src/pages/CrawlConfig.vue` 的紧凑定时采集改动。

## Rollback

- 页面模板改动可通过 revert 本任务提交整体回滚。
- 若局部布局导致回归，优先回退该类别模板，不修改脚本业务逻辑。
