# 升级 0.1.7 并打包

## Goal

将 Job Sync 桌面端版本从 `0.1.6` 升级为 `0.1.7`，完成当前 macOS 平台的正式 Tauri 打包，并提供可验证的 `.app` 与 DMG 产物。

## Confirmed Facts

- 根 [package.json](/Users/zhenglizhi/otherProjects/Job-Sync/package.json) 与 [package-lock.json](/Users/zhenglizhi/otherProjects/Job-Sync/package-lock.json) 当前版本为 `0.1.6`。
- [Cargo.toml](/Users/zhenglizhi/otherProjects/Job-Sync/src-tauri/Cargo.toml) 和 `Cargo.lock` 中 `job-sync` 包当前版本为 `0.1.6`。
- `src-tauri/tauri.conf.json` 与 `src-tauri/tauri.conf.release.json` 均通过 `../package.json` 读取桌面应用版本。
- worker 子包 `@job-sync/boss-crawler-worker` 有独立版本 `0.1.0`，不属于桌面应用升版范围。
- 正式构建入口 `npm run tauri:build` 使用 release 配置，自动 stage worker runtime，并验证 macOS `.app` 签名、包内 runtime 生命周期和 DMG。

## Requirements

- 将桌面应用所有权威版本源一致更新为 `0.1.7`，不修改依赖版本或 worker 子包版本。
- 升版后先执行前端构建、契约测试和 Rust 测试，再执行正式 Tauri 打包。
- 打包必须使用项目既有 `npm run tauri:build`，不绕过 release 配置或发布校验脚本。
- 构建产物必须来自当前代码和 `0.1.7` 版本元数据。
- 不修改业务逻辑、数据库 schema、UI 或打包脚本。

## Acceptance Criteria

- [x] `package.json`、根 lockfile、`Cargo.toml` 和 `Cargo.lock` 中的桌面应用版本均为 `0.1.7`。
- [x] `npm run test:review-workflow`、`npm run build` 与 `cargo test --manifest-path src-tauri/Cargo.toml` 通过。
- [x] `npm run tauri:build` 成功退出。
- [x] 生成 `src-tauri/target/release/bundle/macos/JobPilot.app`，Info.plist 中 short version/build version 均为 `0.1.7`，ad-hoc 签名验证通过。
- [x] 生成 `src-tauri/target/release/bundle/dmg/JobPilot_0.1.7_aarch64.dmg`，包内 worker runtime 与 `hdiutil verify` 通过；SHA-256 为 `2573bd2832f9ad260691657fba1577e42ef87188cf62144f004cd86c4cda3397`。
- [x] `git diff --check` 与修改后代码 Review 未发现当前范围内明显问题。

## Out Of Scope

- 不创建 Git tag、GitHub Release 或上传安装包。
- 不修改 changelog、发布说明或应用功能。
- 不构建 Windows MSI/portable ZIP。
- 不删除历史构建产物，除非它们阻碍当前校验。
