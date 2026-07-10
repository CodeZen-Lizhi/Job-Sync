# 技术设计

## Version Contract

- npm 权威版本：根 `package.json`，同步根 `package-lock.json` 顶层和 `packages[""]`。
- Rust 权威版本：`src-tauri/Cargo.toml`，同步 `src-tauri/Cargo.lock` 中 `name = "job-sync"` 的包版本。
- Tauri release 配置继续引用根 `package.json`，不复制新的硬编码版本。

## Build Flow

```text
版本一致性检查
  -> 前端/契约/Rust 验证
  -> npm run tauri:build
  -> stage worker runtime
  -> release app + DMG
  -> codesign/runtime/hdiutil verification
  -> 核对 0.1.7 产物路径和时间
```

## Compatibility

- 仅补丁版本升级，不改变数据格式、IPC 或依赖。
- 现有用户数据库由应用当前迁移逻辑正常升级。
- worker runtime 内容随 release 构建重新 stage，但 worker 包版本不变。

## Rollback

- 版本文件可整体回退到 `0.1.6`；构建产物属于生成文件，不进入源码提交。
- 若正式 DMG 构建失败，保留完整命令输出，先定位失败环节，不以 app-only 构建冒充正式交付。
