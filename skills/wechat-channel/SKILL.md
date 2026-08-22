---
name: 微信渠道
description: 用户要在 Grok Bot 里安装、登录、收发或卸载微信 iLink 渠道时使用。入站用 webhook 唤醒。
---
# 微信渠道

通过 MCP `grok-wechat` 连接微信个人号。底层是腾讯 iLink（`ilinkai.weixin.qq.com`）。

`微信私信 → monitor 收件箱 → POST 该号专属 webhook → 专属助手醒来 → wechat_send`

任务做完或需要用户拍板：立刻 `wechat_send`。

`base_info.bot_agent = Grokbot/1.0.0`。连接页显示 Grokbot。微信里的「ClawBot」是腾讯产品名。

仓库：https://github.com/little-thing/grok-wechat-plugin

## 安装

把本渠道接到 Grok Bot。技能就是本文件（本插件 `skills/wechat-channel/SKILL.md`）。

连接器是账号级的，所有助手共用 `grok-wechat` 连接器（入口 `server/index.js`）。每个扫码绑定的微信个人号配一个专属 Grok Bot 助手。

### 每次扫码绑定后的流程

1. `wechat_login_start` 出码 → 用户扫码 → `wechat_login_wait`。
2. 绑定成功后 `wechat_login_wait` 返回该账号的 `ilink_bot_id`、`ilink_user_id`。
3. 为该微信用户**创建专属助手**。
4. 在该助手下创建 Routine **「微信入站唤醒」**（webhook）。入站后 `wechat_inbox` → typing / `wechat_send`，只处理该号的私信。
5. 调用 `wechat_set_wake`，传入该账号的 `ilink_bot_id` 与该 Routine 的 webhook 地址和密钥。配置写入 `account.json`（权限 600），并探测 Bearer。
6. 该微信号的入站只 POST 该助手的 webhook；其他已绑定号不受影响。

### 共用配置

- Routine **「微信监听保活」**：每 5 分钟，任意一个助手或安装助手执行即可。提示词：`只调用 wechat_start_monitor，确保微信入站监听在跑。除此之外什么都不要做。` 一次调用为所有已绑定账号拉起 monitor。
- 若某账号未配置专属 wake，`wake.json`（权限 600）作为回退 webhook。

stdio 用换行分隔 JSON（MCP 2025-11-25）。

## 多账号绑定

一个连接器可绑定多个微信个人号，每人独立扫码、独立专属助手：

1. 第一个人扫码绑定 → 创建助手 A → `wechat_set_wake` 绑定 A 的 webhook。
2. 第二个人再次 `wechat_login_start` 拿新码 → 扫码 → 创建助手 B → `wechat_set_wake` 绑定 B 的 webhook；A 保持在线。
3. `wechat_status` 列出所有已绑定账号及各自是否已配置专属 wake（`has_wake`）。
4. monitor 为每个已绑定账号并发长轮询；入站消息带 `ilink_bot_id`，只唤醒对应助手的 webhook。
5. 专属助手回复时用入站消息里的 `to_user_id` 和 `ilink_bot_id` 调用 `wechat_send` / `wechat_typing` / `wechat_send_media`。
6. `wechat_logout` 默认登出全部；传 `ilink_bot_id` 只登出一个。

## 入站之后

`wechat_inbox`。有消息则在微信里回复。每条消息含 `ilink_bot_id`、`from_user_id`。用同一 `ilink_bot_id` 回复该用户。语音按转写文本处理，用 `wechat_send` 回文字。

## 协议

只处理私信。回复依赖 context_token。文字和语音转写都当文本，用 `wechat_send` 回文字。

## 卸载

停 monitor，卸连接器，删各助手下的 Routine「微信入站唤醒」和共用「微信监听保活」，清掉本渠道在 Grok Bot 上的代码和状态。也可跑 `scripts/uninstall.sh`。重新用要再装、再扫码、再配 webhook。
