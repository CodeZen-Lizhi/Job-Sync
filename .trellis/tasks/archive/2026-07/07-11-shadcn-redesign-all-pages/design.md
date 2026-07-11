# shadcn 风格全页面重构设计

## Reference Baseline

参考 shadcn/ui 官方文档：

- Theme：neutral semantic tokens，`--radius: 0.625rem`，near-black primary，muted/accent 为浅灰。
- Sidebar：紧凑 sidebar + inset + 48–64px header，active item 使用浅 accent 背景而非高饱和色块。
- Card：Header / Title / Description / Content / Footer 的明确组成，细边框、有限圆角、少阴影。
- Data Table：单一 bordered container、清晰 header/row 分隔、空结果行。
- Empty：icon、title、description、actions 的结构化组合，无装饰背景。

## Design Direction

关键词：neutral、quiet、compact、structured、desktop-native。

界面不再追求“有设计感的视觉效果”，而追求“像成熟开源工具一样自然”。辨识度来自信息组织和一致性，不来自背景装饰。

## Semantic Tokens

- background：白或极浅 neutral。
- foreground：近黑 neutral。
- card/popover：白。
- primary：近黑；primary foreground 为白。
- secondary/muted/accent：浅 neutral 灰。
- border/input：低对比 neutral 边框。
- ring：中灰 focus ring。
- destructive：稳定红色语义。
- sidebar：接近 background 的浅灰白，独立 sidebar border。
- success/warning：仅用于状态提示，不作为品牌色。

现有 Tailwind 3 继续通过 RGB CSS variables 映射语义 token，不升级 Tailwind，不复制 shadcn React 实现。

## Application Shell

### Desktop

- sidebar 宽度约 240–256px，浅色背景、右侧 1px border。
- brand 区高度约 64px，不使用独立卡片或大图标底座。
- nav group label 低对比、小字号；nav item 高度约 36–40px，active 为 `bg-accent text-accent-foreground`。
- 删除 sidebar 底部 Workspace 宣传卡。
- 主区使用 sidebar inset；顶部 header 高度约 56px，可显示当前页面标题/简短上下文。

### Mobile

- 简单 app header + 五项等宽导航。
- active 使用 neutral primary/secondary 对比，不使用紫色。

## Page Header

- 删除 `.ui-page-header` 的 card、光晕和大圆角背景。
- 页面顶部为普通 flex row：左侧 h1 + description，右侧 actions。
- h1 约 24px，description 约 14px muted；不显示装饰性英文 eyebrow。
- 页面间距统一约 20–24px。

## Shared Primitives

### Card

- radius 10px、1px border、white background。
- 默认无阴影或仅 `0 1px 2px`。
- header/content/footer 统一 padding 与 divider。

### Controls

- input/button 高度约 36–40px，radius 8px。
- primary near-black；outline 白底细边框；ghost 无边框；destructive 红色。
- hover 只改变 background/border，不做位移。
- focus 使用清晰 ring；disabled 降低 opacity 且不触发 hover。

### Badge / Alert / Dialog

- Badge 小圆角或轻微 pill，仅状态类使用彩色浅底。
- Alert 使用边框与小色差，不使用发光。
- Dialog radius 10px、border、明确 header/footer。

### Data / Empty

- 数据行通过 divider、hover-muted、selected-muted 表达状态。
- Empty 不使用渐变或光晕；高度适中，避免空数据页面出现巨型空白卡。

## Page-Specific Layout

- Crawl：page header + alert + control card + metrics card + log card；日志采用浅色 monospace surface。
- CrawlConfig：page header + alert + source card + schedule card + platform cards + rule card；减少嵌套卡。
- Jobs：page header + filter card + result card；bucket/filters 使用 tabs、select 和 toolbar 组合。
- ResumeLibrary：page header + master-detail bordered layout；editor/preview 与 aside 使用标准 card。
- Settings：page header + sticky compact tabs + label/content sections；移除上一版大面积装饰和过度留白。
- Export：保持兼容但同步 primitives。

## Responsive and Accessibility

- 390px 时 app nav `scrollWidth === clientWidth`。
- 页面 actions 可换行；card padding 在窄屏收紧。
- section tabs 在窄屏使用网格，桌面使用 inline controls。
- `prefers-reduced-motion` 下取消平滑滚动和非必要 transition。
- Hash Router 内页导航继续使用 button + `scrollIntoView`。

## Risks and Rollback

- `tailwind.css` 是最大影响点；先重建 tokens/primitives，再改 App shell，最后逐页检查。
- 共享类会影响复杂 Jobs/Settings/Resume 页面，必须逐页桌面和窄屏验证。
- 上一版工作提交 `ae6653c` 是明确回滚基线；本次应形成独立提交，不重写历史。
