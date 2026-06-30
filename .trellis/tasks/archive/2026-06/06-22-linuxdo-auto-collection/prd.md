# LinuxDo 自动采集

## Goal

让 LinuxDo 像 Boss / V2EX 一样成为真实可执行的采集来源：采集配置页选择 LinuxDo 时显示专属配置，点击自动采集后能抓取 LinuxDo「非我莫属」等配置范围内的岗位帖，写入统一职位库，并进入现有采后 AI 判断、筛选、Telegram 通知和职位详情流程。

## User Value

- 用户已经在系统浏览器登录 LinuxDo，不希望应用只展示一个不可执行的占位入口。
- 用户希望 LinuxDo 有平台专属配置，而不是复用 Boss 或 V2EX 的配置概念。
- 用户点击“开始采集”后，需要真实入库 AI 判断后的岗位数据，而不是只保存来源选择。

## Confirmed Facts

- 现有自动采集链路支持 Boss 和 V2EX：
  - 前端 `src/lib/useCrawlPage.ts` 根据 `source_platform` 构建平台 payload。
  - Worker `packages/boss-crawler-worker/src/modes/auto/run.ts` 对 `source_platform = "v2ex"` 路由到 `runV2exFeedMode`，否则走 Boss。
  - Rust `crawl_auto_start` 对 V2EX 使用可选 session，对 Boss 使用 Boss session。
  - 非 Boss normalized jobs 通过 `JOB_NORMALIZED_CAPTURED` 入库统一 `job` 模型。
- LinuxDo 当前在源注册表中是 `manual_import`，还没有自动采集 adapter。
- LinuxDo 是 Discourse 站点。
- LinuxDo 招聘/求职分类是 `非我莫属`，公开分类元数据中看到 `id = 27`、`slug = job`。
- `https://linux.do/categories.json` 曾成功返回公开 JSON，并能看到分类列表；之后同类请求也可能被 Cloudflare challenge。
- `https://linux.do/c/job/27.json`、`https://linux.do/c/job/27/l/latest.json`、`https://linux.do/search.json?...` 在当前命令行环境容易返回 Cloudflare challenge 或 429。
- 因 Cloudflare，LinuxDo 的直接 API 请求仍可能被 challenge / 429 拦截；采集器必须明确暴露 API 被拦截的原因，不做隐蔽绕过。
- 前一轮已把 LinuxDo 从 Puppeteer 登录流程移除，原因是自动化浏览器登录触发 Cloudflare 人机验证。

## Requirements

- 采集配置页：
  - LinuxDo 启用时必须显示在来源选择里；禁用时不显示。
  - 选择 LinuxDo 后必须显示 LinuxDo 专属配置区。
  - LinuxDo 专属配置至少包含采集范围、关键词、最近天数、页数/条数上限、排序或时间依据。
- 自动采集：
  - 选择 LinuxDo 并点击采集时必须真实执行 LinuxDo 采集 adapter。
  - 成功识别的 LinuxDo 岗位帖必须写入统一职位库：
    - `source_platform = "linuxdo"`
    - `source_url = https://linux.do/t/<topicId>` 或等价话题 URL
    - `dedup_key = <topicId>`
    - 标题、作者、发布时间/更新时间、正文摘要/正文尽量写入统一字段
  - 如果列表页已经抓到标题和链接，但详情页/详情 JSON 被 Cloudflare 或网络问题拦住，MVP 允许先以标题级岗位入库，并保留低信息证据供采后判断。
  - LinuxDo 采集结果必须进入现有采后筛选和 AI 采后判断流程。
  - LinuxDo 采集失败必须在运行日志中明确说明是 Cloudflare、限流、网络错误、解析失败还是无匹配结果。
- 反风控与登录态：
  - 不恢复“自动化浏览器登录 LinuxDo”的旧流程。
  - MVP 采用 Discourse API-first 采集：worker 直接请求分类 JSON 和话题详情 JSON；如果存在 LinuxDo 登录快照，请求携带 LinuxDo cookies。
  - 如果 Discourse API 被 Cloudflare / 429 拦截，运行日志必须明确说明 API 被拦截，而不是静默失败或恢复旧自动化浏览器登录。
- 兼容性：
  - Boss 和 V2EX 现有采集行为不能回退。
  - 已保存的采集配置需要兼容新增 LinuxDo 字段。
  - 已有 `manual_import` 来源模型继续可用于职位来源筛选和统一职位库。

## Acceptance Criteria

- [ ] Settings 中启用 LinuxDo 后，采集配置页来源区域显示 LinuxDo；禁用后不显示。
- [ ] 选择 LinuxDo 后，页面出现 LinuxDo 专属配置区，不再只是来源按钮。
- [ ] LinuxDo 专属配置保存后重启页面仍能恢复。
- [ ] 点击自动采集时，LinuxDo adapter 会执行并产生 collection run。
- [ ] 至少能从 LinuxDo「非我莫属」范围抓到可解析的话题列表或给出明确 Cloudflare/限流错误。
- [ ] 如果 LinuxDo Discourse API 被 Cloudflare / 429 拦截，运行日志给出明确拦截/限流错误，而不是静默失败。
- [ ] 成功抓到的 LinuxDo 岗位帖以 `source_platform = "linuxdo"` 写入统一职位库。
- [ ] LinuxDo 详情抓取失败但列表信息足够时，岗位仍可入库，并在 `raw_payload` / `jd_text` 中体现详情缺失状态。
- [ ] LinuxDo 入库岗位能显示来源、链接、详情正文，并参与默认采后规则和 AI 判断。
- [ ] LinuxDo 超过上限时按配置截断，不影响 Boss/V2EX 的上限语义。
- [ ] Boss 和 V2EX 单独采集、多来源顺序采集仍通过现有验证。

## Out of Scope

- 不实现 LinuxDo 站内发帖、私信、投递或自动联系。
- 不绕过 Cloudflare 或模拟隐蔽反检测行为。
- 不把 LinuxDo 浏览器登录重新塞回旧 Puppeteer 登录窗口。
- 不实现所有 Discourse 站点通用采集器；先只服务 LinuxDo。

## Decisions

- LinuxDo MVP 改为 Discourse API-first 采集，而不是可见浏览器页面采集。
- LinuxDo MVP 允许标题级岗位入库：列表抓到标题和链接即可写入；详情缺失时进入低信息/待确认路径，不因详情失败导致 0 入库。
