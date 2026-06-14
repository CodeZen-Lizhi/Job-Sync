# Mac DMG 打包修复

## Goal

修复 `docs/job-sync-requirements-coverage.md` 中 Phase 0 的 Mac DMG 打包缺口：让正式发布命令 `npm run tauri:build` 在本机重新通过，并恢复 `.app` 签名、包内 worker runtime 与 DMG `hdiutil verify` 的强证据。

## Requirements

- 必须先复现或读取当前 `npm run tauri:build` 的真实失败输出，再根据证据修复。
- 修复范围应聚焦 macOS 发布打包链路：Tauri release 配置、打包脚本、release 校验脚本或文档证据。
- 不降低 `.app` 签名、包内 worker runtime 校验、DMG 存在性或 DMG `hdiutil verify` 要求。
- 不引入真实 Boss 登录、投递、开聊或外部模型依赖。
- 修复后更新需求覆盖审计和 Phase 0 基线，保留真实 Boss 登录/外部服务连通性等未覆盖项。

## Acceptance Criteria

- [x] `npm run tauri:build` 在 macOS 本机通过，生成 `.app` 和至少一个 `.dmg`。2026-06-14 复跑正式构建未复现旧 `bundle_dmg.sh` 失败，生成 `src-tauri/target/release/bundle/macos/job-sync.app` 和 `src-tauri/target/release/bundle/dmg/job-sync_0.1.0_aarch64.dmg`。
- [x] 构建后的 `.app` 通过 `codesign --verify --deep --strict --verbose=2`。
- [x] 包内 `Contents/Resources/bin/` worker runtime 通过启动、`STOP received`、`FINISHED` 和 0 退出码验证。
- [x] 生成的 `.dmg` 通过 `hdiutil verify`。
- [x] `docs/job-sync-phase0-baseline.md` 和 `docs/job-sync-requirements-coverage.md` 记录新的验证结果，并移除 DMG 失败待补项。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
