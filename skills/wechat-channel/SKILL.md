---
name: wechat-channel
description: 用微信 iLink 渠道收发私信。用户要登录微信、回微信、把 Grok Bot 接到微信时使用。
---

# 微信渠道（iLink）

你通过 MCP `grok-wechat` 连接微信个人号。底层是腾讯 iLink（`ilinkai.weixin.qq.com`），和 OpenClaw 官方插件 `@tencent-weixin/openclaw-weixin` 同一条通道。

## 登录

1. 调用 `wechat_login_start`，把返回的 `image` 给用户看（链接或二维码图）。
2. 请用户用手机微信扫码并确认。
3. 反复调用 `wechat_login_wait`，直到 `logged_in=true`。
4. 二维码过期则重新 `wechat_login_start`。

登录态写在 `GROK_WECHAT_HOME`（默认 `~/.grok-wechat`，Grok Bot 电脑上建议 `/workspace/.grok-wechat`）。

## 自动值守（与 OpenClaw Gateway 同类效果）

通道建立后按这个循环工作：

1. `wechat_start_monitor` 启动后台长轮询（只启动一次）。
2. 建一条 Routine：持续或每分钟执行「处理微信收件箱」。
3. 每次：`wechat_wait`（或 `wechat_inbox`）取出用户私信。
4. 对每条消息：
   - `wechat_typing` `on=true`，`to_user_id` 用这条的 `from_user_id`
   - 用你的能力生成回复（查文件、上网、用其它插件）
   - `wechat_send` 纯文本回复，`to_user_id` 用同一用户
   - 需要发本地文件时用 `wechat_send_media`
   - `wechat_typing` `on=false`
5. 没有新消息就继续等，不要向用户报告空轮询。

没有 monitor 时，`wechat_wait` 自己做 35 秒长轮询，效果相同，只是 Routine 必须一直跑。

## 协议约定

- 只处理私信。入站 `from_user_id` 形如 `xxx@im.wechat`。
- 回复必须带该用户已缓存的 `context_token`。工具会自动带上；对方必须先从微信发过一条消息，通道才成立。
- 微信不渲染 Markdown。`wechat_send` 会转成纯文本，你直接写可读的中文即可。
- 单条文本最长约 4000 字，更长会自动拆条。
- `allow_from` 为空：接收全部私信。要限制发送者时用 `wechat_approve` 写入用户 ID。

## 状态

随时可用 `wechat_status` 看是否已登录、monitor 是否在跑、已建立会话的用户列表。
