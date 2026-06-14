# Tauri dev 启动复验

## Goal

补强 `docs/job-sync-requirements-coverage.md` 中总体验收第 3 项的当前轮证据：复验 `npm run tauri:dev` 能启动 Vue 前端、Rust Tauri dev shell，并完成开发态 worker 构建前置步骤。

## Requirements

- 只做本机开发启动复验和证据记录，不修改业务功能。
- 命令输出需要能证明 `beforeDevCommand` 至少完成 worker build 并启动 Vite dev server。
- Rust/Tauri dev shell 需要编译并启动到可观察状态；复验结束后必须中断，不留下后台 dev server 或 Tauri 进程。
- 不依赖真实 Boss 登录、不触发采集、不触发自动投递、开聊或企业微信发送。
- 更新覆盖审计和 Phase 0 baseline，准确区分已复验的开发启动链路与仍需用户凭据的外部依赖实测。

## Acceptance Criteria

- [x] `npm run tauri:dev` 在当前工作树启动，输出 worker build、Vite dev server 和 Rust/Tauri dev shell 编译/启动证据。
- [x] 复验后没有遗留 `npm run tauri:dev` 相关后台会话。
- [x] `docs/job-sync-requirements-coverage.md` 的总体验收第 3 项不再写“当前轮尚未重新执行完整 Tauri dev”。
- [x] `docs/job-sync-phase0-baseline.md` 记录本次 dev 启动复验证据和边界。
- [x] 不新增或修改自动投递、自动开聊、自动发送消息能力。

## Verification

- `npm run tauri:dev` passed the startup smoke: `beforeDevCommand` ran `npm run build:worker && npm run dev`, Vite served `http://localhost:1430/`, Rust finished the dev profile build, and Tauri ran `target/debug/job-sync`.
- Manual interrupt stopped the dev session; `lsof -nP -iTCP:1430 -sTCP:LISTEN` returned no listener, and process search found no `tauri dev`, `target/debug/job-sync`, `npm run dev`, or `vite` process.
- `npm run test:worker` passed 12 tests, including the local Node worker lifecycle test for startup, `STOP received`, `FINISHED`, and zero exit.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
