# 实施计划：最小化状态下的定时采集调度

## 前置审查

- [ ] 用户审核 `prd.md`、`design.md`，确认“最小化/隐藏继续，关闭停止；睡眠唤醒补一次；不加通知”的范围。
- [ ] 实现前读取 `trellis-before-dev`，并按 frontend 与 Rust 相关规范刷新上下文。

## 实施步骤

1. **新增 Rust scheduler 核心**
   - 文件：`src-tauri/src/scheduler.rs`。
   - 实现应用级状态、Condvar 后台线程、版本化计划替换、取消和一次性 due 事件。
   - 为到期、取消、重排、旧版本和单次触发添加 Rust 单测。
   - 风险点：线程退出、锁粒度、系统睡眠后的 wall-clock 判断。

2. **接入 Tauri 生命周期与 command**
   - 文件：`src-tauri/src/commands/schedule.rs`、`src-tauri/src/commands/mod.rs`、`src-tauri/src/lib.rs`。
   - 在 `setup` 中 `manage(CrawlScheduleManager)`，注册 `update_crawl_schedule` command。
   - 确认应用关闭时不会遗留线程或阻止进程退出。

3. **替换前端等待机制**
   - 文件：`src/lib/useCrawlPage.ts`。
   - 保留 Cron 解析与 UI 展示；将 `window.setTimeout` / `clearTimeout` 替换为 Rust command 同步。
   - 注册单例 `crawl-schedule://due` 监听，校验 version 后复用 `runScheduledCrawl`。
   - 保留初始化、配置持久化、冲突跳过、运行状态和下一次重排逻辑。

4. **更新前端契约测试**
   - 文件：`test/review-workflow-contract.test.js`，必要时新增 scheduler 专项测试。
   - 断言 schedule 初始化仍由根组件触发，Cron 配置字段不变，旧的前端 timer 等待代码被移除，due 事件连接到现有运行入口。

5. **构建与自动化验证**
   - `npm run build`
   - `npm run test:review-workflow`
   - `cargo test --manifest-path src-tauri/Cargo.toml scheduler`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - 如资源允许，再运行 `npm test` 做完整回归。

6. **桌面端烟测**
   - `npm run tauri:dev` 启动桌面端。
   - 将 Cron 临时设为未来 1–2 分钟，分别验证窗口可见、最小化、隐藏三种状态。
   - 让系统在计划时间前睡眠，唤醒后确认只执行一次；恢复窗口确认状态、日志和下一次时间。
   - 关闭应用后确认不会继续产生采集任务。

7. **质量门禁与交付**
   - 执行 `trellis-check`，并按本项目要求执行通用代码 review；Rust 改动另执行 `go-review` 不适用，使用通用 review 覆盖 Rust/TypeScript。
   - 扫描 diff，确认无高频轮询、重复事实源、吞异常或无关功能。
   - 通过后再执行 `task.py start` 进入实现；完成后按 Trellis finish 流程归档。

## 回滚点

- R1：Rust scheduler / command 无法构建时，只回滚新增 Rust 模块与注册，不改配置格式。
- R2：某平台事件后台行为不可靠时，保留 scheduler 接口并回退前端调度接入，先恢复原有行为再单独处理平台差异。
- R3：前端契约或桌面烟测失败时，不进入发布，不修改现有 Cron 业务语义。
