# 开发智联招聘平台功能

## Goal

把当前仅作为预留/手动导入来源的“智联招聘”打开为可自动采集的平台来源，让用户能像 Boss、V2EX、LinuxDo 一样从采集配置页选择智联，按关键词和基础范围抓取岗位，写入统一岗位库，并继续复用现有筛选、AI 采后判断、岗位列表和导出流程。

首版目标是“采集岗位并入库”，不是自动投递、自动沟通或完整平台账号工作台。

## Confirmed Facts

- 项目是 Tauri + Vue 前端、Rust 命令/数据库层、Node worker 的桌面应用。
- 当前自动采集平台包括：
  - Boss：`source_platform = "boss"`，Puppeteer 可见浏览器采集，列表/详情事件入库。
  - V2EX：`source_platform = "v2ex"`，feed/网页分页采集，发 `JOB_NORMALIZED_CAPTURED` 入库。
  - LinuxDo：`source_platform = "linuxdo"`，Discourse API/浏览器兜底采集，发 `JOB_NORMALIZED_CAPTURED` 入库。
- 智联当前已存在平台值和显示入口，但仍是预留能力：
  - 前端 `JobSourcePlatform` 已包含 `"zhilian"`。
  - `JOB_SOURCE_PLATFORM_OPTIONS` 中“智联招聘”当前 `adapterKind = "manual_import"`。
  - Rust `job_sources` 注册中 `"zhilian"` 当前 `adapter_kind = "manual_import"`。
  - `COLLECTABLE_SOURCE_PLATFORMS` 目前只有 `boss`、`v2ex`、`linuxdo`。
- 项目级 collection source contract 明确：其他非 Boss 平台在自动 adapter 存在前保持 `manual_import`，自动 adapter 存在后才应进入 collectable source。
- 统一入库链路已经支持非 Boss normalized payload：
  - worker 发 `JOB_NORMALIZED_CAPTURED`。
  - Rust sidecar 调 `upsert_job_from_normalized_with_outcome` 写入 `job`、`job_source_payload`、`job_detail_raw` 等统一结构。
- 默认筛选画像当前只包含已支持自动采集来源 `boss`、`v2ex`、`linuxdo`，智联变成自动采集来源后也需要纳入默认允许来源，避免采后立即被来源门禁挡住。
- 2026-06-30 调研和实测：
  - `www.zhaopin.com` 搜索页、详情页和 `robots.txt` 请求在当前环境返回 Tencent Cloud EdgeOne `Security Verification` 页面。
  - `fe-api.zhaopin.com/c/i/city-page/user-city` 可匿名返回城市数据。
  - 公开资料和开源项目常见老接口为 `fe-api.zhaopin.com/c/i/sou`，无需账号 Cookie 即可返回 JSON 结构；但当前环境按常见参数请求只返回空列表，不能直接认定可稳定无登录采集。
  - 较新的开源项目/Issue 提到 `fe-api.zhaopin.com/c/i/search/positions`、`/api/c/salesman-search/v2`、`/api/c/jobs/{id}/info` 等新端点，通常需要登录 Cookie、CSRF 或复制浏览器 cURL 中的加密参数。
  - `m.zhaopin.com` 部分公开聚合页面可匿名返回 HTML，页面含岗位列表/链接摘要，说明存在低登录依赖的公开读路径，但搜索结果和详情完整性仍需实现前用页面/网络请求确认。
  - 结论：智联首版不能承诺完全免登录；实现应先尝试公开 API/公开页面路径，遇到 EdgeOne、登录页、验证码或空结果异常时发明确日志/错误，并预留可见浏览器验证恢复。

## Requirements

- 智联招聘在采集配置页作为可自动采集平台出现，可与 Boss/V2EX/LinuxDo 一起被选择，并按现有多平台顺序采集模型逐个运行。
- 智联配置首版提供平台专属字段，不使用泛化意图表单：
  - 搜索关键词，多行输入；
  - 城市/地区文本或基础输入；
  - 页数上限；
  - 岗位上限；
  - 请求间隔沿用全局 delay。
- 前端校验智联任务：
  - 至少 1 个关键词；
  - 页数上限必须为正；
  - 岗位上限为空表示不限，非空时必须为正。
- Tauri `crawl_auto_start` 对智联使用可选 session，不要求 Boss 登录态；智联自身如果触发登录/安全验证，worker 负责识别并给出明确日志/状态，首版可提示用户稍后用可见浏览器验证恢复。
- 若公开路径无法稳定取得详情，智联首版允许退化为“需要用户在可见浏览器完成智联登录/安全验证后继续采集”，但不能要求用户手工复制临时 cURL 或 token。
- Worker 为智联新增 adapter 路由，首版通过 `JOB_NORMALIZED_CAPTURED` 写统一岗位：
  - `source_platform = "zhilian"`；
  - `encrypt_job_id = "zhilian:<stableId>"`；
  - `dedup_key = <stableId>`；
  - `source_url` 指向智联岗位详情页；
  - 尽量填充 `position_name`、`brand_name`、`city_name`、`salary_desc`、`experience_name`、`degree_name`、`jd_text`、`raw_payload`。
- 智联采集应只做“岗位写入前的硬有效性过滤”，例如缺少稳定 ID 或职位标题；用户偏好、排除词、AI 采后判断仍由现有采后流程处理。
- 智联作为自动采集来源后，来源注册、前端来源选项、默认筛选来源、岗位列表来源标签保持一致。
- 运行日志需要清楚区分“未配置/无结果/请求失败/被登录或验证拦截”，不能只发 `FINISHED` 造成假成功。
- 不硬编码账号、Cookie、Token 或代理到项目文件。

## Out of Scope

- 智联自动投递、自动打招呼、聊天状态同步。
- 智联完整账号体系、简历投递权限、企业沟通状态和登录诊断面板。
- 智联高级筛选字典同步，除非实现过程中能从稳定页面/接口确认参数并低风险接入。
- 智联账号登录态管理页、独立诊断面板。
- 对猎聘、脉脉等其他预留平台的自动采集实现。
- 修改现有 Boss/V2EX/LinuxDo 的业务语义。

## Acceptance Criteria

- [ ] 采集配置页能选择智联招聘，并显示智联专属配置面板。
- [ ] 保存采集配置后，智联相关配置能持久化并重新加载。
- [ ] 点击开始采集时，智联会生成 `source_platform = "zhilian"` 的 `crawl_auto_start` 任务。
- [ ] Worker 能路由智联任务，按关键词和页数上限采集岗位，发出 normalized job 事件。
- [ ] 智联岗位入库后在岗位列表显示为“智联招聘”，并能参与现有筛选、AI 采后判断和导出。
- [ ] 采集记录、失败记录和进度日志能反映智联运行结果。
- [ ] `maxJobs` 对智联遵守“成功插入的新岗位数”语义，重复/更新岗位不消耗上限。
- [ ] 没有稳定岗位 ID 或没有任何可解析岗位时，worker 发明确错误或跳过日志，不报告静默成功。
- [ ] Worker 单测覆盖智联列表/详情解析、URL/ID 归一化、normalized payload。
- [ ] Rust 测试覆盖智联 source registry 从预留手动导入变为自动 adapter，以及 normalized 入库链路。
- [ ] 前端类型检查/构建通过；Worker 测试通过；Rust 相关测试通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` before `task.py start`.
