# Boss 低风控采集模式设计

## Architecture

Boss 低风控改造跨四层：

1. Frontend configuration
   - 在 Boss 配置区增加 `bossLowRiskMode`，默认 `true`。
   - 保存到现有 collection config，不新增独立设置页。
   - 构建 Boss 任务 payload 时写入 `limits.lowRiskMode = true`，并在开启时应用保守上限。

2. Worker low-risk policy
   - 在 Boss auto worker 入口解析 `limits.lowRiskMode`。
   - 集中定义 Boss low-risk policy：
     - `maxPagesCap = 2`
     - `maxJobsCap = 50`
     - `delayMinMs = 8000`
     - `delayJitterMs = 12000`
     - `cooldownMs = 30 * 60 * 1000`
   - 低风控模式只影响 Boss，不改变智联、V2EX、LinuxDo。

3. Health check and cooldown
   - 采集前复用现有 Boss browser/profile 进入搜索页轻量检查。
   - 如果页面 URL 或响应显示登录/安全验证/风控，发出 `ERROR` 或 `LOGIN_STATUS`，停止 Boss run。
   - cooldown 使用 worker 进程内状态即可满足 MVP：同一 App 运行期间避免连续撞风控。
   - 后续如需要跨重启冷却，再考虑持久化到 settings 或 DB；本任务先不加 schema。

4. Existing persistence and post-collection flow
   - 不改 job 入库路径。
   - 不改 `collection_run_job` inserted-id AI 判断路径。
   - Boss 跳过或失败时，当前多源循环按现有逻辑计为 skipped source，后续平台继续执行。

## Data Flow

```text
CrawlConfig Boss low-risk fields
  -> buildTaskForSource("boss").limits.lowRiskMode
  -> crawl_auto_start creates collection_run
  -> worker runAutoMode detects Boss and applies low-risk policy
  -> preflight health check
      ok -> normal Boss list capture with conservative delays/caps
      blocked -> emit clear status/error and set cooldown
  -> sidecar records run failure/skipped outcome through existing ERROR path
  -> frontend skips post-collection AI if no newly inserted Boss jobs
```

## Contracts

- `limits.lowRiskMode?: boolean` is Boss-only.
- Low-risk mode must not override user-entered stricter values:
  - If user sets 1 page, keep 1.
  - If user sets 10 pages, cap to 2.
  - If user sets 20 max jobs, keep 20.
  - If user sets 200 max jobs, cap to 50.
- Low-risk mode must keep `bossDetailFetchLimit = 0`.
- Cooldown errors must be explicit and user-facing, e.g. `Boss 处于风控冷却中，预计 HH:mm 后再试。`
- Health check failures must not report a successful collection with only `FINISHED`.

## Compatibility

- Existing saved configs without `bossLowRiskMode` load as enabled.
- Users can turn low-risk mode off to restore previous higher-throughput behavior.
- Existing Boss profile/login flow remains unchanged.
- Existing source registry, job schema, and post-collection AI flow remain unchanged.

## Trade-offs

- Process-memory cooldown is simpler and avoids DB migration, but app restart clears cooldown. This is acceptable for MVP because the immediate pain is repeated retries in the same run/session.
- Conservative defaults reduce throughput. That is intentional; Boss is treated as high-risk compared with 智联/V2EX/LinuxDo.
- We avoid anti-detection techniques because they are brittle and create a maintenance/security risk.

## Rollback

- Disable default low-risk mode in frontend config and ignore `limits.lowRiskMode` in worker.
- Since no schema migration is required, rollback is code-only.
