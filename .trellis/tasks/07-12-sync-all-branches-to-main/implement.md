# 同步所有有效分支到 main 实施计划

- [x] 激活任务并确认当前工作区、分支与远端引用。
- [x] 切换到 `main`，执行 `git merge --ff-only remote-job-intelligence`。
- [x] 验证 `remote-job-intelligence`、所有远端开发分支均为 main 祖先。
- [x] 审计旧本地替代 merge commit，不重复引入旧冲突解决。
- [x] 运行 `npm test`。
- [x] 运行 `npm run build`。
- [x] 运行 `cargo test --manifest-path src-tauri/Cargo.toml`。
- [x] 运行 `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 和 `git diff --check`。
- [x] 使用 `trellis-check` / `code-review-and-quality` 检查合并结果和验证证据。
- [x] 提交本任务 Trellis 记录。
- [ ] 推送 `main` 到 `origin/main`，验证本地/远端 HEAD 一致。
- [ ] 归档任务并记录 session。

## 验证证据

- 合并：`main` 使用 `--ff-only` 从 `73def58` 快进到 `d4399f4`，未创建新 merge commit。
- 分支包含：`origin/remote-job-intelligence`、`origin/codex/boss-low-risk-mode`、`remote-job-intelligence`、`codex/boss-low-risk-mode`、`codex/merge-boss-low-risk-latest` 均为 `main` 祖先。
- 历史替代分支：`main..codex/merge-boss-low-risk` 仅有 `cef2e0a`；其业务父提交 `deeec74` 已进入 main，后续合并结果 `5110d58` 也已进入 main。
- 测试：`npm test` 通过，其中 review contract 61 项、canary 24 项、worker 91 项全部通过。
- 构建：`npm run build` 通过，Vue 类型检查和 Vite 生产构建成功。
- Rust：`cargo test --manifest-path src-tauri/Cargo.toml` 通过，169 项通过、1 项需真实网络环境的 ignored canary；`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 通过。
- 差异检查：当前工作树 `git diff --check` 通过。旧 main 到新 main 的历史范围存在早期文件行尾/尾空格提示，但不是本次 fast-forward 新产生的未提交改动，因此未重写历史修正。
- Spec 判断：本任务只同步既有提交，没有新增或改变代码契约，不需要更新 `.trellis/spec/`。
- Review：按 `trellis-check` 与 `code-review-and-quality` 检查正确性、架构、安全、性能和验证证据，未发现当前同步范围内的阻断问题。
