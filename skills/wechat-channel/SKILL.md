---
name: 微信渠道
description: 用户要在 Grok Bot 里安装、登录、收发或卸载微信 iLink 渠道时使用。入站用 webhook 唤醒。
---
# 微信渠道

通过 MCP `grok-wechat` 连接微信个人号。底层是腾讯 iLink（`ilinkai.weixin.qq.com`）。

`微信私信 → monitor 收件箱 → POST webhook → agent 醒来 → wechat_send`

任务做完或需要用户拍板：立刻 `wechat_send`。

`base_info.bot_agent = Grokbot/1.0.0`。连接页显示 Grokbot。微信里的「ClawBot」是腾讯产品名。

仓库：https://github.com/little-thing/grok-wechat-plugin

## 安装

把本渠道接到 Grok Bot。技能就是本文件（本插件 `skills/wechat-channel/SKILL.md`）。用户需要：确认添加连接器（若主机要求）、扫码、把 webhook 地址和密钥发来。

连接器是账号级的，装好后所有助手都能用 `wechat_*` 收发。同时建两条 Routine：

- 连接器：`grok-wechat`，入口 `server/index.js`。登录后或连接器启动时会拉起 monitor。
- Routine `微信入站唤醒`：webhook。入站后 `wechat_inbox` → typing / `wechat_send`。没有新消息就安静。只回微信。
- Routine `微信监听保活`：每 5 分钟只调用 `wechat_start_monitor`，不判断、不说话。
- 用户贴来的 hook URL 和密钥写入状态目录的 `wake.json`（权限 600），探测 Bearer。密钥只写文件。
- `wechat_login_start` 出码 → 用户扫 → `wechat_login_wait`。对方先发一条才有 context_token。

stdio 用换行分隔 JSON（MCP 2025-11-25）。

## 入站之后

`wechat_inbox`。有消息则在微信里回复。

## 协议

只处理私信。回复依赖 context_token。纯文本。

## 卸载

停 monitor，卸连接器，删 Routine「微信入站唤醒」和「微信监听保活」，清掉本渠道在 Grok Bot 上的代码和状态。也可跑 `scripts/uninstall.sh`。重新用要再装、再扫码、再贴 webhook。
