# 全站产品 UI 重设计

## Design Direction

方向：precision workbench、editorial density、quiet confidence。

以 shadcn neutral primitives 为底层规则，但页面结构按任务重新编排。视觉记忆点来自清晰的工作流导航、紧凑数据排版、少量深色主操作和稳定的灰阶层次，不依赖渐变、光晕或泛滥卡片。

## Architecture and Boundaries

- 修改 `App.vue`、共享 UI primitives、五个主页面和关联展示组件。
- 保留 composable、事件、IPC 和路由契约；UI 状态只控制展示。
- 职位库采用 workflow tabs + search command bar + progressive filters + structured rows。
- 设置页采用类别导航 + 单一内容区；采集配置和职位详情采用渐进展开。

## Layout

### Desktop

- 紧凑 header：20px 标题、12px 描述、右侧状态摘要。
- 主体为 `176px + minmax(0, 1fr)` 双栏。
- 左侧导航 sticky，按钮高度约 36px，显示类别名和一句极短摘要。
- 右侧为单一 bordered surface，header 约 48px，content padding 16px，footer 固定一个保存按钮。

### Mobile

- header actions 换行。
- 类别导航变为横向可滚动的单行 tab，不扩大页面宽度。
- 内容表单回落到单列，平台操作允许合理换行。

## Content Decisions

- 合并“浏览器”和“网络代理”为“网络与浏览器”。
- 合并平台能力与平台登录为“平台与登录”。
- 模型服务保留基础字段；提示词与 Schema 字段放入原生 `details` 高级区域，默认收起。
- 平台默认只显示名称、核心状态和操作；技术标识及能力说明放入可展开详情。
- 诊断结果保持三块状态，但使用紧凑行而非高卡片。

## Interaction and Accessibility

- 类别按钮使用 `aria-current`，切换不修改路由。
- `details/summary` 使用浏览器原生键盘交互。
- 启用开关继续提供 `aria-pressed`。
- 所有按钮保留 disabled 和 focus 状态；不添加依赖鼠标悬停才能获得的信息。

## Compatibility and Rollback

- 不改变函数签名、保存 payload、IPC 名称或数据结构。
- 页面重构集中在单文件模板，易于独立 revert。
- 若页面专属共享样式影响其他页面，优先改为 `Settings.vue` 内 Tailwind class，避免扩大全局影响面。
