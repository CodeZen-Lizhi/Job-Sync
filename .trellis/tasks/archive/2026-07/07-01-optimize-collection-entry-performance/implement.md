# Implementation Plan

## Checklist

- [x] 建立性能测试脚本并记录基线。
- [x] 保持采集主入口路由壳静态，避免用户点击采集入口时等待 route chunk。
- [x] 延迟加载采集配置页里的 cron 编辑器；保留采集页运行日志面板静态加载以避免点击时等待额外 chunk。
- [x] 收窄并延后 `/crawl` 页面初始化，确保首屏不等待 Boss meta / 默认采后规则。
- [x] 保持 `/crawl-config` 完整功能，但允许非首屏数据后台加载。
- [x] 复跑性能测试并记录前后对比。
- [x] 运行构建和相关契约测试。
- [x] 执行前端/TypeScript diff review。

## Candidate Files

- `src/router.ts`
- `src/pages/Crawl.vue`
- `src/pages/CrawlConfig.vue`
- `src/lib/useCrawlPage.ts`
- `scripts/`
- `package.json`

## Validation Commands

- `npm run perf:crawl-routes`
- `npm run build`
- `node --test test/review-workflow-contract.test.js`

## Validation Results

- Clean `HEAD` baseline with the same measurement script:
  - dev-server warm run: `/crawl` p50 69.1ms, p95 88.6ms; `/crawl-config` p50 70.1ms, p95 87.8ms
  - production preview 25-sample run: `/crawl` p50 70.0ms, p95 83.0ms; `/crawl-config` p50 69.7ms, p95 72.2ms
- Current optimized worktree:
  - production preview 25-sample run: `/crawl` p50 70.1ms, p95 78.0ms; `/crawl-config` p50 69.9ms, p95 72.2ms; browser route/render is stable while Tauri runtime initialization is lighter and delayed past first paint.
  - production build main JS chunk: 403.78 kB / gzip 123.34 kB, down from clean `HEAD` 460.75 kB / gzip 141.53 kB because the 61.04 kB CronLight chunk is no longer on the main route shell.
- `node --test test/review-workflow-contract.test.js`: 59 tests passed.
- `PORT=1434 npm run perf:crawl-routes:preview`: passed, including `npm run build`.
- `git diff --check`: passed.

## Risks

- 浏览器模式性能测试不能完全代表 Tauri IPC；若优化后 Tauri 仍慢，需要追加桌面端 trace 或临时 IPC timing。
- 采集页浏览器空日志场景基本持平；真实 Tauri 场景的收益来自减少并延后首帧 IPC。
- 初始化收窄不能影响定时采集启动和保存配置的实际 payload。
