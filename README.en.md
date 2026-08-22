# grok-wechat-plugin

[中文](README.md) | [English](README.en.md)

WeChat iLink channel for Grok Bot. Inbound messages wake the agent via webhook.

## One-line install

Send this in Grok Bot:

```
Install this WeChat plugin https://github.com/little-thing/grok-wechat-plugin
```

## Binding

Follow the conversation. The full flow looks like this:

![Install, confirm the channel, paste webhook once, scan QR](docs/bind-flow.png)

1. **Confirm the channel**  
   Tap **加** in the chat to attach the WeChat channel to Grok Bot.

2. **Connector and shared routines**  
   The installing assistant adds the WeChat connector and creates two routines: **「微信入站唤醒」** (webhook) and **「微信监听保活」** (every 5 minutes, `wechat_start_monitor`). Creating the webhook routine does not return url/key to the agent; the user copies them once from that routine's panel and sends them. The assistant calls `wechat_set_wake` to write global `wake.json` for all current and future bound accounts.

3. **Scan to log in**  
   `wechat_login_start` shows a QR code, then immediately `wechat_login_wait` until `logged_in=true`. Bind more accounts by repeating start and wait — no second webhook paste.

4. **Binding complete**  
   `wechat_status` shows `global_wake_configured=true`. Optional dedicated assistants per number can hand off by `ilink_bot_id`; they do not create inbound routines.

When someone DMs you on WeChat, the bot can reply there.

## After binding

Talk in WeChat as usual:

![Send a WeChat DM and get a reply](docs/bind-effect.png)

## Multiple accounts

One connector binds multiple WeChat personal accounts. One global webhook covers all of them; each new bind only needs a QR scan. `wechat_status` shows `global_wake_configured` and per-account status.

## Flow

WeChat DM → monitor inbox → POST shared webhook → installing assistant wakes → `wechat_inbox` → handle by `ilink_bot_id` → `wechat_send`

After a task finishes, call `wechat_send`.

`bot_agent` is `Grokbot/1.0.0`.

See `skills/wechat-channel/SKILL.md` for install details.

## Uninstall

Tell Grok Bot to uninstall the WeChat plugin. The installing assistant will:

1. Call `wechat_uninstall` to clean the machine (monitor, plugin dir, `/home/box/.grok-wechat`).
2. Remove the `grok-wechat` connector from Settings if it still exists.
3. Delete Routine「微信入站唤醒」and「微信监听保活」on the installing assistant, and remove any leftover copies on other assistants.

After a clean uninstall, reinstall requires a fresh webhook paste and QR scan; `wechat_status` shows zero accounts.
