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

![在 Grok Bot 里安装、确认渠道、粘贴一次 webhook、扫码](docs/bind-flow.png)

1. **确认添加渠道**  
   对话里会出现「加」按钮，点一下，把微信渠道接到 Grok Bot。

2. **连接器与共用 Routine**  
   安装助手加上微信连接器，并创建两条 Routine：**「微信入站唤醒」**（Webhook）与 **「微信监听保活」**（每 5 分钟 `wechat_start_monitor`）。webhook Routine 创建后平台不把 url/key 返回给 agent；用户从该 Routine 面板复制地址与密钥发来**一次**，安装助手 `wechat_set_wake` 写入全局 `wake.json`，当前及后续绑定账号共用。

3. **扫码登录微信**  
   `wechat_login_start` 出码 → 立即 `wechat_login_wait` 至 `logged_in=true`。绑定更多账号时重复出码与等待，**无需**再粘贴 webhook。

4. **绑定完成**  
   `wechat_status` 显示 `global_wake_configured=true`。可选为各号建专属助手按 `ilink_bot_id` 分流，专属助手不再建入站 Routine。

对方给你发一条微信私信，就能在微信里收到回复。

## 绑定后的效果

在微信里直接说话即可，例如：

![微信里发私信，助手立刻回复](docs/bind-effect.png)

## 多账号

一个连接器可绑定多个微信个人号。全局 webhook 覆盖全部账号；每人独立扫码，后续绑定不再粘贴。`wechat_status` 查看 `global_wake_configured` 与各账号。

## 链路

微信私信 → monitor 收件箱 → POST 共享 webhook → 安装助手醒来 → `wechat_inbox` → 按 `ilink_bot_id` 处理 → `wechat_send`

任务做完立刻 `wechat_send`。

`bot_agent` 为 `Grokbot/1.0.0`。

安装细节见 `skills/wechat-channel/SKILL.md`。

## 卸载

跟 Grok Bot 说「卸掉微信插件」。安装助手会：

1. 调用 `wechat_uninstall` 清理本机（monitor、插件目录、`/home/box/.grok-wechat`）。
2. 从 Settings 卸载 `grok-wechat` 连接器（若仍存在）。
3. 删除安装助手上 Routine「微信入站唤醒」与「微信监听保活」，并删除其他助手上残留的同名 Routine。

完成后重装需重新粘贴 webhook 并扫码，`wechat_status` 为零账号。
