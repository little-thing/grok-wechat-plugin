# grok-wechat

给 Grok Bot 用的微信渠道插件。底层是腾讯官方 iLink Bot API（`ilinkai.weixin.qq.com`），和 OpenClaw 的 `@tencent-weixin/openclaw-weixin` 同一套协议：扫码登录、长轮询收私信、`context_token` 回发、CDN 媒体、正在输入。

需要本机 Node 18+。无第三方 npm 依赖。

## 装到 Grok Bot

1. 把整个 `grok-wechat-plugin` 目录拷到 Grok Bot 电脑，例如 `/workspace/grok-wechat-plugin`。
2. Grok Bot → **Settings → Plugins → Add**，新增 MCP：
   - command: `node`
   - args: `/workspace/grok-wechat-plugin/server/index.js`
   - 环境变量（建议）：`GROK_WECHAT_HOME=/workspace/.grok-wechat`
3. 在对话里 `@` 这个 connector，对 Bot 说：「登录微信，然后值守私信并回复」。
4. 扫码完成后，建一条 Routine：持续处理微信收件箱（skill `wechat-channel` 里写了循环）。

也可以链到 Cursor 本机：`ln -s /绝对路径/grok-wechat-plugin ~/.cursor/plugins/local/grok-wechat`，再 Reload Window。Grok Bot 读不到这台 Mac 的本地目录，云端 Bot 仍要按上面 1–2 步加 MCP。

## 效果对应

| OpenClaw | 本插件 |
|---|---|
| 扫码 `channels login` | `wechat_login_start` + `wechat_login_wait` |
| Gateway sidecar 长轮询 | `wechat_start_monitor` 或 Routine 里 `wechat_wait` |
| 入站路由到 Agent | Routine 取消息后由 Grok Bot 推理 |
| `sendmessage` + context_token | `wechat_send` / `wechat_send_media` |
| 正在输入 | `wechat_typing` |
| pairing allowlist | `wechat_approve` |

登录成功后，对方必须先从微信给你发一条消息，才能回得回去（iLink 用这条消息发放 `context_token`）。
