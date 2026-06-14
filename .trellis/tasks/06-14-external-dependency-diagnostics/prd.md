# 外部依赖诊断面板

## Goal

补齐 `docs/job-sync-requirements-coverage.md` 中外部依赖实测的操作入口：在设置页提供本地诊断面板，让用户能在拥有本机 Boss 登录态、模型服务或企业微信配置时自行验证依赖状态，并得到可记录的明确结果。

## Requirements

- 诊断必须 local-first，不把 API Key、Webhook、Cookie 或 LocalStorage 明文回显到 UI。
- 模型供应商诊断应复用现有 OpenAI Compatible / DeepSeek / Ollama 配置，优先通过模型列表请求验证 Base URL、API Key/环境变量和本地服务状态。
- Boss 登录诊断应读取本地 Cookie 与 LocalStorage 存在性，帮助确认人工登录是否可被后续采集复用。
- 企业微信诊断至少要展示是否存在已保存 Webhook；若提供发送测试能力，必须由用户手动点击触发，不能在页面加载、保存或其他流程中自动发送。
- 诊断结果要有成功/失败状态、时间和简短原因，便于更新需求覆盖审计。
- 不新增自动投递、自动开聊、自动群发或绕过平台风控行为。

## Acceptance Criteria

- [x] 设置页新增外部依赖诊断区域，展示 Boss 登录、模型服务、企业微信通知的诊断状态。
- [x] 模型服务诊断可在未保存新 Key 时使用已保存 Key、环境变量或本地 Ollama dummy key，成功时显示可访问模型数，失败时显示明确错误。
- [x] Boss 登录诊断区分 Cookie 和 LocalStorage 是否同时存在，不展示具体敏感内容。
- [x] 企业微信诊断不自动发送消息，且 UI 文案保持“手动通知入口，不自动投递”边界。
- [x] Rust/contract/前端验证覆盖新增命令和 UI 文案，确保敏感值不回显。

## Verification

- `npm run build` passed; Vite only reported the existing main chunk size warning.
- `npm run test:review-workflow` passed; covers command registration, manual trigger, redaction copy, and no automatic WeCom send action.
- `npm run test` passed; includes review workflow and worker tests.
- `cargo test --manifest-path src-tauri/Cargo.toml` passed; covers Boss session and WeCom diagnostic helpers.
- Browser smoke at `http://127.0.0.1:1430/#/settings` passed for desktop and 390px mobile width; external dependency diagnostics section rendered with no console warn/error or horizontal overflow.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
