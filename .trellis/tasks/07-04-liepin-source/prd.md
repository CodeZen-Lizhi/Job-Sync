# 接入猎聘采集渠道

## Goal

把猎聘从“手动来源预留”升级为可自动采集的平台来源，用户体验和数据链路与已接入的智联、BOSS 保持一致：可在设置页管理平台连接，可在采集配置中选择猎聘并配置关键词/城市/页数/岗位数，采集结果写入统一职位库，并参与采后筛选与 AI 判断。

## Confirmed Facts

- `src/lib/crawl.ts` 当前已包含 `liepin` 平台枚举和展示项，但 `MANUAL_IMPORT_SOURCE_PLATFORMS` 仍包含 `liepin`，`COLLECTABLE_SOURCE_PLATFORMS` 不包含 `liepin`。
- `src-tauri/src/db/models/source_adapter.rs` 当前将 `liepin` 注册为 `manual_import`，智联注册为 `zhilian`，BOSS 注册为 `boss`，V2EX/LinuxDo 注册为 `feed`。
- 自动采集入口为前端 `crawl_auto_start`，Tauri 创建 `collection_run` 后把 `CrawlAutoStartPayload` 发给 worker。
- worker `runAutoMode` 当前按 `source_platform` 分流到 `runZhilianMode`、`runLinuxDoMode`、`runV2exFeedMode`，其余路径默认为 BOSS。
- 智联使用独立持久浏览器 profile、独立 cookie/localStorage 文件、`JOB_NORMALIZED_CAPTURED` 事件和统一 job upsert 路径；猎聘应复用这条非 BOSS 归一化路径。
- 设置页当前仅把 `boss`、`linuxdo`、`zhilian` 视为可登录/验证平台；猎聘还显示为自动采集预留。
- 项目规范 `.trellis/spec/boss-crawler-worker/frontend/collection-source-contracts.md` 要求可自动采集来源必须明确 adapter kind、payload、session/profile、错误状态、`JOB_NORMALIZED_CAPTURED` 和默认筛选来源范围。

## Requirements

- 猎聘在来源注册表和前端来源选项中成为自动采集来源，不再显示为手动导入预留。
- 猎聘在采集配置页拥有独立配置区，至少支持关键词、城市/地区、页数上限、岗位上限、延迟、原始参数透传；字段语义尽量对齐智联。
- 猎聘自动采集通过独立 `liepin-browser-profile`、`liepin-cookies.json`、`liepin-local-storage.json` 管理登录/验证状态，不复用 BOSS/智联/LinuxDo 的会话。
- 猎聘采集缺少或失效 profile 时给出明确错误，引导用户到设置页重新连接；采集中不无限等待人工验证。
- worker 能从猎聘搜索结果解析稳定岗位 id、标题、公司、城市、薪资、经验、学历、详情 URL 和详情正文；详情被登录/验证拦截时允许写入列表级证据和缺失详情标记。
- worker 通过 `JOB_NORMALIZED_CAPTURED` 写入统一职位库，字段满足：
  - `source_platform = "liepin"`
  - `encrypt_job_id = "liepin:<stableId>"`
  - `dedup_key = <stableId>`
  - `source_url` 指向猎聘岗位详情页
  - `jd_text` 包含详情正文或可解释的列表级 fallback
- `limits.maxPages` 表示每组关键词/城市分页上限；`limits.maxJobs` 仍由 sidecar 按实际新增 job 数控制，不因重复/更新消耗额度。
- 猎聘采集完成后沿用现有采后筛选和 AI 判断，只处理本轮新插入岗位。
- 默认筛选来源包含猎聘，避免刚采集的猎聘岗位被默认 source gate 隐藏。
- 新增或更新 worker、Rust、前端测试/契约测试覆盖猎聘来源注册、payload、解析、归一化、缺失 profile 错误和数据库证据链。

## Acceptance Criteria

- [ ] 设置页显示猎聘为支持自动采集的平台，并提供连接/刷新状态动作。
- [ ] 采集配置页选择猎聘后显示猎聘专属配置区；未选择猎聘时不显示。
- [ ] 猎聘关键词为空、页数/岗位数非正数时，前端阻止启动并显示清晰错误。
- [ ] Tauri 为猎聘加载独立可选 session 和 `liepin-browser-profile`，不落到 BOSS session/profile。
- [ ] worker 收到 `source_platform = "liepin"` 时进入猎聘模式，而不是 BOSS 默认分支。
- [ ] 猎聘 parser 单测覆盖搜索 API/HTML、详情页、登录/安全验证页和 normalized payload。
- [ ] 猎聘 run 在无可用 profile 时发出明确 `ERROR`，且不发出假成功的 normalized job。
- [ ] 归一化猎聘岗位能通过现有 sidecar/DB 路径写入 job、job_source_link、job_detail_raw，并可在职位列表以“猎聘”来源显示。
- [ ] 默认 filter profile 的 sourcePlatforms 包含 `liepin`。
- [ ] `npm run test:worker`、相关 Rust 测试、前端类型检查/构建通过。

## Notes

- 本任务是复杂跨层功能，需在实施前补充 `design.md` 和 `implement.md`。
- 暂不包含自动投递、沟通状态同步、猎聘简历投递或站内消息能力。
- 暂不要求实时破解验证码；遇到登录/安全验证按智联策略提示用户到设置页重新连接。
