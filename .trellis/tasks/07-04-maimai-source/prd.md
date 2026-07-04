# 接入脉脉招聘内容源

## Goal

把脉脉从“手动来源预留”升级为可自动采集的招聘内容源。第一版按“招聘文章 / 内推动态 feed adapter”接入：用户配置脉脉公开文章 URL、搜索页 URL 或文章 URL 列表，worker 解析招聘/内推内容，识别明确招聘信号后写入统一职位库，并参与采后筛选与 AI 判断。

脉脉不按猎聘/智联那种标准职位搜索页接入。MVP 目标是稳定采集公开可读招聘内容，不抓私信、联系人、人脉详情、手机号、简历或招聘方候选人推荐接口。

## Confirmed Facts

- `src/lib/crawl.ts` 当前包含 `maimai` 平台枚举，但 `MANUAL_IMPORT_SOURCE_PLATFORMS = ["maimai"]`，`COLLECTABLE_SOURCE_PLATFORMS` 不包含 `maimai`。
- `src-tauri/src/db/models/source_adapter.rs` 当前将 `maimai` 注册为 `manual_import`。
- 当前已支持多自动来源顺序启动；非 BOSS 内容源 V2EX/LinuxDo 通过 `JOB_NORMALIZED_CAPTURED` 写统一职位库。
- 默认筛选来源目前包含 `boss`、`liepin`、`v2ex`、`linuxdo`、`zhilian`，不包含 `maimai`。
- 现有 collection source spec 要求新增自动来源明确 adapter kind、payload、错误状态、`JOB_NORMALIZED_CAPTURED` 和默认筛选来源范围。
- 公开调研未发现成熟维护中的“脉脉职位采集”开源实现；可借鉴的开源多为登录态搜人脉或企业招聘候选人推荐接口，不适合作为求职岗位采集 MVP。

## Requirements

- 脉脉在来源注册表和前端来源选项中成为自动采集来源，不再显示为手动导入预留。
- 脉脉采集配置区至少支持：
  - 文章 / 搜索 URL 输入，支持多行、逗号、中文逗号、顿号分隔。
  - 关键词输入，用于招聘信号匹配和搜索 URL 参数补充。
  - 排序 / 时间窗口（如可从页面或 URL 支持）和页数上限。
  - 岗位入库上限，语义与其他 normalized feed 一致，按实际新增 job 数计数。
- Worker 能解析脉脉公开文章页的稳定 id、标题、作者/公司线索、发布时间、正文、来源 URL 和可见评论/摘要中的招聘信息。
- Worker 能从可配置搜索 URL 或文章列表页发现文章详情链接；若搜索页被登录/验证拦截或没有稳定文章链接，必须给出明确 `ERROR` 或日志，不报告假成功。
- Worker 只写具有明确招聘/内推信号的内容；讨论帖、公司八卦、纯人脉内容不得仅因关键词命中就入库。
- Worker 通过 `JOB_NORMALIZED_CAPTURED` 写入统一职位库，字段满足：
  - `source_platform = "maimai"`
  - `encrypt_job_id = "maimai:article:<stableId>"`
  - `dedup_key = "article:<stableId>"`
  - `source_url` 指向脉脉文章详情页
  - `jd_text` 包含文章标题、正文、可见招聘信息和缺失字段说明
- 脉脉采集完成后沿用现有采后筛选和 AI 判断，只处理本轮新插入岗位。
- 默认筛选来源包含 `maimai`，避免刚采集的脉脉岗位被默认 source gate 隐藏。
- 不采集私信、联系人详情、通讯录、人脉搜索结果、候选人推荐、手机号、简历或任何需要越权/绕过验证的数据。
- 新增或更新 worker、Rust、前端测试/契约测试覆盖脉脉来源注册、payload、文章解析、搜索页发现、分类过滤、归一化入库和默认筛选来源。

## Acceptance Criteria

- [ ] 设置页显示脉脉为支持自动采集的平台，不再显示“自动采集预留”。
- [ ] 采集配置页选择脉脉后显示脉脉专属配置区；未选择脉脉时不显示。
- [ ] 脉脉 URL 输入为空或页数/岗位上限非正数时，前端阻止启动并显示清晰错误。
- [ ] Tauri `crawl_auto_start` 对 `source_platform = "maimai"` 使用 optional session，不要求 Boss 登录态，不分配其他平台 profile。
- [ ] worker 收到 `source_platform = "maimai"` 时进入脉脉 feed mode，而不是 BOSS 默认分支。
- [ ] worker 能从脉脉文章详情页解析标题、正文、稳定 id、来源 URL，并构造 normalized payload。
- [ ] worker 能从脉脉文章/搜索列表页发现文章链接，按页数上限抓取，并对重复文章去重。
- [ ] worker 对缺少招聘信号的文章发出过滤事件或日志，不写入 `job`。
- [ ] 归一化脉脉内容能通过现有 sidecar/DB 路径写入 `job`、`job_source_link`、`job_detail_raw`，并可在职位列表以“脉脉”来源显示。
- [ ] 默认 filter profile 的 `sourcePlatforms` 包含 `maimai`，历史 Boss-only 默认画像升级到当前全部自动采集来源。
- [ ] `npm run test:worker`、相关 Rust 测试、前端类型检查/构建通过。

## Notes

- 本任务是跨前端、worker、Rust registry、默认筛选来源和 spec 的复杂功能，需要 `design.md` 与 `implement.md`。
- 第一版优先“公开招聘文章 / 内推动态 feed”，不做脉脉 App 抓包、企业招聘候选人推荐、人脉搜索或私信采集。
