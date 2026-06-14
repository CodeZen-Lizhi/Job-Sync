# 外部依赖诊断摘要复制

## Goal

让设置页外部依赖诊断结果可以被用户复制为脱敏验收摘要，方便在真实 Boss 登录态、模型服务或企业微信配置可用时记录证据，同时保持当前人工触发和不泄露敏感值的边界。

## Requirements

- 在设置页诊断结果出现后，提供复制诊断摘要入口。
- 复制内容应包含检查时间、Boss 登录态、模型服务和企业微信配置的状态摘要。
- 复制内容不得包含 API Key、Webhook URL、Cookie、LocalStorage 或其他 secret 原文。
- 复制动作只能写入剪贴板，不得触发采集、投递、开聊或企业微信发送。
- 若诊断尚未运行，不显示或不允许复制入口。

## Acceptance Criteria

- [x] 设置页外部依赖诊断结果区域出现后可以复制脱敏摘要。
- [x] 摘要包含三类依赖状态和必要人工边界说明，不包含 secret 字段或原始敏感值。
- [x] 契约测试覆盖复制入口、脱敏摘要和 Settings 页不触发企业微信发送命令。
- [x] 相关前端/契约验证通过。

## Notes

- 这是父任务 `06-13-job-sync-second-dev` 的收口增强；不改变诊断 IPC 响应结构。
- 真实外部依赖成功与否仍取决于用户本机登录态、模型服务和 webhook 配置，本任务只补证据复制能力。

## Verification

- `npm run test:review-workflow` 通过，43 项 contract 测试全部通过。
- `npm run build` 通过，完成 `vue-tsc --noEmit` 和 Vite build；Vite 仅保留既有主 chunk 超过 500KB 提示。
- Browser 打开 `http://127.0.0.1:1430/#/settings` 通过，桌面 1280px 和移动 390px 均能渲染外部依赖诊断区域，无 console warn/error，390px 下无横向溢出。
- `npm run test` 通过，43 项 review workflow 和 12 项 worker 测试全部通过。
- `git diff --check -- ':!package-lock.json'` 通过。
