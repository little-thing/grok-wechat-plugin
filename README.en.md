# grok-wechat-plugin

[中文](README.md) | [English](README.en.md)

WeChat iLink channel for Grok Bot. Inbound messages wake the agent via webhook.

## One-line install

Send this in Grok Bot:

```
Install this WeChat plugin https://github.com/little-thing/grok-wechat-plugin
```

Scan the WeChat QR code, then paste the webhook URL and secret from the Routine `微信入站唤醒`. The agent does the rest.

## For the installing agent

Read and follow `skills/wechat-channel/SKILL.md` (raw: https://raw.githubusercontent.com/little-thing/grok-wechat-plugin/main/skills/wechat-channel/SKILL.md).

1. Download this repo to `/home/box/grok-wechat-plugin` on the Grok Bot machine (prefer the GitHub zip).
2. `AddMcpServer`: `/usr/bin/node` + absolute path to `server/index.js`, env `GROK_WECHAT_HOME=/home/box/.grok-wechat`.
3. Create the webhook Routine `微信入站唤醒`.
4. The user pastes the hook URL and secret → write `wake.json` (chmod 600), probe Bearer; keep the secret in the file only.
5. `wechat_login_start` shows a QR code → user scans → `wechat_login_wait` → `wechat_start_monitor`.

stdio uses newline-delimited JSON (MCP 2025-11-25). `bot_agent` is `Grokbot/1.0.0`.

## Flow

WeChat DM → iLink long-poll monitor → inbox → POST webhook → agent wakes → `wechat_send`

After a task finishes, call `wechat_send` immediately.

## Uninstall

Tell Grok Bot to uninstall the WeChat plugin: stop the monitor, remove MCP, delete Routine `微信入站唤醒`, and delete the plugin directory plus `/home/box/.grok-wechat` on the Grok Bot machine. You can also run `scripts/uninstall.sh`.
