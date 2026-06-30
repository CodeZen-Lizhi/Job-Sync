# 智联真实可用采集执行计划

## Pre-Implementation

- [x] 读取任务 PRD/design。
- [x] 读取 collection source contract。
- [x] 读取 worker 智联、browser launch、navigation lock、auto mode 上下文。

## Implementation

- [x] Worker：新增 PC 搜索 URL 构造。
- [x] Worker：新增 PC 搜索页 blocked/ready/empty 判定。
- [x] Worker：新增 DOM/HTML 岗位列表解析，提取 job id、标题、公司、城市、薪资、经验、学历、标签。
- [x] Worker：采集时优先在需要时使用 `zhilian-browser-profile`，不把人工验证作为采集内等待流程。
- [x] Worker：详情页 blocked 时按列表级信息发 normalized payload。
- [x] Worker：日志和 ERROR 文案改为明确提示设置页重新连接智联。
- [x] Tests：补 PC 搜索页解析和真实 fallback 行为单测。
- [x] Tests：补智联 worker canary、智联 App DB canary 和 normalized detail `detailStatus` 回归覆盖。
- [x] Tauri：补 macOS release bundle 前台窗口 plist 覆盖，并在启动时显式 `show` / `set_focus` 主窗口。
- [x] Sidecar：抽出 `JOB_NORMALIZED_CAPTURED` 统一入库 helper，并补智联 normalized 事件写入岗位库的回归测试。
- [x] Tests：新增 `npm run zhilian:sidecar-canary`，真实启动 worker 并通过 Rust sidecar 入库 helper 写临时 SQLite。
- [x] Tests：补岗位库查询层回归，验证智联岗位可按来源筛选、按自动采集方法出现，并保留 missing-detail fallback 描述。

## Validation

- [x] `npm -w @job-sync/boss-crawler-worker run test`
- [x] `npm run build`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
- [x] `node --test test/review-workflow-contract.test.js`
- [x] `node --test test/boss-canary.test.js && node --test test/boss-db-canary.test.js`
- [x] `node --test test/zhilian-canary.test.js && node --test test/zhilian-db-canary.test.js`
- [x] `npm test`
- [x] `git diff --check`
- [x] 真实 worker 功能测试：智联采集输出 `JOB_NORMALIZED_CAPTURED = 19`
  - profile: `data/zhilian-browser-profile`
  - task: `source_platform=zhilian`, `keywords=["Java"]`, `filters.city="530"`, `limits.maxPages=1`
  - first job: `zhilian:CCL1405333700J40877845205`, `java 开发工程师`, `北京捷科智诚科技有限公司上海分公司`, `北京·顺义·双丰`, `1.3-1.7万`, `3-5年`, `本科`
- [x] 2026-06-30 23:40 真实 worker 复测：`npm run zhilian:canary -- --no-build --profile-dir data/zhilian-browser-profile --keyword Java --city 530 --max-pages 1 --max-jobs 20 --timeout-ms 90000`
  - 结果：`normalizedJobs=19`, `errors=0`, `finished=1`
  - 第一条：`zhilian:CCL1405333700J40877845205`, `java 开发工程师`, `北京捷科智诚科技有限公司上海分公司`, `北京·顺义·双丰`, `1.3-1.7万`, `detail_status=missing`
- [x] 2026-07-01 真实 worker 复测：`npm run zhilian:canary -- --no-build --profile-dir data/zhilian-browser-profile --keyword Java --city 530 --max-pages 1 --max-jobs 20 --timeout-ms 90000`
  - 结果：`normalizedJobs=20`, `errors=0`, `finished=1`
  - 第一条：`zhilian:CC189130320J40870890710`, `JAVA中高级软件工程师`, `北京金电恒通科技有限公司`, `北京·丰台·新村`, `9000-16000元`, `detail_status=missing`
- [x] 2026-07-01 真实 worker 复测：`npm run zhilian:canary -- --no-build --profile-dir data/zhilian-browser-profile --keyword Java --city 530 --max-pages 1 --max-jobs 20 --timeout-ms 90000`
  - 结果：`normalizedJobs=20`, `errors=0`, `finished=1`
  - 第一条：`zhilian:CC330611210J40893493203`, `JAVA开发平台负责人 (MJ026057)`, `北京五八信息技术有限公司`, `北京·朝阳`, `2.5-5万·15薪`, `detail_status=missing`
- [x] App 侧岗位库入库回归：`cargo test --manifest-path src-tauri/Cargo.toml sidecar::tests::persist_normalized_capture_writes_zhilian_job_and_run_counters -- --nocapture`
  - 结果：通过；验证智联 `JOB_NORMALIZED_CAPTURED` 写入 `job`、`job_source_link`、`job_detail_raw` 和 `collection_run` 计数。
- [x] 真实 sidecar 入库功能测试：`npm run zhilian:sidecar-canary`
  - 结果：通过；真实 worker 使用 `data/zhilian-browser-profile` 抓智联，Rust sidecar 持久化 3 条到临时 SQLite。
  - 样本：`zhilian:CC138117190J40875365405`，`run_1782839052686098000`，临时 DB `/var/folders/fg/bzpd9ft96g976xqf_w4lwbrr0000gn/T/.tmpqJ7Jaw/app-data/app.db`。
- [x] Tauri App bundle 构建验证：`npm run tauri:build:app`
  - 结果：`.app` 构建、签名、worker runtime 验证通过；仅跳过 notarization/DMG。
  - 新 bundle `Info.plist`：`LSRequiresCarbon=false`, `LSUIElement=false`。
- [x] DB canary 稳定性修复：`node --test test/boss-db-canary.test.js test/zhilian-db-canary.test.js`
  - 结果：通过；canary 使用 SQLite URI `mode=ro&cache=shared` 和 `.timeout 5000`，避免默认 App DB 路径含空格或短暂锁竞争导致误报。
- [x] 2026-07-01 01:24 前端交互验证：应用内浏览器打开 `http://127.0.0.1:1430/#/settings` 和 `#/crawl-config`
  - 设置页：确认存在 `智联招聘`，提示“打开一次验证、后续采集后台复用 profile、采集时未就绪提示重连、不停下来等人工验证”。
  - 采集配置页：点击 `智联招聘` 来源后展开 `连接一次 / 后台复用 profile` 配置区；填写关键词 `Java`、城市 `530`，页面显示 `关键词：Java`，字段值读取为 `Java` / `530`。
  - 修复点：非 Tauri 浏览器预览模式现在会加载预览来源列表，避免“只可预览”页面无法显示智联配置区。
- [x] 2026-07-01 01:25 真实 worker 复测：`npm run zhilian:canary -- --no-build --profile-dir data/zhilian-browser-profile --keyword Java --city 530 --max-pages 1 --max-jobs 20 --timeout-ms 90000`
  - 结果：`listJobs=20`, `normalizedJobs=20`, `errors=0`, `finished=1`
  - 第一条：`zhilian:CC330611210J40893493203`, `JAVA开发平台负责人 (MJ026057)`, `北京五八信息技术有限公司`, `北京·朝阳`, `2.5-5万·15薪`, `detail_status=missing`
- [x] 2026-07-01 01:26 真实 sidecar 入库复测：`npm run zhilian:sidecar-canary`
  - 结果：通过；真实 worker 事件通过 Rust sidecar 写入临时 SQLite。
  - 样本：`zhilian:CC193399810J40768180507`，`run_1782840385661878000`，临时 DB `/var/folders/fg/bzpd9ft96g976xqf_w4lwbrr0000gn/T/.tmp1vdCqM/app-data/app.db`。
- [x] 2026-07-01 01:42 岗位库查询层验证：`cargo test --manifest-path src-tauri/Cargo.toml list_job_candidates_filters_zhilian_and_keeps_missing_detail_fallback -- --nocapture`
  - 结果：通过；智联 normalized 岗位写入后，`list_job_candidates_on_conn(... source_platforms=["zhilian"], collection_methods=["automatic"])` 可查到 `source_platform=zhilian`、`collection_method=automatic`、智联原始 URL、公司和城市。
  - 详情 fallback：`job_detail_raw.zp_data_json.detailStatus = "missing"`，`jobInfo.postDescription` 保留 `详情暂未抓取，需打开原岗位确认。`
- [x] 2026-07-01 02:01 默认 App DB 真实入库验证：`JOB_SYNC_ZHILIAN_CANARY_DATA_DIR="$HOME/Library/Application Support/com.administrator.jobpilot" npm run zhilian:sidecar-canary`
  - 结果：通过；真实 worker 事件通过 Rust sidecar 生产入库 helper 写入默认 App DB `/Users/zhenglizhi/Library/Application Support/com.administrator.jobpilot/app.db`。
  - run：`run_1782842461626696000`，`jobs=3`，样本 `zhilian:CC130401720J40756228601`。
- [x] 2026-07-01 02:02 默认 App DB 只读 canary：`npm run zhilian:db-canary -- --run-id run_1782842461626696000 --keyword Java --city 530 --since-minutes 0`
  - 结果：通过；`captured=3`, `inserted=3`, `evidenceRows=3`。
  - 样本：`zhilian:CC130401720J40756228601`, `中级Java研发工程师`, `北京奈亚信息技术有限公司`, `北京·海淀·上地`, `1.8-2.1万`, `detailStatus=missing`。
  - 修复点：DB canary 增加带空格路径读取 fallback，并接受智联真实 PC 搜索页返回的 `http://www.zhaopin.com/jobdetail/...` URL。
- [x] 2026-07-01 07:20 本轮自动化复测：
  - `git diff --check`：通过。
  - `npm -w @job-sync/boss-crawler-worker run test`：通过，68 个 worker 测试通过。
  - `node --test test/review-workflow-contract.test.js test/boss-canary.test.js test/boss-db-canary.test.js test/zhilian-canary.test.js test/zhilian-db-canary.test.js`：通过，82 个 JS contract/canary 测试通过。
  - `cargo test --manifest-path src-tauri/Cargo.toml`：通过，158 passed / 1 ignored；仅既有 dead_code 警告。
  - `npm run build`：通过，Vue type-check 和 Vite build 完成。
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --check`：通过。
  - `npm test`：通过，聚合 review workflow、Boss/Zhilian canary 单测和 worker 测试。
- [x] 2026-07-01 07:20 真实 worker 复测：`npm run zhilian:canary -- --no-build --profile-dir data/zhilian-browser-profile --keyword Java --city 530 --max-pages 1 --max-jobs 20 --timeout-ms 90000`
  - 结果：`listJobs=20`, `normalizedJobs=20`, `errors=0`, `finished=1`
  - 第一条：`zhilian:CC548583180J40713705307`, `JAVA开发工程师`, `北京京师脑力科技有限公司`, `北京·海淀·花园路`, `1.5-2.2万`, `detail_status=missing`
- [x] 2026-07-01 07:20 真实 sidecar 入库复测：`npm run zhilian:sidecar-canary`
  - 结果：通过；真实 worker 事件通过 Rust sidecar 写入临时 SQLite。
  - 样本：`zhilian:CC330611210J40893493203`，`run_1782861631464417000`，临时 DB `/var/folders/fg/bzpd9ft96g976xqf_w4lwbrr0000gn/T/.tmp6BDmhr/app-data/app.db`。
- [ ] Computer Use UI 点击验证
  - 尝试对象：`npm run tauri:dev` dev app、`src-tauri/target/release/bundle/macos/JobPilot.app` release bundle、直接运行 `Contents/MacOS/job-sync`。
  - 2026-07-01 复测结果：`JobPilot` 进程可见且非 background-only；bundle `Info.plist` 已修正。`System Events` 显示 `visible=true` 但 `count of windows=0`，Computer Use 对工程 bundle 返回 `cgWindowNotFound`。`screencapture` 真实截图为 macOS 锁屏/登录界面，Computer Use 不能读取真实应用窗口树，也无法执行点击采集流。
  - 降级验证：使用 Playwright 打开 `http://[::1]:1430/#/crawl-config` 预览当前源码前端，确认智联配置入口和提示文案存在；该浏览器模式无 Tauri IPC，只用于 UI 可见性，不作为采集入库证明。
  - 2026-07-01 01:27 复测结果：`mcp__computer_use.list_apps` 能列出工程 bundle `JobPilot`；`get_app_state` 仍返回 `cgWindowNotFound`。`System Events` 显示 `job-sync, true, false, 0`；`screencapture` 真实截图仍为 macOS 锁屏界面，因此无法进行真实 JobPilot 点击流。
  - 2026-07-01 01:39 复测结果：`screencapture` 变为黑屏，`System Events` 仍显示 `job-sync, true, false, 0`，Computer Use 对 JobPilot 仍返回 `cgWindowNotFound`；仍无法执行真实 UI 点击。
  - 2026-07-01 01:55 复测结果：重启 release bundle 后仍 `job-sync, true, false, 0`，Computer Use 仍 `cgWindowNotFound`；启动 `npm run tauri:dev` 后 debug 进程运行，但 `System Events` 仍显示 `count of windows=0`，Computer Use 只识别 `.app` bundle且 release bundle仍无窗口。当前 GUI 会话无法完成真实点击。
  - 2026-07-01 02:07 最终复测：重新打开 release bundle 后 `System Events` 仍显示 `job-sync, false, true, false, 0`；Computer Use `get_app_state` 仍返回 `cgWindowNotFound`。该阻塞已连续多轮复现，当前环境无法执行真实 JobPilot UI 点击流。

## Review Gates

- [x] `trellis-check`
- [x] diff 自检：无硬编码凭据、无每轮人工验证路径、无假成功。
- [x] Post-change review：修复 `job_detail_raw.zp_data_json.detailStatus` 缺失隐患，避免智联 DB canary 在真实 sidecar normalized 入库后读不到 detail 状态。
- [x] Post-change review：`JOB_NORMALIZED_CAPTURED` sidecar 入库逻辑已集中为 `persist_normalized_capture`，避免测试和生产 handler 出现第二套事实源。
