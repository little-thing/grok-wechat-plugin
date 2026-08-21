---
name: 微信渠道
description: 把 Grok Bot 接到微信 iLink 私信。用户要安装、登录、用微信对话或任务完成推送时使用。入站用 webhook 唤醒，不要用定时扫描。
---
# 微信渠道（iLink + Webhook）

你通过 MCP `grok-wechat` 连接微信个人号。底层是腾讯 iLink（`ilinkai.weixin.qq.com`）。

**入站唤醒必须走 Webhook，禁止建「每分钟 / 每 2 分钟处理收件箱」这类定时 Routine。**
Grok Bot 没有原生「微信消息」触发器。正确链路是：

`微信 → iLink 长轮询 monitor → 收件箱 → POST webhook → 本 agent 醒来 → 回复微信`

任务做完、需要用户拍板：你已经醒着，立刻 `wechat_send`，不走 webhook。

身份字段：`base_info.bot_agent = Grokbot/1.0.0`。连接页应显示 Grokbot，不是 OpenClaw。微信里「ClawBot」是腾讯产品名，改不了。

状态目录：`GROK_WECHAT_HOME`（Grok Bot 的电脑上默认 `/home/box/.grok-wechat`）。
Webhook 地址和密钥只写在 `$GROK_WECHAT_HOME/wake.json`（权限 600），不要写进仓库、不要回显到聊天。

## 安装

**触发：** 用户说「安装 / 装上」并给出本仓库 GitHub URL（`https://github.com/little-thing/grok-wechat-plugin`），或 URL 已在上下文中。

按顺序由 agent 执行。仅在主机要求确认 AddMcpServer、用户扫码、粘贴 webhook URL+key 时停下来请用户操作。

### a. 加载本 SKILL

若尚未加载，先 fetch 本文件（raw 或仓库内 `skills/wechat-channel/SKILL.md`），再开始安装。

### b. 把代码放到 Grok Bot 的电脑

目标路径：`/home/box/grok-wechat-plugin`。

- 优先从 GitHub 下载仓库 zip（`https://github.com/little-thing/grok-wechat-plugin/archive/refs/heads/main.zip`），解压到该目录；`git clone` 也可，但仅在 Grok Bot 的电脑上有 `git`/`gh` 时使用。
- **不要** clone 或拷贝到用户的个人电脑（Webstorm 工程等）。
- 目录已存在则复用或刷新内容。

### c. 注册本地 MCP

`AddMcpServer`：

- name: `grok-wechat`
- command: `/usr/bin/node`
- args: `/home/box/grok-wechat-plugin/server/index.js`（绝对路径）
- env: `GROK_WECHAT_HOME=/home/box/.grok-wechat`

stdio 用换行分隔 JSON（MCP 2025-11-25），不要 Content-Length。若主机要求账号变更确认，先与用户确认再添加。

### d. 建立 Webhook Routine

只建一条，名叫 `微信入站唤醒`，trigger 只能是 webhook。删除残留的「每分钟 / 定时处理收件箱」类 Routine。

Routine prompt：入站后 `wechat_status` → 保证 monitor → `wechat_inbox` → 逐条 typing / 回复 / send。空则安静。只回微信。

### e. Webhook 配置（需用户）

请用户打开「微信入站唤醒」，确认 Webhook 已启用，把 hook URL 和密钥发到对话。写入 `$GROK_WECHAT_HOME/wake.json`（mode 600），用 Bearer 探测连通性。**不要把密钥回显到聊天。**

### f. 扫码登录（需用户）

`wechat_login_start`（POST，带 `bot_agent`）出码 → 用户扫微信 → `wechat_login_wait`。过期则重新出码。

### g. 启动 monitor

`wechat_start_monitor`，确认已登录，告知用户可以在微信里对话。对方需先发一条消息才有 `context_token`。

## 入站唤醒后

`wechat_inbox`；空则安静。有消息则微信里直接回。不要把用户赶回 App。

## 协议

只处理私信。回复依赖 context_token。纯文本。不要用定时 Routine 当修复。

## 卸载

Settings 或 `UninstallMcpServer` 只摘掉 MCP 注册，不会停 monitor、删 Routine 或删目录。用户说卸载 / 卸掉微信插件时，按顺序自己做完：

1. 停 monitor：读 `$GROK_WECHAT_HOME/monitor.pid`，进程还在就杀掉；再 `pkill -f "grok-wechat-plugin/server/index.js --monitor"` 兜底。
2. 卸 MCP：`UninstallMcpServer`，server_id 一般是 `user-grok-wechat`。
3. 删 webhook Routine「微信入站唤醒」（以及残留的定时收件箱 Routine）。
4. 删 Grok Bot 电脑上的目录：`/home/box/grok-wechat-plugin`、`$GROK_WECHAT_HOME`（默认 `/home/box/.grok-wechat`）、scratch 副本 `/workspace/grok-wechat-plugin`。
5. **不要**删除用户 GitHub 上的仓库或用户个人电脑上的副本，除非用户明确要求。

也可跑插件里的 `scripts/uninstall.sh`。卸完告诉用户：通道已停，重新用要再装、再扫码、再贴 webhook。
