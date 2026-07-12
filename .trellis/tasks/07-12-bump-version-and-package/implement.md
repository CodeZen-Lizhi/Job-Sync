# 升级版本并打包发布实施计划

## 1. 版本升级

- [x] 将根 npm workspace 版本从 `0.1.7` 更新到 `0.1.8`，同步 `package-lock.json`。
- [x] 将 `src-tauri/Cargo.toml` 的 `job-sync` 版本更新到 `0.1.8`，通过 Cargo 更新对应 lock 记录。
- [x] 搜索桌面端残留 `0.1.7`，确认仅历史文档、旧产物名或依赖自身版本可保留。
- [x] 保持 worker package `0.1.0` 不变。

## 2. 打包前验证

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

- [x] 所有质量门通过后才开始 release 构建。

## 3. 正式打包

- [x] 确认没有旧 release 构建进程占用产物目录。
- [x] 执行 `npm run tauri:build`。
- [x] 确认生成 `JobPilot.app` 和 `JobPilot_0.1.8_aarch64.dmg`。

## 4. 产物验证

- [x] `verify-release-bundle.mjs` 完成内置 Node/worker、codesign 和 DMG 校验。
- [x] `.app` 的 `CFBundleShortVersionString` 与 `CFBundleVersion` 为 `0.1.8`。
- [x] DMG 架构和命名为 arm64 / `0.1.8`。
- [x] 记录 DMG 的绝对路径、大小、SHA-256。
- [x] 最小启动烟测：从 release `.app` 启动到主界面，不安装、不覆盖用户正式应用。

启动烟测首次发现空数据目录会在迁移前更新 `collection_run` 而崩溃；已让
`init_db_for_app_start` 复用完整迁移入口，并新增空目录首次启动回归测试后重新打包。

最终产物证据：

- DMG：`/Users/zhenglizhi/otherProjects/Job-Sync/src-tauri/target/release/bundle/dmg/JobPilot_0.1.8_aarch64.dmg`
- DMG 大小：`37,885,863` bytes
- DMG SHA-256：`219243c3a311a8430a8a3ebf4da85d6d6f4c7a4a7b266c05b0de74716789a6a6`
- App 主程序大小：`20,689,632` bytes
- App 主程序 SHA-256：`51d1934a19d204af1cd7d2382f850b03dfebf0e8dd63ee1d3d93f9c88ae60d79`
- 空目录烟测：主窗口显示 `JobPilot v0.1.8`，`collection_run` 表已创建。

## 5. Review 与交付

- [x] 使用 `trellis-check` 完成版本一致性、测试和构建产物检查。
- [x] 使用 `code-review-and-quality` 审查版本 diff 与发布风险。
- [ ] 提交版本升级和任务记录；不自动 push。
- [ ] 归档任务并记录 session。

## 6. 回滚点

- 版本回滚：恢复四个版本事实源到 `0.1.7`。
- 构建回滚：删除本轮 `0.1.8` release 产物即可，不影响源码之外的状态。
- 用户数据：打包和烟测不得绑定真实用户数据目录，不执行数据库迁移或覆盖安装。
