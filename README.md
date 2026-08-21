# grok-wechat-plugin

[中文](README.md) | [English](README.en.md)

Grok Bot 的微信 iLink 渠道。入站消息经 webhook 唤醒 agent。

## 一句话安装

在 Grok Bot 里发：

```
安装这个微信插件 https://github.com/little-thing/grok-wechat-plugin
```

扫微信码，再把 Routine「微信入站唤醒」里的 webhook 地址和密钥贴回去。

安装说明见 `skills/wechat-channel/SKILL.md`。

## 链路

微信私信 → monitor 收件箱 → POST webhook → agent 醒来 → `wechat_send`

任务做完立刻 `wechat_send`。

`bot_agent` 为 `Grokbot/1.0.0`。

## 卸载

跟 Grok Bot 说「卸掉微信插件」。
