# grok-wechat-plugin

[中文](README.md) | [English](README.en.md)

WeChat iLink channel for Grok Bot. Inbound messages wake the agent via webhook, not a polling schedule.

## One-line install

Send this in Grok Bot:

```
Install this WeChat plugin https://github.com/little-thing/grok-wechat-plugin
```

You only scan the WeChat QR code, then paste the webhook URL and secret from the Routine named `微信入站唤醒`. The agent does the rest.

## For the installing agent

Fetch and follow this repo's `skills/wechat-channel/SKILL.md` exactly (raw: https://raw.githubusercontent.com/little-thing/grok-wechat-plugin/main/skills/wechat-channel/SKILL.md).

Do not ask the user to copy files, fill in MCP JSON, or create a "scan inbox every minute" Routine.

1. Download this repo to `/home/box/grok-wechat-plugin` on the Grok Bot machine (prefer the GitHub zip; do not download it to the user's computer).
2. `AddMcpServer`: `/usr/bin/node` + absolute path to `server/index.js`, env `GROK_WECHAT_HOME=/home/box/.grok-wechat`.
3. Create exactly one webhook Routine named `微信入站唤醒`.
4. The user pastes the hook URL and secret → write `wake.json` (chmod 600), probe Bearer, and never echo the secret.
5. `wechat_login_start` shows a QR code → user scans → `wechat_login_wait` → `wechat_start_monitor`.

stdio uses newline-delimited JSON (MCP 2025-11-25). `bot_agent` must be `Grokbot/1.0.0`.

## Flow

WeChat DM -> iLink long-poll monitor -> inbox -> POST webhook -> agent wakes -> wechat_send

After a task finishes, call wechat_send immediately. Do not go through the webhook.

## Uninstall

Tell Grok Bot to uninstall the WeChat plugin. Settings only removes MCP. A full uninstall: stop the monitor, remove MCP, delete the Routine, and delete the plugin directory plus `/home/box/.grok-wechat` on the Grok Bot machine. Leave the user's GitHub repo and local source alone. You can also run `scripts/uninstall.sh`.
