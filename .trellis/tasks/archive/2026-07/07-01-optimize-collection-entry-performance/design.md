# Design

## Problem

点击「采集」和「采集配置」慢，本质上可能由三类成本叠加：

1. 路由模块加载成本：`router.ts` 静态导入所有页面，`CrawlConfig.vue` 及其 cron/editor 依赖会进入初始路由图。
2. 页面初始化成本：`useCrawlPage().initialize()` 在进入采集页面时触发多个 Tauri IPC 和状态应用。
3. 首屏渲染成本：`CrawlConfig.vue` 一次性渲染多个配置区，尤其 cron 编辑器和 Boss 字典相关选择控件。

## Approach

- 建立 Vite 浏览器性能测试，使用 Puppeteer 打开应用、点击侧边栏链接，并读取 `performance.measure` / Navigation Timing。浏览器模式不覆盖 Tauri IPC，但能稳定测量前端路由、模块和渲染成本。
- 先优化前端模块边界：
  - 保持 `/crawl` 和 `/crawl-config` 这两个主入口 route shell 静态可用，避免用户点击时等待 route chunk。
  - 将重组件延后加载，特别是 `@vue-js-cron/light` 不进入采集配置 route shell。
- 再优化采集状态初始化：
  - 保持单例状态，但区分 schedule-only、summary-only、config-full 这类初始化意图。
- `/crawl` 首屏只需要运行控制和当前运行状态，不应阻塞在 Boss meta、默认采后规则、来源摘要刷新或大日志面板挂载上。
  - `/crawl-config` 需要完整配置，但可先显示来源和保存入口，再后台加载 Boss meta / filter profile。
- 保持 IPC 契约不变，避免 Rust 和 worker 逻辑变化。

## Compatibility

- 所有已有 `useCrawlPage()` 返回字段保持兼容。
- `selectedCollectionSources`、平台配置 payload、定时采集保存结构保持兼容。
- Tauri 环境仍由 `isTauri()` 判断；浏览器性能测试使用非 Tauri 预览路径。

## Validation

- 新增性能测试脚本，输出 `/crawl` 和 `/crawl-config` 点击耗时。
- 运行 `npm run build`。
- 运行与前端/采集契约相关的 Node contract tests。
- 交付前用 diff review 检查是否引入第二套 collection source 或 filter profile 事实源。

## Rollback

- 组件拆分是前端局部改动；可通过恢复页面直接导入组件回滚。
- 初始化策略若出现行为差异，可恢复 `initialize()` 的原始调用集合。
