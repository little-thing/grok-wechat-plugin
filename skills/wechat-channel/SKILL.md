---
name: 微信渠道
description: 用户要在 Grok Bot 里安装、登录、收发或卸载微信 iLink 渠道时使用。从 GitHub 一句话安装，入站用 webhook 唤醒。
---
# 微信渠道（iLink + Webhook）

通过 MCP `grok-wechat` 连接微信个人号。底层是腾讯 iLink（`ilinkai.weixin.qq.com`）。

链路：

`微信私信 → iLink 长轮询 monitor → 收件箱 → POST webhook → 本 agent 醒来 → wechat_send`

任务做完或需要用户拍板：立刻 `wechat_send`。

`base_info.bot_agent = Grokbot/1.0.0`。连接页显示 Grokbot。微信里的「ClawBot」是腾讯产品名。

状态目录：`GROK_WECHAT_HOME`（默认 `/home/box/.grok-wechat`）。
Webhook 地址和密钥只写在 `$GROK_WECHAT_HOME/wake.json`（权限 600）。

仓库：https://github.com/little-thing/grok-wechat-plugin

## 安装

用户说「安装这个微信插件」并给出本仓库 URL（或 URL 已知）时，按顺序做。需要用户的步骤：确认添加 MCP（若主机要求）、扫码、把 webhook 地址和密钥发来。

### A. 代码

1. 读本 SKILL（本文件或 raw GitHub）。
2. 把本仓库下载到 `/home/box/grok-wechat-plugin`（优先 GitHub zip；也可用 `gh`/`git` clone 到同一路径）。目录已存在则复用或覆盖刷新。源是这个 GitHub 仓库。

### B. MCP

1. 添加本地 MCP `grok-wechat`：`/usr/bin/node` + `/home/box/grok-wechat-plugin/server/index.js`，env `GROK_WECHAT_HOME=/home/box/.grok-wechat`。改账号配置时先让用户确认。
2. stdio 用换行分隔 JSON（MCP 2025-11-25）。
3. connector 说明：登录出码、webhook 入站、回复走微信、任务完成立刻 `wechat_send`。

### C. Routine

建一条 webhook Routine，名叫 `微信入站唤醒`。

Prompt：入站后 `wechat_status` → 保证 monitor 在跑 → `wechat_inbox` → 逐条 typing / 回复 / `wechat_send`。没有新消息就安静。只回微信。

### D. Webhook 地址（用户）

请用户打开「微信入站唤醒」，启用后把 hook URL 和密钥发到对话。写入 `wake.json`，探测 Bearer。密钥只写文件。

### E. 扫码（用户）

`wechat_login_start`（POST，带 bot_agent）出码 → 用户扫 → `wechat_login_wait`。过期则重新出码。

### F. 通道

`wechat_start_monitor`。通知用户可以微信说话。对方先发一条才有 context_token。

## 入站之后

`wechat_inbox`。有消息则在微信里回复。

## 协议

只处理私信。回复依赖 context_token。纯文本。

## 卸载

用户说卸载时做完这些：

1. 停 monitor：`$GROK_WECHAT_HOME/monitor.pid` 里的进程，以及 `grok-wechat-plugin/server/index.js --monitor`。
2. `UninstallMcpServer`，server_id 一般是 `user-grok-wechat`。
3. 删 Routine「微信入站唤醒」。
4. 删 `/home/box/grok-wechat-plugin`、`$GROK_WECHAT_HOME`、`/workspace/grok-wechat-plugin`。

也可跑 `scripts/uninstall.sh`。卸完说明：重新用要再装、再扫码、再贴 webhook。
