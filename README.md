# grok-wechat-plugin

[中文](README.md) | [English](README.en.md)

Grok Bot 的微信 iLink 渠道。入站消息经 webhook 唤醒 agent。

## 一句话安装

在 Grok Bot 里发：

```
安装这个微信插件 https://github.com/little-thing/grok-wechat-plugin
```

## 绑定流程

按对话一步走完即可，整段过程如下：

![在 Grok Bot 里安装、确认渠道、扫码、回贴 webhook](docs/bind-flow.png)

1. **确认添加渠道**  
   对话里会出现「加」按钮，点一下，把微信渠道接到本机。

2. **自动建好连接器与例行任务**  
   助手会加上微信连接器，并创建 Routine **「微信入站唤醒」**（触发条件：当 Webhook 被触发时）。右侧「例行任务」列表里能看到它。

3. **扫码登录微信**  
   对话里会出一张二维码，用手机微信扫码确认绑定。

4. **回贴 webhook**  
   打开 Routine「微信入站唤醒」的设置，把 **webhook 地址** 和 **密钥** 贴回对话。助手写入配置并探测连通后，会提示渠道已可用。

对方给你发一条微信私信，就能在微信里收到回复。

## 绑定后的效果

在微信里直接说话即可，例如：

![微信里发私信，助手立刻回复](docs/bind-effect.png)

## 链路

微信私信 → monitor 收件箱 → POST webhook → agent 醒来 → `wechat_send`

任务做完立刻 `wechat_send`。

`bot_agent` 为 `Grokbot/1.0.0`。

安装细节见 `skills/wechat-channel/SKILL.md`。

## 卸载

跟 Grok Bot 说「卸掉微信插件」。
