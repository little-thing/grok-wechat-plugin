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

![Install, confirm the channel, scan the QR code, paste the webhook](docs/bind-flow.png)

1. **Confirm the channel**  
   Tap **加** in the chat to attach the WeChat channel to Grok Bot.

2. **Connector and routine**  
   The assistant adds the WeChat connector (available to every assistant) and creates Routine **「微信入站唤醒」** (webhook) and **「微信监听保活」** (every 5 minutes, only start the listener). Both show up under Routines.

3. **Scan to log in**  
   Scan the QR code in the chat with WeChat on your phone. To bind another WeChat account, request a new QR code and scan again; existing accounts stay online.

4. **Paste the webhook**  
   Open the settings for Routine「微信入站唤醒」, copy the **webhook URL** and **secret**, and paste them back. After a successful probe, the channel is ready.

When someone DMs you on WeChat, the bot can reply there.

## After binding

Talk in WeChat as usual:

![Send a WeChat DM and get a reply](docs/bind-effect.png)

## Multiple accounts

One connector can bind multiple WeChat personal accounts. Each person scans independently; `wechat_status` lists all bound accounts. Inbound messages include `ilink_bot_id`; reply with `wechat_send` using the same account.

## Flow

WeChat DM → monitor inbox → POST webhook → agent wakes → `wechat_send`

After a task finishes, call `wechat_send`.

`bot_agent` is `Grokbot/1.0.0`.

See `skills/wechat-channel/SKILL.md` for install details.

## Uninstall

Tell Grok Bot to uninstall the WeChat plugin.
