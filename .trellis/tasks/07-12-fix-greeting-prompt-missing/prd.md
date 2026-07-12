# 修复打招呼文案配置消失

## Goal

修复从仓库目录启动正式版 JobPilot 时误读项目开发数据目录、导致设置页看不到电脑正式应用中已保存打招呼文案的问题，并恢复当前开发数据中的该字段。

## Confirmed Facts

- 正式应用数据目录 `~/Library/Application Support/com.administrator.jobpilot/settings.json` 中保存的 `ai_greeting_prompt_extra` 完整存在，长度为 236 个字符。
- 项目开发数据 `data/settings.json` 不包含该字段，因此读取后界面显示空白。
- `resolve_data_dir` 当前只要工作目录位于仓库内，就会优先返回项目 `data/`，没有区分 debug 与 release 构建。
- 设置页读取异常会被空 `catch` 静默吞掉，容易把读取失败误认为配置被清空。

## Requirements

- release 构建在没有显式 `JOB_SYNC_DATA_DIR` / `--data-dir` 时必须使用系统应用数据目录，不能因当前工作目录位于仓库而切换到开发数据。
- debug 构建继续支持仓库 `data/`，保留现有本地开发体验。
- 显式环境变量和命令行数据目录的优先级保持不变。
- 设置页读取失败必须显示错误提示，不能静默展示空表单。
- 将正式应用中现存的打招呼补充文案同步恢复到当前项目开发数据，仅补该字段，不覆盖其他本地设置。

## Acceptance Criteria

- [x] 数据目录选择逻辑有回归测试，证明 release 不使用仓库 `data/`、debug 仍可使用。
- [x] 设置页契约测试覆盖读取失败可见、已保存文案正常回填。
- [x] 当前项目 `data/settings.json` 中恢复 `ai_greeting_prompt_extra`。
- [x] Rust 测试、前端契约测试、类型检查与生产构建通过。
- [x] 用 release 应用从仓库目录启动时，设置页显示正式应用已保存文案。

## Out of Scope

- 不修改打招呼提示词正文或 AI 生成规则。
- 不迁移、合并其他开发数据与正式用户数据。
- 不修改 API Key、Telegram 或浏览器登录数据。
