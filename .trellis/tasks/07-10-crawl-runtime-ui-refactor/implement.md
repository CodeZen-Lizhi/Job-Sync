# 采集运行页 UI 实施计划

## 前置条件

- [ ] `07-10-job-display-approved-only` 已完成或相关工作树改动已稳定并通过验证。
- [ ] 开始实现前重新读取最新 `Crawl.vue`、`CrawlActionBar.vue`、`CrawlRuntimePanel.vue` 与 crawl 专用 CSS diff。

## 实施顺序

1. 使用 `trellis-before-dev` 加载前端规范和本任务 PRD/设计。
2. 为页面关键文案、统计 summary prop、唯一状态和操作 disabled 语义补充或更新契约测试。
3. 重构 `Crawl.vue` 的页面级高度和紧凑控制区，接入来源摘要。
4. 重构 `CrawlActionBar.vue`，收敛为唯一运行状态/操作区域，保持 props、emits 和 disabled 条件。
5. 重构 `CrawlRuntimePanel.vue` 为分段指标条、日志空状态和无重复状态的日志工作区。
6. 仅调整 `src/styles/tailwind.css` 中 crawl 专用样式，移除日志固定高度并补 reduced-motion。
7. 运行测试与构建，启动本地服务完成 `1280x720`、`390x844` 浏览器截图和 overflow 检查。
8. 在 Tauri 中执行开始/停止最小烟测，确认真实状态、日志和布局。
9. 使用 `trellis-check` 与 `code-review-and-quality` 审查，修复当前范围内明确问题后复验。

## 验证命令

```bash
npm run test:review-workflow
npm run build
npm run dev -- --host 127.0.0.1
```

浏览器检查：

- `/crawl` at `1280x720`：`scrollWidth <= clientWidth`，日志标题和正文进入首屏。
- `/crawl` at `390x844`：无横向溢出、文字裁切、按钮重叠或指标尺寸跳动。
- 检查浏览器警告、disabled、空闲、运行中、空日志、有日志、警告和错误状态。

## 风险文件

- `src/pages/Crawl.vue`：页面高度与延迟挂载 placeholder。
- `src/components/crawl/CrawlActionBar.vue`：开始/停止 disabled 语义。
- `src/components/crawl/CrawlRuntimePanel.vue`：统计 summary 契约和日志密度。
- `src/styles/tailwind.css`：浏览器与 Tauri WebView 的 flex 高度差异。

## Review Gate

- 不修改批次统计、AI 判断、IPC、路由或持久化行为。
- 不新增依赖，不改全局视觉 token，不影响其他页面。
- 不从日志文本推算统计，不创建第二状态源。
- 桌面与窄屏均有真实页面证据，不能只依赖构建成功。
