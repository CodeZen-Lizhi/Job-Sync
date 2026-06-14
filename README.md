# job-sync（Tauri + Vue + Node sidecar）

一个桌面端（Tauri）Boss 直聘采集器：浏览器登录采集 Cookie / LocalStorage、手动 / 自动采集落库（SQLite）、岗位筛选 / 审核、AI 匹配分析和简历工作区。

## 目录结构

- 前端：`src/`
- Tauri（Rust）：`src-tauri/`
- Node sidecar（Puppeteer）：`packages/boss-crawler-worker/`

## 开发环境要求

- Node.js 20
- Rust（stable）+ `cargo`
- Tauri 依赖：
  - macOS：Xcode Command Line Tools
  - Windows：MSVC 工具链、WebView2

## 安装依赖（可选：跳过 Chromium 下载）

如果使用本机 Chrome / Edge，建议跳过 Puppeteer Chromium 下载。

macOS / Linux：

```bash
PUPPETEER_SKIP_DOWNLOAD=1 npm install
```

Windows `cmd`：

```bat
set "PUPPETEER_SKIP_DOWNLOAD=1" && npm install
```

永久生效（对“新打开”的终端生效）：

```bat
setx PUPPETEER_SKIP_DOWNLOAD 1
```

如果你跳过了 Chromium 下载，需要在软件启动后进入“设置”页，手动指定本机 Chrome / Edge 可执行文件路径，例如：

- `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

## 启动（开发）

```bash
npm run tauri:dev
```

- 说明：`src-tauri/tauri.conf.json` 的 `beforeDevCommand` 会先构建 `packages/boss-crawler-worker/dist/`，避免找不到 worker 入口。
- 如果你看到 “Waiting for your frontend dev server...”，检查 `vite.config.ts` 的端口是否为 `1430`，以及 `src-tauri/tauri.conf.json` 的 `devUrl` 是否为 `http://localhost:1430`。

## 打包

### 桌面安装包

```bash
npm run tauri:build
```

- 说明：使用 `src-tauri/tauri.conf.release.json` 进行正式发布构建，会先 stage 内置 Node 与 `boss-crawler-worker/` 运行时资源，再构建前端并生成当前平台的 Tauri 安装包；macOS 会使用 ad-hoc 签名生成本地可验证 `.app`，构建后自动执行 `codesign`、包内 worker runtime 和 DMG 校验。
- macOS 产物示例：`src-tauri/target/release/bundle/dmg/job-sync_0.1.0_aarch64.dmg`
- 产物示例：`src-tauri\target\release\bundle\msi\job-sync_0.1.0_x64_en-US.msi`

只构建并验证 macOS `.app`，用于本地桌面 UI 烟测：

```bash
npm run tauri:build:app
```

- 说明：同样使用 release 配置并校验 `.app` 签名和包内 worker runtime，但跳过 DMG 生成与校验；正式发布仍使用 `npm run tauri:build`。

只验证当前平台 staged worker runtime：

```bash
npm run stage:worker:runtime
npm run verify:worker:runtime
```

- 说明：会验证 `src-tauri/bin/` 下的内置 `node` / `node.exe` 与 `boss-crawler-worker/` 能启动、接收 `STOP`、输出 `FINISHED` 并正常退出。

只验证当前 macOS release bundle：

```bash
npm run verify:release:bundle
```

- 说明：macOS 下会验证 `.app` 签名、`.app/Contents/Resources/bin/` 内 worker runtime 生命周期和所有生成的 DMG；非 macOS 平台会跳过该 macOS-only 检查。

准备隔离的桌面 UI 烟测数据：

```bash
npm run seed:desktop:smoke -- /tmp/job-sync-desktop-smoke
npm run tauri:build:app
src-tauri/target/release/bundle/macos/job-sync.app/Contents/MacOS/job-sync --data-dir /tmp/job-sync-desktop-smoke
```

- 说明：会写入本地 SQLite fixture、Top 20 候选、准备投递岗位、每日岗位情报数据和一个联动简历工作区；通过 `--data-dir` 使用指定数据目录，不会写入真实应用数据。

### Windows 便携版（ZIP）

```bat
npm run tauri:build:portable
```

- 说明：会先执行正式发布构建，然后把 `job-sync.exe`、`node.exe` 与 `boss-crawler-worker/` 运行时目录整理到 `release-portable\job-sync\`，并额外生成 ZIP 便携包。
- 如果你已经先跑过 `npm run tauri:build`，可以改用 `npm run tauri:build:portable:only` 直接复用现有构建产物。
- 产物示例：`release-portable\job-sync-portable-v0.1.0.zip`

### 发布构建

```bash
npm run tauri:build:release
```

- 说明：所有平台都会先生成当前平台的 Tauri 安装包；Windows 会额外生成 portable ZIP，macOS / Linux 会跳过 Windows 便携包步骤。

## 功能特性

- **采集工作台**：支持登录态检测与浏览器登录，提供手动采集和自动采集两种模式；自动采集支持关键词、城市、薪资、经验、学历、行业、公司规模等筛选，以及 `maxPages`、`maxJobs`、`delayMs` 等运行参数。
- **筛选字典同步**：可读取本地缓存或同步 Boss 站点筛选元数据，减少手填枚举值，便于自动采集直接选项化配置。
- **运行日志与进度**：采集页实时展示 sidecar 运行状态、当前关键词、分页进度、职位列表/详情采集数量与运行日志。
- **职位库管理**：采集结果写入本地 SQLite，支持按关键词分组浏览、搜索职位/公司、展开职位详情、复制职位链接、删除单条职位或清空全部数据。
- **数据导出**：支持从职位库导出 CSV / JSON，便于后续分析、归档或二次处理。
- **AI 职位匹配分析**：支持从职位库选择一个或多个职位，导入简历文本或 PDF，结合补充背景说明生成结构化匹配报告，并支持强制忽略缓存重新生成。
- **AI 综合报告**：支持基于多个职位生成综合分析报告，用于归纳岗位共性要求、风险点、建议方向和优先级判断。
- **AI 报告查看器**：提供本地缓存报告列表、搜索筛选、分页切换、综合报告与单职位报告切换，以及原始 JSON 兜底查看能力。
- **简历工作区**：支持导入原始简历文本或 PDF，先做 AI 诊断，再按摘要、项目、经历、技能等模块逐步改写、确认候选稿并组装最终简历；接受候选稿后会显示顶部短暂成功提示，且当已确认模块内容变更导致最终稿过期时会提醒重新生成。
- **PDF 导出**：最终简历支持导出 PDF，便于直接投递或继续人工润色。
- **设置中心**：支持配置浏览器可执行文件路径以及 OpenAI 兼容 API 的 Key、Base URL、模型和模式等参数。


## License

本项目采用 [MIT License](./LICENSE)。
