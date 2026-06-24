# LinuxDo 自动采集设计

## Scope

新增 LinuxDo 自动采集适配器，首期只覆盖 LinuxDo「非我莫属」分类的职位/求职相关话题采集。实现完整链路：

采集配置页 -> Tauri `crawl_auto_start` -> worker LinuxDo visible-browser mode -> `JOB_NORMALIZED_CAPTURED` -> SQLite unified job model -> 默认采后规则/AI 采后判断 -> 职位库展示。

## Existing Architecture

- Boss:
  - `useCrawlPage.ts` 构建 Boss task。
  - `crawl_auto_start` 要求 Boss session。
  - worker `runAutoMode` 默认走 Boss 可见浏览器和 Boss API。
- V2EX:
  - `useCrawlPage.ts` 构建 `source_platform = "v2ex"` task。
  - `crawl_auto_start` 使用 optional session。
  - worker `runAutoMode` 路由到 `runV2exFeedMode`。
  - worker emit `JOB_NORMALIZED_CAPTURED`，Rust 统一入库。
- LinuxDo 当前：
  - `job_sources` 注册为 `manual_import`。
  - UI 可以显示为来源，但没有 `source_platform = "linuxdo"` 的自动 adapter。

## Product Model

LinuxDo 是“可见浏览器自动采集”平台：

- Settings 中启用/禁用 LinuxDo 控制采集配置页是否显示 LinuxDo。
- 采集配置页选择 LinuxDo 后显示专属配置区。
- 点击采集时打开可见 Chromium 到 LinuxDo 页面。
- 如果 Cloudflare 出现，用户在窗口内手动完成验证。
- 验证通过后 worker 从页面上下文采集列表和详情。

## Frontend Contract

新增 LinuxDo 配置状态：

- `linuxdoCategoryUrl`: 默认 `https://linux.do/c/job/27`
- `linuxdoKeywordsText`: 从全局采集意图同步，可手动编辑
- `linuxdoRecentDays`: 最近天数，默认空表示不限
- `linuxdoMaxPages`: 页数上限，默认 3
- `linuxdoMaxJobs`: 入库上限，默认空表示不限或沿用 task limit
- `linuxdoSortBy`: `latest` 或 `created`

保存到 `collection_config`，与 V2EX 字段并列。

显示规则：

- LinuxDo enabled -> 来源按钮显示 LinuxDo。
- LinuxDo selected -> LinuxDo 专属配置区显示。
- LinuxDo disabled -> 来源按钮不显示；已保存选择在加载 registry 后被过滤。

## Worker Contract

`runAutoMode` 新增路由：

```ts
if (payload.task.source_platform === "linuxdo") {
  await runLinuxDoMode(payload, ctx);
  emit FINISHED;
  return;
}
```

`runLinuxDoMode` 行为：

1. 启动可见浏览器，限制导航域为 `linux.do`。
2. 打开 configured category URL，默认 `https://linux.do/c/job/27`。
3. 等待页面不是 Cloudflare challenge；期间定期 emit `LOG` 提示用户完成验证。
4. 在页面上下文中优先请求 Discourse JSON：
   - category list: `/c/job/27.json` 或 configured URL + `.json`
   - pagination: `?page=N`
   - detail: `/t/<topicId>.json`
5. 如果 JSON 请求失败但 DOM 已加载，降级解析页面 topic links，再逐条打开详情页面抓正文。
6. 如果列表项已经有 topic id / title / link，但详情抓取失败，MVP 仍允许标题级入库；`raw_payload.detail_status` 标记为 `missing` 或 `blocked`，`jd_text` 至少包含标题和详情缺失说明。
7. 归一化并 emit `JOB_NORMALIZED_CAPTURED`：
   - `encrypt_job_id = "linuxdo:<topicId>"`
   - `source_platform = "linuxdo"`
   - `source_url = "https://linux.do/t/<topicId>"`
   - `dedup_key = "<topicId>"`
   - `position_name = title`
   - `boss_name = author/username`
   - `jd_text = title + first post text`，详情缺失时为标题级文本
   - `raw_payload` 包含 topic list item、topic JSON if available、classification、detail_status、source config

## Classification

MVP 采用轻量招聘信号识别，避免把讨论帖全部入库。

Positive signals:

- 招聘、内推、岗位、职位、远程、全职、兼职、外包、接单、招人、简历、投递、薪资、JD、简历投递、邮箱、Base、HC

User keywords:

- 如果配置了 LinuxDo 关键词，则标题或正文命中任一关键词可加分。
- 关键词不能单独让非招聘帖入库；仍需招聘信号，避免污染职位库。

Skipped entries emit `JOB_FILTERED` with `rule_type = "linuxdo_topic_classification"` when possible.

## Detail Missing Behavior

MVP prioritizes non-zero collection over perfect detail completeness.

- If list-level data includes stable topic id, title, and URL, the topic may be inserted even when detail fetch fails.
- `raw_payload.detail_status` records:
  - `ok`: detail fetched and parsed
  - `missing`: detail not available from current page/API
  - `blocked`: Cloudflare/HTTP/timeout prevented detail fetch
- `jd_text` should include a short marker such as `详情暂未抓取，需打开原帖确认。`
- Post-collection AI and existing low-information rules own final recommendation. Such jobs should usually land in pending confirmation unless title itself is enough.

## Rust / Sidecar Contract

- `crawl_auto_start` 对 `source_platform = "linuxdo"` 使用 optional session，不要求 Boss cookies。
- `EventOut::Finished` 对 `linuxdo` 也触发 `auto_recompute_ai_after_collection`。
- normalized job 入库不需要新 Rust event 类型，复用 V2EX 的统一入库路径。
- collection run `source_platform = "linuxdo"`。

## Cloudflare Handling

- 不实现隐蔽绕过。
- 可见浏览器是用户主动验证路径。
- Worker 检测 challenge 页面：
  - title 包含 `Just a moment`
  - DOM 包含 `Verify you are human`
  - Cloudflare challenge scripts / `cf-mitigated`
- 等待策略：
  - 每 2 秒检查一次。
  - 默认最多等待 180 秒，可由 limits 扩展。
  - 超时后 emit `ERROR`：提示用户验证未完成或 LinuxDo 阻止采集。

## Compatibility

- Boss 和 V2EX task payload 不变。
- LinuxDo 新字段缺省时使用安全默认值。
- `job_sources` 可在后续从 `manual_import` 升级为自动 adapter kind，但 MVP 可先让 frontend allow `linuxdo` and worker route `linuxdo`，避免迁移风险。

## Rollback

- 删除 worker LinuxDo mode 和 `runAutoMode` linuxdo branch。
- 删除 frontend LinuxDo config fields/section。
- 恢复 `useCrawlPage` 对 LinuxDo 的 skip behavior。
- 不需要 DB rollback；已入库 LinuxDo jobs 是普通 unified jobs，可保留或由用户按来源过滤删除。
