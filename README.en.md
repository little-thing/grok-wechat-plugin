# grok-wechat-plugin

[中文](README.md) | [English](README.en.md)

WeChat iLink channel for Grok Bot. Inbound messages wake the agent via webhook.

## One-line install

Send this in Grok Bot:

```
Install this WeChat plugin https://github.com/little-thing/grok-wechat-plugin
```

Scan the WeChat QR code, then paste the webhook URL and secret from Routine `微信入站唤醒`.

See `skills/wechat-channel/SKILL.md`.

## Flow

WeChat DM → monitor inbox → POST webhook → agent wakes → `wechat_send`

After a task finishes, call `wechat_send`.

`bot_agent` is `Grokbot/1.0.0`.

## Uninstall

Tell Grok Bot to uninstall the WeChat plugin.
