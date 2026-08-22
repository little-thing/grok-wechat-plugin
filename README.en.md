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
   `wechat_login_start` shows a QR code, then immediately `wechat_login_wait` until `logged_in=true`. After each bind, **create a dedicated Grok Bot assistant** for that WeChat number and call `wechat_set_dedicated_assistant` with its id and name; dedicated assistants do not create inbound routines. Bind more accounts by repeating start and wait — no second webhook paste.

4. **Binding complete**  
   `wechat_status` shows `global_wake_configured=true` and each account's `dedicated_assistant_name`. Inbound: installing assistant `wechat_inbox`, then forwards by `ilink_bot_id` to that account's dedicated assistant.

When someone DMs you on WeChat, the bot can reply there.

## After binding

Talk in WeChat as usual:

![Send a WeChat DM and get a reply](docs/bind-effect.png)

## Multiple accounts

One connector binds multiple WeChat personal accounts. One global webhook covers all of them; each new bind gets its own QR scan and dedicated assistant. `wechat_status` shows `global_wake_configured` and per-account dedicated assistant names.

## Flow

WeChat DM → monitor inbox → POST shared webhook → installing assistant wakes → `wechat_inbox` → forward by `ilink_bot_id` to dedicated assistant → `wechat_send`

After a task finishes, call `wechat_send`.

`bot_agent` is `Grokbot/1.0.0`.

See `skills/wechat-channel/SKILL.md` for install details.

## Uninstall

Tell Grok Bot to uninstall the WeChat plugin. The installing assistant will:

1. Call `wechat_uninstall` to clean the machine and read `dedicated_assistants_sidebar_delete` for dedicated assistant names.
2. Remove the `grok-wechat` connector from Settings if it still exists.
3. Delete Routine「微信入站唤醒」and「微信监听保活」on the installing assistant, and remove any leftover copies on other assistants.
4. Tell the user to right-click → Delete the dedicated assistants listed in the uninstall response (e.g. 微信1, 微信2) in the sidebar.

After a clean uninstall, reinstall requires a fresh webhook paste and QR scan; `wechat_status` shows zero accounts.
