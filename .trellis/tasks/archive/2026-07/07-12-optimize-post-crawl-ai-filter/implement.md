# 优化采后岗位 AI 精准过滤实施计划

## 1. 用户可见规则模板

- [x] 删除模型设置页全局 prompt/schema 补充字段，以及 Rust 设置模型、worker 环境变量和全部 AI prompt 注入链路；保留打招呼专用补充提示。
- [x] 在 `src/lib/crawl.ts` 更新三段默认可编辑模板，内容与 `design.md` 一致。
- [x] 在 `src/lib/filterProfile.ts` 暴露“应用精准模板”动作，只更新当前表单状态，不自动保存。
- [x] 在 `src/pages/CrawlConfig.vue` 将“AI 软排除”改为“AI 排除条件”，补充三段规则职责和“个人偏好只来自这些文本”的说明，并提供应用模板按钮。
- [x] 同步 `src-tauri/src/db/models/filter_results.rs` 默认模板，保留已有自定义 profile 不被覆盖的升级行为。
- [x] 更新前端合约和 Rust profile 测试，验证默认值一致且自定义文本保留。

## 2. 通用 AI 判断协议

- [x] 重写 `packages/boss-crawler-worker/src/ai/prompt.ts` 的采后 system/user prompt：加入招聘真实性门禁、规则来源边界、固定判定顺序、原文证据格式和 prompt injection 防护。
- [x] 删除“AI 软排除只是偏好”“应倾向 filtered”等会削弱用户规则的表述。
- [x] 明确禁止隐藏的个人偏好，三段 profile 文本原样进入 prompt，并说明正向条件不能抵消排除条件。
- [x] 更新 `packages/boss-crawler-worker/test/ai-contract.test.ts`，断言 prompt 包含通用协议和传入的自定义规则，同时不包含硬编码个人偏好。

## 3. 分桶优先级修复

- [x] 修改 `src-tauri/src/commands/ai/post_collection_judge.rs`：低 confidence 只降级 `recommended`，不覆盖 `filtered` 或用户选择的不确定策略。
- [x] 增加 Rust 单测覆盖低置信度 recommended、filtered、pending 三种输入。
- [x] 保持缺少证据、schema 错误和 AI 调用失败的现有安全降级行为。

## 4. 通用招聘内容分类

- [x] 搜索并抽取 V2EX、LinuxDo、脉脉重复的招聘词分类逻辑到 worker 共享 helper，统一返回招聘证据、非招聘意图和跳过原因。
- [x] 来源 wrapper 继续保留各自事件字段和日志格式，不改变统一入库事件协议。
- [x] 明确非招聘内容 emit `JOB_FILTERED`、写可读日志、不 emit `JOB_NORMALIZED_CAPTURED`。
- [x] 为 V2EX 加入真实“AI 模拟面试产品帖”回归 fixture；为 LinuxDo/脉脉补同类最小测试，防止共享逻辑只在一个来源生效。
- [x] 保留明确招聘帖、岗位汇总/内推帖以及仅含孤立弱词的既有测试语义。

## 5. 端到端回归

- [x] 在 prompt/worker 测试中加入渣打银行样本摘要：明确英语要求必须命中用户排除规则，正向 AI/Java/居家信息不能覆盖。
- [x] 加入 AI 模拟面试样本：来源门禁判非招聘；AI prompt 决策协议也要求历史数据重算为 filtered。
- [x] 加入合格远程 AI/Go/Java 招聘和信息不足样本，验证 recommended 与用户不确定策略边界。
- [x] 如环境允许，使用当前本地两个岗位 ID执行一次重算烟测，确认最终 bucket；操作前记录旧 `reason_json` 以便回滚。

## 6. 验证命令

```bash
npm -w @job-sync/boss-crawler-worker run test
cargo test --manifest-path src-tauri/Cargo.toml post_collection_judge
cargo test --manifest-path src-tauri/Cargo.toml existing_default_filter_profile
npm run test:review-workflow
npm run build
```

必要时补跑：

```bash
npm test
```

## 7. Review 与回滚点

- [x] 使用 `trellis-check` 做 spec、测试、跨层数据流与一致性检查。
- [x] TypeScript/Vue/Rust 通用改动使用 `code-review-and-quality` 做合并前质量审查。
- [x] 人工检查代码中的个人偏好词：英语、远程、学历、Go/Java/Python 只能出现在可见模板或测试样本，不得出现在隐藏 AI 协议。
- [x] 回滚时优先按三个独立点撤回：可见模板/UI、AI prompt/分桶、来源 classifier；数据库 schema 无需回滚。

## 8. 完成证据

- `npm test`：通过，包含 review workflow、Boss/Zhilian canary、数据库 canary 和 worker 91 项测试。
- `cargo test --manifest-path src-tauri/Cargo.toml`：169 项通过，1 项真实网络 canary 按设计忽略。
- `npm run build`、`cargo fmt -- --check`、`git diff --check`：通过。
- 浏览器烟测：桌面与 390px 移动端布局正常；精准模板按钮可恢复三个文本框；控制台无错误。
- 真实模型只读烟测：
  - `v2ex:1225580`（渣打银行）=> `filtered`，置信度 0.99，证据引用“英文水平要求高，全英面试”。
  - `v2ex:1225603`（AI 模拟面试产品）=> `filtered`，置信度 0.99，判定为产品/项目介绍而非招聘。
- 本地数据库未被烟测写入或覆盖；已有自定义 profile 保持原样，需在配置页主动点击“应用精准模板”后保存并重算。
