# 智联招聘真实可用采集

## Goal

把智联招聘采集从“代码链路存在但真实采集无数据”修到产品可用：用户在设置页一次性连接/验证智联后，后续点击采集应后台复用 `zhilian-browser-profile` 获取岗位列表并写入统一岗位库；采集过程中不得每次要求用户手动点验证。

## Confirmed Facts

- 2026-06-30 真实测试：
  - `curl` / 普通 Node HTTP 访问 `www.zhaopin.com` 和 PC 搜索页返回 Tencent EdgeOne `Security Verification`，无岗位链接。
  - 老接口 `fe-api.zhaopin.com/c/i/sou` 多个关键词返回 200 JSON，但 `results=[]`。
  - 真实浏览器未登录访问 `https://www.zhaopin.com/sou/jl530/kw01500O80EO062/p1?kt=3` 可看到北京 Java 岗位列表，页面中存在 19 个真实 `jobdetail` 链接和列表级字段。
  - 未登录直接打开岗位详情页触发 `Security Verification`。
  - 当前 worker 真实跑 `source_platform = "zhilian"` 时没有产出 `JOB_NORMALIZED_CAPTURED`，只报“没有解析到任何岗位”。
- 2026-06-30 修复后真实 worker 测试：
  - `LOGIN_START` 打开智联搜索页后保存 `data/zhilian-browser-profile`，返回 `LOGIN_STATUS valid`，采集到 12+ cookies。
  - `CRAWL_AUTO_START` 使用同一 profile，`keywords=["Java"]`、`filters.city="530"`、`maxPages=1`，输出 19 条 `JOB_NORMALIZED_CAPTURED`。
  - 第一条真实岗位字段：`java 开发工程师` / `北京捷科智诚科技有限公司上海分公司` / `北京·顺义·双丰` / `1.3-1.7万` / `3-5年` / `本科` / `zhilian:CCL1405333700J40877845205`。
  - 详情页仍可能被验证拦截；当前实现按列表级信息入库，`detail_status = "missing"`，不阻断岗位进入岗位库。
- 已有智联首版代码接入了前端配置、Tauri session/profile 路径、worker 路由、normalized 入库和测试，但真实可用采集路径仍缺 PC 搜索页浏览器采集。

## Requirements

- 智联采集首选后台复用已保存的 `zhilian-browser-profile` 打开 PC 搜索结果页并提取岗位列表。
- 设置页“打开/连接智联”仍作为一次性连接或重连入口；采集过程不能把人工验证当作正常流程反复要求用户操作。
- 采集开始时做智联 profile health check：
  - 能打开搜索页且页面含岗位列表或明确空结果：继续采集。
  - 命中 EdgeOne 安全验证、登录拦截、验证码、人机验证或页面不可读：本次采集明确失败，提示用户到设置页重新连接智联。
- Worker 必须支持从 PC 搜索页 HTML/DOM/SSR 文本提取列表级岗位：
  - 稳定岗位 ID；
  - 详情 URL；
  - 职位标题；
  - 公司；
  - 城市/地区；
  - 薪资；
  - 经验；
  - 学历；
  - 列表页可见技能/标签；
  - 列表级 `jd_text` fallback。
- 详情页如果可读则补详情正文；如果被验证或登录拦截，不阻塞列表岗位入库，写入 `detail_status = "blocked"` 或 `"missing"`。
- `maxJobs` 仍由 sidecar 按成功插入的新岗位数控制，worker 不能用原始事件数消耗上限。
- 无稳定 ID 或标题的条目跳过并写日志；整轮没有岗位事件必须发 `ERROR`。
- 不硬编码账号、Cookie、Token 或代理；不要求用户手动复制 cURL、CSRF、加密参数。

## Acceptance Criteria

- [x] Worker 真实调用智联采集时能从 PC 搜索页产出 `JOB_NORMALIZED_CAPTURED` 事件。
- [x] 至少一个真实关键词/城市组合能提取到岗位标题、公司、城市、薪资、经验、学历和详情 URL。
- [x] 详情页被验证拦截时，岗位仍按列表级信息入库，并标记详情受限。
- [x] 未连接或 profile 失效时，采集失败信息明确提示“请到设置页重新连接智联”，不假成功。
- [x] 不在采集过程中要求用户每次手动验证作为正常路径。
- [x] Worker 单测覆盖 PC 搜索页解析、blocked detail fallback、normalized payload。
- [x] 前端构建、worker 测试、Rust 测试通过。
- [x] 完成一次真实 worker 功能测试：输出中出现 `JOB_NORMALIZED_CAPTURED > 0`。
