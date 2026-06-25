# LinuxDo 登录验证页修复

## Goal

让 LinuxDo 登录/验证流程在当前电脑上真正可用：用户点“打开”后能进入可人工完成验证的浏览器窗口，完成 Cloudflare / 登录验证后，应用能正确识别“已可采集”的状态并把会话资料写回本地，避免一直停在验证页或把已可用状态误判为未登录。

## User Value

- 用户已经有 LinuxDo 权限，但当前浏览器窗口停在 Cloudflare 验证页，导致采集态不稳定。
- 用户需要一个可重复的登录/验证入口，而不是只能看到“未登录”或无限等待。
- 采集链路要复用同一个 LinuxDo profile，不再依赖单一 cookie 名称或页面标题来判断成功。

## Requirements

- LinuxDo 登录按钮要打开可交互的浏览器窗口，并保留当前 profile。
- 登录状态判定不能只靠某个 cookie 名称，必须结合页面上下文是否已能访问 LinuxDo Discourse JSON。
- 如果当前是 Cloudflare 验证页，应用要明确告诉用户“正在验证”，而不是假装登录失败或自动关窗。
- 一旦验证通过，应用要写回 LinuxDo 会话资料并把状态更新为可采集。
- LinuxDo 采集仍然必须能复用同一 profile，并在登录成功后继续抓取更高权限内容。

## Acceptance Criteria

- [ ] 点 LinuxDo“打开”后会拉起可交互浏览器窗口，且窗口保持当前 LinuxDo profile。
- [ ] 在 Cloudflare 验证页时，应用明确显示“验证中/请继续完成验证”，不会立即结束为失败。
- [ ] 验证通过后，LinuxDo 登录状态刷新为已登录或已可采集。
- [ ] 登录成功后，本地 LinuxDo 会话资料可被后续采集复用。
- [ ] 真实 smoke 能证明：同一 profile 下，登录/验证后可以读取 LinuxDo 分类 JSON，而不是只停在验证页。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- This task is a child of `06-22-linuxdo-auto-collection` and should stay scoped to login/verification behavior.
