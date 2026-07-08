# Boss 低风控采集模式

## Goal

把 Boss 自动采集从“遇到风控后等待人工验证并重试”升级为“默认低频、采前预检、遇风控即停并冷却”的高风控平台策略，降低账号被频繁验证/封控的概率，同时保留现有统一入库、采后筛选和 AI 判断链路。

本任务不做验证码破解、指纹伪装、代理池、自动投递、自动沟通或绕过平台风控。

## Confirmed Facts

- Boss 目前使用独立持久浏览器 profile（`boss-browser-profile`），采集时优先复用登录态。
- worker 已能识别 Boss 登录/安全验证 HTML、401/403、风险 code，并通过 `LOGIN_STATUS` 通知前端。
- worker 目前遇到 Boss 风控/登录状态会等待人工验证后重试，适合恢复，但不够保守，容易在短时间内继续撞风控。
- Boss 详情抓取已默认关闭：前端传 `limits.bossDetailFetchLimit = 0`，列表级岗位可先入库。
- `limits.maxJobs` 由 sidecar 按实际新增入库岗位控制，重复/更新不应消耗额度。
- 当前通用运行延迟 `delayMs` 默认用于多个平台，但 Boss 风控需要更保守的平台级默认和提示。
- 公开项目/讨论显示 Boss 对自动化浏览器、CDP、短时间批量搜索和高频操作较敏感；更可持续的方向是降低频率、明确停止、回到官方页面人工处理，而不是对抗式绕过。

## Requirements

- Boss 配置页提供“低风控模式”开关，默认开启。
- 低风控模式开启时，Boss 采集默认使用更保守的参数：
  - 页数上限不超过 2 页，推荐默认 1 页。
  - 入库上限不超过 50，推荐默认 30。
  - 请求/翻页延迟使用较大的随机范围，推荐基准 8-20 秒。
  - 详情抓取保持关闭，除非后续单独显式打开。
- Boss 自动采集启动前先做轻量健康检查：
  - 浏览器 profile 是否可用。
  - 当前 Boss 页面是否处于登录/验证码/安全验证页。
  - 搜索页是否能加载到可采集的正常页面状态。
- 健康检查失败时，本轮 Boss 不开始采集，给出清晰日志/错误，引导用户到设置页或官方页面人工处理。
- 采集中一旦检测到 Boss 403、风险 code、security-check、验证码页或登录失效：
  - 立即停止当前 Boss 批次。
  - 不再自动连续重试。
  - 写入冷却状态，默认冷却 15-30 分钟。
  - 前端日志提示冷却原因和下次可尝试时间。
- 冷却期间再次启动 Boss 自动采集时，应直接阻止或跳过 Boss，并输出冷却提示；其他已选择平台可继续按现有顺序运行。
- 多关键词/多城市 Boss 采集应按小批次顺序执行，低风控模式下每个 keyword/city/page 之间使用保守随机延迟。
- 已入库重复岗位不触发详情抓取、不触发采后 AI 重审和 Telegram 推送；沿用本轮 inserted job id 路径。
- 现有 Boss 风控人工验证窗口保留：用户仍可在打开的官方页面完成验证，但程序不应在同一批次验证后立刻继续高速采集。
- UI 文案必须明确这是“降低触发概率”，不能承诺不会风控。
- 更新 `.trellis/spec/boss-crawler-worker/frontend/collection-source-contracts.md`，记录 Boss 低风控模式、健康检查和冷却契约。

## Acceptance Criteria

- [ ] 默认新配置下 Boss 低风控模式开启，Boss 页数/岗位数/延迟使用保守默认值。
- [ ] 用户可在采集配置页看到并调整 Boss 低风控模式；文案说明慢但更稳。
- [ ] `crawl_auto_start` / worker 收到 Boss 任务时能识别低风控限制，不影响智联、V2EX、LinuxDo。
- [ ] Boss 健康检查命中登录/验证码/安全验证时，本轮 Boss 采集不继续请求列表接口，并输出明确日志。
- [ ] Boss 风控事件会进入 cooldown；cooldown 期间再次启动 Boss 会被跳过或阻止，并说明剩余等待时间。
- [ ] 低风控模式下 Boss 不自动开启详情抓取。
- [ ] 多源采集时 Boss 因 cooldown/健康检查失败被跳过，不阻止后续非 Boss 平台运行。
- [ ] worker 单测覆盖低风控默认、风控即停、cooldown 检查、非 Boss 不受影响。
- [ ] review workflow / contract 测试覆盖前端 payload 和契约文档。
- [ ] `npm -w @job-sync/boss-crawler-worker run test`、`npm run test:review-workflow`、`npm run build` 通过；如改 Rust 命令/DB，再跑 `cargo test --manifest-path src-tauri/Cargo.toml`。

## Notes

- 公开参考：
  - `get_jobs` GitHub discussion 提到 Boss 会检测程序驱动浏览器/CDP。
  - `Agent-Reach` issue 反馈 Playwright、Cookie 注入和代理也可能被 Boss 风控。
  - `boss-agent-cli` 风险文档采用低风险辅助模式：不批量触达，命中风控停止自动化。
- 本任务目标是稳定性和账号保护，不是提升采集速度。
