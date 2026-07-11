# 全页面布局重构实施计划

## 实施清单

- [x] 进入实施前加载 `trellis-before-dev` 和前端规范，确认工作区状态及受影响文件。
- [x] 搜索全部共享视觉 token 与 `ui-*` 类引用，建立改动影响清单。
- [x] 重建 Tailwind 语义色、字体、表面、阴影、焦点和 reduced-motion 规则，同时保持旧类名可控兼容。
- [x] 重构 `App.vue` 桌面侧栏、移动顶栏、导航状态和主内容画布。
- [x] 统一页面标题、工具栏、提示、分区、表单、按钮、徽标、空态、加载态、弹窗与菜单视觉。
- [x] 重构采集运行页及直接展示组件，保持既有统计和运行契约。
- [x] 重构采集配置页，按来源与配置任务重新组织层级，保持保存/同步逻辑。
- [x] 重构职位库及职位列表/详情/导出组件，强化筛选、摘要、职位信息与操作层级。
- [x] 重构简历库列表、编辑/预览、关联岗位与空态布局。
- [x] 重构设置页长表单与平台能力区域，增加清晰分区导航和稳定主操作。
- [x] 检查共享选择器、复选选择器和操作菜单在新主题下的浮层、焦点和禁用态。
- [x] 逐页检查加载、空态、错误、成功、禁用、弹窗和长文本场景。
- [x] 运行契约测试、类型检查和生产构建。
- [x] 启动本地页面，完成桌面与窄屏全部路由视觉烟测、交互烟测和控制台检查。
- [x] 使用 `trellis-check` 与 `code-review-and-quality` 做最终质量审查；发现当前范围内明确问题后修复并复验。
- [x] 判断是否形成可复用前端规范，必要时使用 `trellis-update-spec` 更新项目规范。

## 重点影响文件

- `src/styles/tailwind.css`
- `tailwind.config.ts`
- `src/App.vue`
- `src/pages/Crawl.vue`
- `src/pages/CrawlConfig.vue`
- `src/pages/Jobs.vue`
- `src/pages/ResumeLibrary.vue`
- `src/pages/Settings.vue`
- `src/pages/Export.vue`
- `src/components/crawl/*.vue`
- `src/components/jobs/*.vue`
- `src/components/ui/*.vue`
- 可能新增的 `src/components/layout/*.vue`
- `test/review-workflow-contract.test.js`（仅在现有视觉结构契约需同步时修改）

## 验证命令

```bash
npm run test:review-workflow
npm run build
npm run dev -- --host 127.0.0.1
```

浏览器烟测路由：

- `/#/crawl`
- `/#/crawl-config`
- `/#/jobs`
- `/#/resume-library`
- `/#/settings`

响应式视口：

- 桌面：1280×800
- 窄屏：390×844

## Review Gates

- 不包含 Rust、数据库、worker、IPC 或业务契约改动。
- 不新增重量级依赖，不引入必须联网加载的字体或资源。
- 五个可访问路由和相关弹层均使用统一视觉语言，但布局能体现各自任务差异。
- 所有关键操作、字段、状态、禁用逻辑和数据展示仍存在且语义一致。
- 无横向溢出、遮挡、不可点击控件、失焦浮层或低对比度正文。
- 采集页结构化统计、唯一运行状态和日志区域约束无回归。

## 风险点与回滚点

- 共享 CSS 修改后立即构建并逐页检查，避免错误扩散到全部页面。
- App 外壳完成后单独验证桌面与窄屏导航，再继续页面重构。
- 每完成一个页面组就运行最小浏览器烟测；若出现行为回归，优先回退该页面模板改动而非叠加兼容补丁。
- 设置与采集配置只调整模板布局和展示样式，不进行无关脚本重构。

## 验证结果

- `npm run test:review-workflow`：61/61 通过。
- `npm run build`：Vue 类型检查与 Vite 生产构建通过。
- 浏览器桌面烟测：五个路由在 1280×800 下 `documentWidth === viewportWidth`，主内容无横向溢出。
- 浏览器窄屏烟测：五个路由在 390×844 下 `documentWidth === viewportWidth`，五项移动导航 `scrollWidth === clientWidth`。
- 设置分区导航交互：点击“模型服务”后滚动到目标区域，URL 保持 `/#/settings` 不变。
- 浏览器控制台：未发现本次改动引入的错误。
- Review：发现并修复 Hash Router 锚点冲突与选中导航图标对比不足；未发现剩余阻塞问题。
