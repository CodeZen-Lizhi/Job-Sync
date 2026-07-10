# 实施计划

1. 使用 `trellis-before-dev` 读取发布相关规范和任务文档。
2. 更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 的桌面应用版本为 `0.1.7`。
3. 搜索残留的桌面端 `0.1.6`，确认没有遗漏版本源或误改依赖/worker 版本。
4. 运行 `npm run test:review-workflow`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`。
5. 执行 `npm run tauri:build`，等待正式构建和自动 bundle 校验全部完成。
6. 核对 `JobPilot.app`、`JobPilot_0.1.7_aarch64.dmg`、签名、runtime 和 DMG 校验结果。
7. 使用 `trellis-check` 和 `code-review-and-quality` 审查版本一致性与验证证据，更新验收项。

## Risk Points

- npm 与 Cargo 版本不一致会导致二进制元数据和安装包名称漂移。
- DMG 构建依赖 macOS 本机工具链，可能受签名、磁盘或残留挂载影响。
- 正式构建可能耗时较长，必须等待命令完全结束，不能只看到 `.app` 就提前报告成功。
