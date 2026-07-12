# 升级版本并打包发布设计

## 1. 版本事实源

桌面端发布版本统一为 `0.1.8`：

- `package.json`：Tauri 配置与前端展示使用的主版本事实源。
- `package-lock.json`：根 workspace 版本同步。
- `src-tauri/Cargo.toml`：Rust `job-sync` crate 版本。
- `src-tauri/Cargo.lock`：仅更新 `name = "job-sync"` 对应包记录。

`src-tauri/tauri.conf.json` 和 `src-tauri/tauri.conf.release.json` 继续引用 `../package.json`，不增加第二个硬编码版本。worker workspace 保持 `0.1.0`，因为它不是独立对外发布版本。

## 2. 构建链路

正式构建使用：

```text
npm run tauri:build
  -> scripts/tauri-build.mjs
  -> 清除 release/bin 中可能残留的旧 runtime
  -> tauri build --config src-tauri/tauri.conf.release.json
  -> stage:worker:runtime
  -> Vue/TypeScript production build
  -> Rust release build
  -> .app + .dmg
  -> verify-release-bundle.mjs
```

不使用此前为 UI 烟测生成的 `target/debug/bundle`。正式产物只能来自 `src-tauri/target/release/bundle/`。

## 3. 质量门

打包前：

- `npm test`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `git diff --check`

打包后：

- `scripts/verify-release-bundle.mjs` 自动验证 runtime、codesign 和 DMG。
- 使用 `defaults read .../Info CFBundleShortVersionString` 验证 `.app` 版本。
- 使用 `hdiutil imageinfo` / `hdiutil verify` 验证 DMG。
- 记录 `.dmg` 与 `.app` 主可执行文件的大小和 SHA-256。

## 4. 产物与命名

预期产物：

- `src-tauri/target/release/bundle/macos/JobPilot.app`
- `src-tauri/target/release/bundle/dmg/JobPilot_0.1.8_aarch64.dmg`

构建前删除或隔离旧 `0.1.7` DMG，避免交付时混淆；不删除源码和用户数据。

## 5. 签名边界

release 配置使用 `signingIdentity: "-"`，属于本机 ad-hoc 签名：

- 必须通过 `codesign --verify --deep --strict`。
- 不承诺 Gatekeeper 公网分发体验。
- 不执行 Developer ID 签名、公证或 App Store 流程。

## 6. 回滚

- 版本文件可回退至 `0.1.7` 并重新生成 lockfile。
- 旧 `JobPilot_0.1.7_aarch64.dmg` 在新产物验证完成前不作为发布结果覆盖或删除。
- 构建失败不修改用户数据库、应用配置或 `/Applications` 中的已安装版本。
