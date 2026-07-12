# 同步所有有效分支到 main 设计

## Strategy

采用祖先关系驱动的合并，而不是逐分支执行 merge：

1. `git fetch --all --tags` 获取最新远端引用。
2. 使用 `git merge-base --is-ancestor`、`git branch --no-merged` 和 unique commit 审计确认完整开发线。
3. 将 `main` 通过 `git merge --ff-only remote-job-intelligence` 快进到最新开发线。
4. 验证远端分支均已被新 main 包含。
5. 运行完整质量门后普通 push `main`。

## Why Not Merge Every Branch

- `codex/boss-low-risk-mode` 已经是最新开发线祖先，重复 merge 没有新内容。
- `codex/merge-boss-low-risk-latest` 已包含 Boss 分支并进入最新开发线。
- `codex/merge-boss-low-risk` 的唯一差异是旧的替代 merge commit；再次合并会重新引入旧冲突解决，而不是补充缺失业务提交。
- 因此“同步所有代码”的正确含义是确保每个有效业务提交可从 main 到达，而不是要求每个历史 merge commit 都成为 main 的祖先。

## Data Flow

```text
origin/main (73def58)
        └── fast-forward 175 commits
remote-job-intelligence (d4399f4)
        └── verified main -> push origin/main
```

## Safety

- fast-forward 前必须保持工作区无业务脏改。
- 使用 `--ff-only`，如果祖先关系变化则立即失败而非自动产生冲突合并。
- 不使用 force push。
- 回滚点为 `73def58`；若推送前验证失败，可让本地 main 回到旧提交。推送后如需回滚，应通过新的 revert/恢复提交，不重写共享 main 历史。
