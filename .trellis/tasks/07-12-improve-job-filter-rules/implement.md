# 继续优化岗位过滤规则实施计划

## 1. 代码与模板

- [x] 更新 `src/lib/crawl.ts` 三段默认精准文本，加入明确目标范围、新排除类别、条件式远程和同一岗位证据要求。
- [x] 同步 `src-tauri/src/db/models/filter_results.rs` 默认文本，保证前端和 Rust 默认值一致。
- [x] 更新默认 profile 测试和前端合约测试，避免两端模板漂移。

## 2. 通用判断协议

- [x] 在 `packages/boss-crawler-worker/src/ai/prompt.ts` 增加同一具体岗位证据闭包、推荐证据完整性和多岗位禁止拼接规则。
- [x] 保证隐藏 system/user 协议不出现英语、远程、学历、产品、算法、Web3 等个人偏好词。
- [x] 在 `jobPostingClassifier.ts` 增加自我介绍/寻项目合作等通用非招聘意图。
- [x] 增加 worker 回归测试，覆盖自我介绍寻合作、多岗位证据绑定和自定义三段文本原样拼接。

## 3. 无通知维护重算

- [x] 为 Rust Tauri 命令和 TypeScript invoke 增加 `notifyTelegram` / `notify_telegram` 可选参数，默认关闭。
- [x] 手动保存、切换 profile、职位页重算明确关闭通知；正常采集完成路径明确开启通知。
- [x] 增加 Rust/前端合约测试，证明维护重算不发送 Telegram，采集结束通知行为不回退。

## 4. 本机 profile 替换

- [x] 确认 App 未在执行采集/写库任务。
- [x] 使用 SQLite 在线备份本机 `app.db`，记录备份绝对路径。
- [x] 在事务内只替换默认 profile 三段文本和更新时间；验证不确定策略仍为 `filtered`，其他字段的 JSON 内容保持一致。
- [x] 重新读取数据库，确认保存文本与代码精准模板完全一致。

## 5. 历史岗位立即重算

- [x] 使用当前源码启动绑定真实数据目录的 Tauri 应用。
- [ ] 使用语义证据修正版执行第二次全部岗位普通规则重算和无 Telegram 的 AI 批量重算。
- [ ] 记录第二次全库重算的 `updated`、`ai_judged`、`hard_skipped`、`failed` 统计；失败项重试一次并保留错误证据。
- [x] 验证首轮维护重算没有发送 Telegram。
- [x] 真实模型定向烟测确认合格 Go 远程岗恢复推荐，算法、条件式远程、个人寻合作仍被过滤。

## 6. 质量门

```bash
npm -w @job-sync/boss-crawler-worker run test
cargo test --manifest-path src-tauri/Cargo.toml post_collection_judge
cargo test --manifest-path src-tauri/Cargo.toml existing_default_filter_profile
npm run test:review-workflow
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check
```

- [ ] 使用 `trellis-check` 做 spec、跨层数据流、测试和一致性检查。
- [ ] 使用 `code-review-and-quality` 做正确性、可读性、架构、安全和性能审查。
- [x] 更新 `.trellis/spec/boss-crawler-worker/frontend/ai-prompt-contracts.md`，记录同一岗位证据和通知参数契约。

## 8. 当前数据证据

- 数据库备份：`/Users/zhenglizhi/Library/Application Support/com.administrator.jobpilot/app.db.pre-precise-filter-20260712-114741.bak`，`PRAGMA integrity_check = ok`。
- profile 替换后，移除三个 AI 文本的其余 JSON 哈希前后一致：`9f85faedf77c92cb089620f268660f2eb6742dd33a615075843c9a7b12cfd4f4`。
- 首轮全库重算：普通规则 452、AI 判断 452、失败 0、Telegram 未发送；该轮因规则要求逐字出现“全职/长期/无条件”导致 452 条全过滤，已通过语义证据修正，不作为最终分桶结果。
- 修正版定向模型烟测：1 条合格 Go 远程岗 `recommended`，3 条明确排除样本 `filtered`；另 1 条远程适用范围不清的实习岗位按当前 `filtered` 策略过滤。

## 7. 回滚点

- 代码：按模板、prompt/classifier、通知参数三个逻辑单元回滚。
- 数据：优先从 `app.db.pre-precise-filter-*.bak` 恢复；不改 schema。
- 外部副作用：本次维护重算必须关闭 Telegram，不产生需要撤回的外部消息。
