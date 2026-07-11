# 设置页紧凑偏好面板设计

## Direction

采用 desktop-native、compact、quiet 的偏好设置结构：桌面为 `176px + minmax(0,1fr)` 双栏，移动端类别导航在自身内部横向滚动。

## Boundaries

- 业务逻辑、响应式状态、IPC 和保存 payload 不变。
- 新增 typed `activeSection` 只控制本地展示。
- 平台详情与模型高级提示使用原生 `details`，保持键盘可用。
- 仅一个共享保存 footer，切换类别时未保存 refs 保持不变。

## Content

- 合并浏览器与代理为“网络与浏览器”。
- 平台默认显示名称、状态和操作，说明按需展开。
- 模型基础字段直接显示，三个提示字段默认收起。
- 诊断结果使用紧凑状态行，继续遵守脱敏与无副作用契约。

## Rollback

页面改动集中在 `src/pages/Settings.vue`，可独立 revert，不影响其他页面或数据契约。
