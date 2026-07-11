# shadcn 风格全页面重构实施计划

## Checklist

- [x] 加载 `trellis-before-dev` 与前端规范，确认工作区和上一版回滚基线。
- [x] 搜索上一版装饰性类与颜色：grid background、gradient、indigo/purple glow、large page header、dark crawl panels、page animation。
- [x] 重建 semantic tokens 与共享 primitives，使其接近 shadcn neutral theme。
- [x] 重构 `App.vue` 为浅色紧凑 sidebar + inset header，删除宣传卡和渐变背景。
- [x] 重构统一 page header，删除 eyebrow、标题卡、光晕和大圆角。
- [x] 重构 Button、Input、Textarea、Badge、Alert、Dialog、Segmented/Tabs、Card、Empty、List 等共享样式。
- [x] 重构 Crawl 与 runtime components 为浅色 Card/metrics/log 结构。
- [x] 重构 CrawlConfig 的 source/schedule/platform/rules 视觉层级。
- [x] 重构 Jobs 过滤区、结果区、职位行、弹窗和导出菜单。
- [x] 重构 ResumeLibrary 列表、编辑预览、关联区和空态。
- [x] 重构 Settings page header、section tabs、平台列表、表单卡与诊断区。
- [x] 同步 Export 和共享 select/action menu 的视觉。
- [x] 搜索并删除遗留装饰性 class/token，确认没有第二套视觉事实源。
- [x] 运行契约测试与生产构建。
- [x] 浏览器验证五个路由的 1280×800、390×844、控制台和设置分区交互。
- [x] 执行 `trellis-check`、`code-review-and-quality` 和 `frontend-design` 审查并修复问题。

## Validation Commands

```bash
npm run test:review-workflow
npm run build
npm run dev -- --host 127.0.0.1
```

## Browser Routes

- `/#/crawl`
- `/#/crawl-config`
- `/#/jobs`
- `/#/resume-library`
- `/#/settings`

## Review Gates

- 无 grid/mesh/glow/gradient sidebar/large title card/decorative eyebrow。
- 无新增 React/Radix/shadcn runtime 依赖。
- primary、secondary、muted、accent、destructive、border、input、ring、sidebar token 语义清晰。
- 五个页面保持业务功能、状态和交互契约。
- 移动导航无溢出；设置 section navigation 不改变 Hash Router URL。
- 测试、构建和浏览器验证全部通过。

## Rollback Points

- tokens/primitives、App shell、page headers、page-specific styles 分阶段修改并逐步构建。
- 若共享 CSS 导致回归，优先回退对应 primitive，而不是在页面叠加覆盖类。
- 完整回滚可 revert 本任务独立提交，上一版基线为 `ae6653c`。
