# 按 shadcn 风格重构全页面

## Goal

以 shadcn/ui 官方 dashboard、sidebar、card、form、table 与 empty-state 组合为明确参考，重新设计 JobPilot 应用外壳和全部可访问页面，交付克制、紧凑、中性、可信赖的桌面工具界面。

## Background

- 用户明确否定上一版视觉，认为当前页面仍然很丑，并指定使用 shadcn 风格作为参考基准。
- 上一版引入了深色渐变侧栏、网格背景、紫色光晕、大面积圆角标题卡、英文 eyebrow 和暗色运行面板；这些元素偏概念化、装饰性强，与 shadcn 的中性产品界面不一致。
- 当前项目是 Vue 3 + Tailwind CSS 3 + Tauri，不直接使用 React/Radix；本次复刻的是 shadcn 的视觉系统、组件组成和布局节奏，不引入 React 生态依赖。
- shadcn/ui 官方主题使用 background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring/sidebar 等语义 token，默认基础圆角约为 `0.625rem`。
- shadcn 官方应用骨架使用紧凑 sidebar、sidebar inset 和约 48–64px 的 header；Card、Table、Empty 主要通过边框、间距和排版建立层级，不依赖装饰背景和重阴影。

## Requirements

### R1. 明确采用 shadcn 视觉语言

- 使用 neutral/zinc 风格的黑、白、灰语义色，主操作为近黑色，不使用大面积紫色品牌色。
- 页面背景为纯净中性底色，不使用网格、渐变 mesh、光晕、纹理或玻璃拟态。
- 基础圆角控制在约 8–10px；卡片、输入、按钮、弹窗采用一致半径体系。
- 表面主要使用细边框和极轻阴影；不使用悬浮大阴影、按钮上移或装饰性动画。
- 字体与层级接近 shadcn dashboard：紧凑标题、清晰正文、muted 辅助信息、稳定数字排版。

### R2. 应用外壳

- 桌面端使用浅色 sidebar、右侧细边框、紧凑品牌区、分组导航与清晰 active 状态。
- 主工作区顶部使用简单 header/inset，不再给每个页面套独立大标题卡。
- 移动端导航必须在 390px 宽度内完整显示且当前入口可见，不依赖横向滚动。
- 保留现有路由与信息架构。

### R3. 共享组件视觉

- 将现有 `ui-*` primitives 对齐 shadcn Button、Card、Input、Textarea、Badge、Alert、Dialog、Tabs/Segmented、Table/List 和 Empty 的结构与状态。
- Button 至少包含 primary、secondary/outline、destructive、ghost/icon 等明确层级。
- 表单标签、描述、错误、禁用、focus ring 和弹层状态必须统一。
- 选择器与操作菜单继续保持现有 Vue 行为，只更新视觉。

### R4. 全页面布局

- 覆盖 `/crawl`、`/crawl-config`、`/jobs`、`/resume-library`、`/settings` 及关联展示组件。
- 采集页恢复为浅色运行工作台：控制、指标和日志使用一致 Card 层级，不保留大面积暗色块。
- 采集配置页使用紧凑 section/card 组合，来源 selector、定时配置和平台配置遵循统一表单节奏。
- 职位库使用清晰 toolbar/filter/result card 和数据行层级，接近 shadcn data table/dashboard。
- 简历库使用朴素 master-detail/editor 布局；空态使用 icon + title + description + actions，不使用光晕背景。
- 设置页保留分区导航，但表现为紧凑 tabs/secondary controls；长表单采用稳定 section/card 结构。

### R5. 行为与技术约束

- 不改变采集、职位、简历、设置的业务逻辑、数据契约、路由、IPC 或持久化格式。
- 不引入 React、Radix、重量级 UI 库或必须联网加载的字体。
- 保留 Hash Router 页面内导航的按钮 + `scrollIntoView` 约束。
- 保留采集页结构化批次统计、唯一运行状态和弹性日志区。

## Acceptance Criteria

- [x] 应用中不再出现网格背景、紫色光晕、渐变侧栏、大标题卡或装饰性英文 eyebrow。
- [x] 全站颜色、圆角、边框、按钮、输入、Badge、Alert、Dialog 和 Empty 与 shadcn neutral 风格一致。
- [x] 桌面侧栏、页面 header、内容区和移动导航形成紧凑统一的应用骨架。
- [x] 五个可访问页面及关联展示组件完成视觉与布局重构，业务操作和状态语义保持不变。
- [x] 1280×800 与 390×844 下无关键横向溢出、遮挡、不可见导航或失控布局。
- [x] 设置分区导航不会改变 `/#/settings` 路由。
- [x] `npm run test:review-workflow` 与 `npm run build` 通过。
- [x] 浏览器逐页视觉烟测和控制台检查通过。
- [x] 通过 `trellis-check`、`code-review-and-quality` 与 `frontend-design` 复核。

## Verification Results

- `npm run test:review-workflow`：61/61 通过。
- `npm run build`：Vue 类型检查与 Vite 生产构建通过。
- `git diff --check`：通过。
- 浏览器桌面验证：`/crawl`、`/crawl-config`、`/jobs`、`/resume-library`、`/settings` 在 1280×800 下无横向溢出；`UiSelect` 与 `UiMultiSelect` 展开、选择和状态更新正常。
- 浏览器移动验证：五个路由在 390×844 下 `documentElement.scrollWidth === clientWidth === 390`；移动导航 `scrollWidth === clientWidth === 366`。
- 设置分区按钮通过 `scrollIntoView` 工作，URL 保持 `/#/settings`。
- 浏览器控制台：无 error 或 warning。
- 审查结果：未发现当前范围内明显业务回归、安全退化或第二套视觉事实源。

## Out of Scope

- 安装真正的 React shadcn/ui 或迁移前端框架。
- 新增暗色主题、主题切换器或自定义换肤功能。
- 新增业务功能、修改数据库、Rust、worker、AI 规则或发布版本号。
