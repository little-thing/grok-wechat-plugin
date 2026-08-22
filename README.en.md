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

![Install, confirm the channel, scan the QR code, dedicated assistant self-binds webhook](docs/bind-flow.png)

1. **Confirm the channel**  
   Tap **加** in the chat to attach the WeChat channel to Grok Bot.

2. **Connector and dedicated assistants**  
   The installing assistant adds the shared WeChat connector and one shared Routine **「微信监听保活」** (every 5 minutes, `wechat_start_monitor`). After each QR bind, it creates a **dedicated assistant** for that WeChat user, passes `ilink_bot_id` to it, and that assistant creates Routine **「微信入站唤醒」** (webhook) and calls `wechat_set_wake` with its own Routine URL and key.

3. **Scan to log in**  
   The installing assistant calls `wechat_login_start` to show a QR code, then immediately calls `wechat_login_wait` in a loop until `logged_in=true`. For another account, repeat start and wait, then create another dedicated assistant and complete self-bind.

4. **Binding complete**  
   `wechat_status` shows `has_wake=true` for that account. DMs to that WeChat number wake only its dedicated assistant.

When someone DMs you on WeChat, the bot can reply there.

## After binding

Talk in WeChat as usual:

![Send a WeChat DM and get a reply](docs/bind-effect.png)

## Multiple accounts

One connector can bind multiple WeChat personal accounts. Each bind gets its own dedicated assistant and webhook via `wechat_set_wake`. DMs to account A wake only assistant A; B is unchanged. `wechat_status` lists all accounts and `has_wake`.

## Flow

WeChat DM → monitor inbox → POST that account's webhook → dedicated assistant wakes → `wechat_send`

After a task finishes, call `wechat_send`.

`bot_agent` is `Grokbot/1.0.0`.

See `skills/wechat-channel/SKILL.md` for install details.

## Uninstall

Tell Grok Bot to uninstall the WeChat plugin. The assistant will:

1. Call `wechat_uninstall` (or run `scripts/uninstall.sh`) to clean the machine: stop the monitor, remove `/home/box/grok-wechat-plugin` and `/home/box/.grok-wechat` (account tokens, wake config, autostart scripts).
2. Remove the `grok-wechat` connector from Settings if it is still installed. Uninstalling from Settings alone also triggers automatic local cleanup when the MCP process exits and when the monitor detects the connector is gone.
3. Delete Routine「微信入站唤醒」and「微信监听保活」on **every** assistant, and notify any other assistants that still have them (e.g. 测试1, 微信小助手).
4. Remove WeChat routines from dedicated assistants created per QR bind.

After a clean uninstall, reinstall requires a fresh QR scan and `wechat_status` shows zero accounts.
