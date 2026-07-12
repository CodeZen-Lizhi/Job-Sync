# 升级版本并打包发布

## Goal

将当前 JobPilot 桌面端从 `0.1.7` 升级到下一个补丁版本，完成 macOS Apple Silicon 正式构建、DMG 打包和产物完整性验证，交付可安装的发布包。

## Confirmed Facts

- 当前应用版本为 `0.1.7`，版本事实源包括根 `package.json`、根 `package-lock.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 中的 `job-sync` 包记录。
- `src-tauri/tauri.conf.json` 与 `src-tauri/tauri.conf.release.json` 均通过 `"version": "../package.json"` 读取根版本号，不应单独写死版本。
- 当前主机为 macOS arm64，既有正式产物为 `JobPilot_0.1.7_aarch64.dmg`。
- `npm run tauri:build` 使用 release 配置构建全部平台适用的 macOS bundle，并在构建后验证 `.app`、内置 Node/worker、codesign 和 DMG。
- `npm run tauri:build:release` 在 macOS 上调用同一正式构建，并跳过仅适用于 Windows 的 portable ZIP。
- 当前工作区干净，`main` 与 `origin/main` 一致。

## Requirements

- 默认按补丁版本从 `0.1.7` 升级到 `0.1.8`，不改 worker 独立包版本 `0.1.0`。
- 所有桌面端版本来源必须保持一致，Cargo lock 中 `job-sync` 包版本同步更新。
- 打包前运行前端/worker 测试、Rust 测试、生产构建和格式检查。
- 使用正式 release 配置生成 arm64 `.app` 与 `.dmg`，不得把调试构建当作发布包。
- 产物必须通过现有 release bundle 校验：内置 Node/worker 可用、codesign 通过、DMG 可验证。
- 不创建 tag、不发布 GitHub Release、不上传或分发安装包，除非用户后续明确要求。

## Acceptance Criteria

- [x] 根 npm 版本和 Rust 应用版本均为 `0.1.8`，lockfile 同步且不存在遗漏的桌面端 `0.1.7`。
- [x] 全量测试、构建、格式检查通过。
- [x] 生成 `JobPilot_0.1.8_aarch64.dmg` 和 `JobPilot.app`。
- [x] `.app` 中显示版本 `0.1.8`，内置 worker runtime 校验通过。
- [x] `codesign --verify` 与 `hdiutil verify` 通过。
- [x] 记录产物绝对路径、文件大小和 SHA-256。

## Out of Scope

- 不构建 Windows portable ZIP。
- 不做 Apple Developer ID 签名、公证或 App Store 发布。
- 不自动安装或覆盖 `/Applications/JobPilot.app`。
- 不推送代码，除非用户后续明确要求。
