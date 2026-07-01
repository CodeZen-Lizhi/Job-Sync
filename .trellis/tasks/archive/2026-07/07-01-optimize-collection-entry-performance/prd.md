# 优化采集入口性能

## Goal

在不改变现有采集、采集配置、定时采集、平台选择、采后规则和运行日志功能的前提下，降低点击「采集」和「采集配置」后的等待感，并用可重复性能测试证明改动有效。

## Confirmed Facts

- 应用是 Vue 3 + Vite + Tauri 客户端，路由入口在 `src/router.ts`。
- 顶层导航在 `src/App.vue`，当前静态导入所有页面，并在根组件里调用 `useCrawlPage({ initialize: "schedule" })` 初始化定时采集。
- 「采集」页 `src/pages/Crawl.vue` 和「采集配置」页 `src/pages/CrawlConfig.vue` 都复用 `src/lib/useCrawlPage.ts` 的单例状态。
- `useCrawlPage().initialize()` 会触发采集配置、采集来源、采集摘要、Boss meta、默认采后规则等初始化；其中 Tauri 环境会产生多个 IPC。
- `CrawlConfig.vue` 当前一次性导入 `@vue-js-cron/light` 并在页面渲染时包含完整定时采集编辑器、平台配置区和采后规则区。
- 项目规范要求 collection source selection、platform login state、filter profile allowed candidate sources 保持概念分离。

## Requirements

- 不改变用户可见功能、配置字段、Tauri IPC 契约、采集 payload 语义或保存行为。
- 优化点击「采集」和「采集配置」的首屏可交互时间；允许重构前端状态和组件边界。
- 首选减少初始 JS/组件渲染和非必要初始化；只有证据显示现有技术栈无法满足时才考虑换语言或替换前端框架。
- 必须新增或提供可重复的性能测试命令，能测量采集入口路由切换耗时。
- 保留现有构建、类型检查和相关契约测试通过。

## Acceptance Criteria

- [x] 有性能基线结果，覆盖从其他路由点击到 `/crawl` 和 `/crawl-config` 的耗时。
- [x] 有优化后的同一测试结果，并能看到明确改善或解释为什么瓶颈不在当前可改范围。
- [x] `/crawl` 和 `/crawl-config` 的页面功能仍可用：来源选择、保存配置、开始/停止采集、运行日志、定时配置、平台配置折叠状态、采后规则入口保持原语义。
- [x] 前端构建通过。
- [x] 与采集配置/来源契约相关的现有测试通过或说明不可运行原因。

## Out Of Scope

- 不改变真实采集策略、Boss/V2EX/LinuxDo/智联 worker 逻辑或采后 AI 判断业务规则。
- 不做数据库 schema 迁移，除非性能测试证明入口慢来自热路径大 payload。
- 不引入新 UI 功能或重设计视觉风格。

## Open Questions

- 暂无阻塞规划的问题；真实桌面体感若仍慢，可能需要用户提供本机数据规模或录屏时间点。
