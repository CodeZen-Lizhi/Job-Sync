# 同步所有有效分支到 main

## Goal

将仓库中所有尚有有效代码价值的开发分支成果安全同步到 `main`，验证最终主分支可构建、可测试，并推送到 `origin/main`。

## Confirmed Facts

- 拉取远端后，`main` 与 `origin/main` 均停留在 `73def58`。
- `remote-job-intelligence` 与 `origin/remote-job-intelligence` 均位于 `d4399f4`，比 main 多 175 个提交，且 `main` 是其祖先，可执行 fast-forward。
- 远端仅有 `main`、`remote-job-intelligence`、`codex/boss-low-risk-mode`；后两个分支均已被 `remote-job-intelligence` 包含。
- 本地 `codex/boss-low-risk-mode` 和 `codex/merge-boss-low-risk-latest` 已被最新开发线包含。
- 本地 `codex/merge-boss-low-risk` 仅多一个旧合并提交 `cef2e0a`，它是对同一 `deeec74` Boss 低风险分支的早期冲突解决；后续合并提交 `5110d58` 已进入 `remote-job-intelligence`，旧合并没有独立普通提交需要再次移植。
- 当前工作区除本任务 Trellis 文件外无业务脏改。

## Requirements

- 以 `remote-job-intelligence` 作为当前完整开发线，不盲目重复合并已经包含的历史分支。
- `main` 必须通过 `--ff-only` 快进，不制造无意义合并提交，不重写历史。
- 合并前记录旧 main 提交 `73def58`，作为明确回滚点。
- 合并后验证所有本地和远端有效分支的提交均为 main 的祖先；旧的替代冲突合并提交可保留为历史分支，但不应覆盖后续已验证的冲突解决结果。
- 合并后必须运行前端/worker 全量测试、Rust 全量测试、构建和格式检查。
- 验证通过后推送 `main` 到 `origin/main`，不得使用 force push。
- 不删除本地或远端分支。

## Acceptance Criteria

- [x] `main` 从 `73def58` fast-forward 到最新完整开发线。
- [x] `main` 与 `remote-job-intelligence` 指向相同业务提交或包含其全部提交。
- [x] 所有远端非 main 分支都是最终 main 的祖先。
- [x] 旧本地替代合并分支经过审计并记录为已被后续合并结果取代，不重复合并。
- [x] `npm test`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml`、`cargo fmt -- --check` 通过。
- [ ] `git push origin main` 成功，且本地 main 与 `origin/main` 一致。
- [ ] 工作区最终干净。

## Out of Scope

- 不删除、重命名或强制更新历史分支。
- 不 squash 或改写现有 175 个提交历史。
- 不发布版本、创建 tag 或创建 GitHub PR。
