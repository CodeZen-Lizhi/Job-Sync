# 技术设计：最小化状态下的定时采集调度

## 1. 设计目标与边界

把“等待下一次 Cron 时间”从 WebView 的 `window.setTimeout` 移到 Tauri Rust 主进程；到点后通过 Tauri 事件通知前端，继续调用现有 `runScheduledCrawl` / `start`。这样不改采集业务，只改变调度唤醒层。

明确不做：

- 不把多平台采集、sidecar 事件编排或 AI 后处理整体迁移到 Rust scheduler。
- 不接入操作系统计划任务，不保证应用完全退出后继续运行。
- 不增加系统通知或托盘常驻。

## 2. 当前数据流

```text
collection_config
      │ load/save
      ▼
Vue useCrawlPage ── Cron.nextRun() ── window.setTimeout
      │                                      │
      └──────────── runScheduledCrawl() ◄────┘
                           │
                           └─ start() → crawl_auto_start → SidecarManager → worker
```

当前缺陷是最后的等待步骤属于 WebView 前端；窗口最小化或隐藏后，WebView 计时器不能作为可靠的后台唤醒机制。

## 3. 目标数据流

```text
collection_config
      │ load/save
      ▼
Vue useCrawlPage ── Cron.nextRun() ── update_crawl_schedule(next_run_at_ms, version)
                                              │
                                              ▼
                                  Rust CrawlScheduleManager
                                  (Condvar + one-shot wait)
                                              │ deadline / wake
                                              ▼
                                  crawl-schedule://due
                                              │
                                              ▼
                                  runScheduledCrawl() → 现有 start()
```

Rust scheduler 只持有一个下一次唤醒时间。配置关闭时清空唤醒；配置变化时替换唤醒；到点后先清空当前计划，再发一次事件，避免同一计划重复发出。

## 4. 模块与接口

### 4.1 Rust scheduler

新增 `src-tauri/src/scheduler.rs`，提供应用级 `CrawlScheduleManager`：

- 内部使用 `Arc<(Mutex<State>, Condvar)>` 和一个后台线程；无计划时阻塞等待，有计划时一次性等待到绝对时间，不做固定轮询。
- `State` 至少包含 `next_run_at_ms: Option<i64>`、`request_version: u64`、`generation: u64`、`stopped: bool`。
- 更新计划时只接受不小于当前的 `request_version`，并唤醒 Condvar；旧请求不能覆盖新请求。
- 到期时先将当前计划清空，再发 `crawl-schedule://due` 事件；事件负载包含 `version` 与 `scheduled_at_ms`。
- 到期判断使用 wall-clock 毫秒值，线程从睡眠返回后直接比较当前时间，因此计划时间落在系统睡眠期间时，唤醒后只产生一次 due 事件。

### 4.2 Tauri command

新增 `src-tauri/src/commands/schedule.rs`：

```text
update_crawl_schedule(next_run_at_ms: Option<i64>, request_version: u64) -> Result<(), String>
```

命令通过 `State<CrawlScheduleManager>` 替换或清空后台唤醒。`src-tauri/src/lib.rs` 在 `setup` 中注册 manager，并将 command 加入 `generate_handler!`。

Tauri 官方文档支持在 `setup` 阶段启动非阻塞后台任务、管理应用级状态并向前端发事件：
<https://v2.tauri.app/learn/splashscreen>、<https://v2.tauri.app/develop/state-management>。

### 4.3 前端调度接入

修改 `src/lib/useCrawlPage.ts`：

- 保留 `croner` 负责 Cron 校验、`nextRun()` 和未来三次时间展示，避免 Rust 与前端出现两套 Cron 解析/时区语义。
- 将 `rescheduleCrawlTimer` 改为计算下一次时间后调用 `update_crawl_schedule`；本地递增 `request_version`，并把 `next.getTime()` 作为毫秒时间传给 Rust。
- 将清理 timer 改为发送 `next_run_at_ms: null`，不再使用 `window.clearTimeout`。
- 在 singleton state 中只注册一次 `crawl-schedule://due` 监听；收到当前 `version` 的事件后调用现有 `runScheduledCrawl()`，忽略过期 version。
- `runScheduledCrawl()` 的忙碌冲突、跳过记录、成功/失败记录和 finally 重排下一次计划全部保留。
- `initializeSchedule()` 在应用根组件挂载时仍执行，因此不依赖当前路由；加载配置后立即同步 Rust scheduler。

### 4.4 配置与状态

不新增配置字段，不改变 `collection_config` 结构。`crawlScheduleNextRunAt` 仍由前端根据 Cron 计算并展示；最近一次状态继续使用已有字段持久化。Rust scheduler 的当前等待状态是运行时状态，应用关闭后自然丢失，启动时由保存的 Cron 配置重新计算。

## 5. 生命周期与边界行为

- 窗口最小化/隐藏：Tauri 进程和 Rust scheduler 继续运行，事件通知前端并触发采集。
- 窗口恢复：无需额外补偿；状态已在现有 `recordCrawlScheduleRun` 中持久化，恢复后页面重新读取/显示。
- 系统睡眠：Rust 等待线程在唤醒后比较 wall-clock；若已超过计划时间，发一次 due 事件。前端执行一次后从当前时间计算下一次，不补跑多个错过周期。
- 应用完全退出：scheduler 线程随进程停止，不执行计划；不引入托盘或 OS 级常驻。
- 采集冲突：继续由现有 `sidecarRunning` / `actionBusy` 检查决定跳过并记录，不新增并发锁。

## 6. 重复与竞态控制

1. 前端每次同步计划都递增 `request_version`；Rust 只接受最新版本。
2. Rust 到期前清空计划并递增 `generation`，同一 generation 只发一次事件。
3. 前端只处理当前计划版本的 due 事件；配置关闭或重排后，旧事件被忽略。
4. `runScheduledCrawl` 的 finally 统一安排下一次计划，手动运行与定时运行仍共享 `actionBusy` 语义。

## 7. 验证与风险

- Rust 单测覆盖：首次计划到期、重排取消旧计划、取消计划、旧版本请求被忽略、同一 generation 只触发一次。
- 前端契约测试覆盖：不再调用 `window.setTimeout` 等待 Cron；仍初始化 schedule、持久化状态并调用现有运行入口。
- 手动烟测覆盖：窗口最大化、最小化、隐藏；计划时间跨过系统睡眠；恢复窗口查看结果。
- 主要风险是各平台 WebView 对 Tauri 事件回调的后台行为可能不同；因此必须在 macOS 与 Windows 至少各做一次最小化烟测。若事件在某平台被延迟，仍可在窗口恢复时通过当前计划版本做一次非轮询补偿检查，但不在本期引入高频监控。

## 8. 回滚

若后台 scheduler 在某平台构建或运行异常，可回滚 `useCrawlPage` 的调度接入、Rust scheduler 模块和 command 注册；配置字段不变，旧版本仍可读取已有 `collection_config`。
