---
name: 微信渠道
description: 用户要在 Grok Bot 里安装、登录或卸载微信 iLink 渠道时使用。一句话安装来自 GitHub。入站用 webhook 唤醒，不要用定时扫描。
---
# 微信渠道（iLink + Webhook）

你通过 MCP `grok-wechat` 连接微信个人号。底层是腾讯 iLink（`ilinkai.weixin.qq.com`）。

**入站唤醒必须走 Webhook，禁止建「每分钟 / 每 2 分钟处理收件箱」这类定时 Routine。**
Grok Bot 没有原生「微信消息」触发器。正确链路是：

`微信 → iLink 长轮询 monitor → 收件箱 → POST webhook → 本 agent 醒来 → 回复微信`

任务做完、需要用户拍板：你已经醒着，立刻 `wechat_send`，不走 webhook。

身份字段：`base_info.bot_agent = Grokbot/1.0.0`。连接页应显示 Grokbot，不是 OpenClaw。微信里「ClawBot」是腾讯产品名，改不了。

状态目录：`GROK_WECHAT_HOME`（Grok Bot 电脑上默认 `/home/box/.grok-wechat`）。
Webhook 地址和密钥只写在 `$GROK_WECHAT_HOME/wake.json`（权限 600），不要写进仓库、不要回显到聊天。

仓库：https://github.com/little-thing/grok-wechat-plugin

## 安装时你必须自动做完的事

用户一说「安装这个微信插件」并给出本仓库 URL（或只说装微信插件且 URL 已知），按顺序自己做。不要让用户拷文件或手填 MCP。只有这些步骤才停下来请用户操作：确认添加 MCP（若主机要求）、扫码、把 webhook 地址和密钥发来。

### A. 拿到代码（你做）

1. 先读本 SKILL（本文件或 raw GitHub）。
2. 把本仓库下载到 Grok Bot 电脑的 `/home/box/grok-wechat-plugin`。优先拉 GitHub zip 并解压到该目录；有 `gh`/`git` 也可以 clone 到同一路径。目录已存在则复用或覆盖刷新。
3. **不要**把仓库下到用户本机，也**不要**从用户的 Webstorm / 本地工程拷。源就是这个 GitHub 仓库。

### B. 装好 MCP（你做）

1. 添加本地 MCP `grok-wechat`：`/usr/bin/node` + `/home/box/grok-wechat-plugin/server/index.js` 绝对路径，env `GROK_WECHAT_HOME=/home/box/.grok-wechat`。改账号配置时先让用户确认。
2. stdio 用换行分隔 JSON（MCP 2025-11-25），不要 Content-Length。
3. 写好 connector 自定义说明：登录出码、webhook 入站、只回微信、任务完成立刻 `wechat_send`。

### C. 建立 Webhook Routine（你做）

只建一条，名叫 `微信入站唤醒`，trigger 只能是 webhook。若已有定时「微信私信值守」，删掉。

Routine prompt：入站后 `wechat_status` → 保证 monitor → `wechat_inbox` → 逐条 typing / 回复 / send。空则安静。只回微信。

### D. 必须用户动手：Webhook 地址

告诉用户打开「微信入站唤醒」，确认是 Webhook 且已启用，把 hook URL 和密钥发到对话。写入 `wake.json` 后探测（Bearer），不要把密钥发回聊天。

### E. 必须用户动手：扫码

`wechat_login_start`（POST，带 bot_agent）出码 → 用户扫 → `wechat_login_wait`。过期重出码。

### F. 拉起通道（你做）

`wechat_start_monitor`，确认登录，通知用户可以微信说话。对方先发一条才有 context_token。任务完成立刻 wechat_send。

## 入站唤醒后

`wechat_inbox`；空则安静。有消息则微信里直接回。不要把用户赶回 App。

## 协议

只处理私信。回复依赖 context_token。纯文本。不要用定时 Routine 当修复。

## 卸载时你必须自动做完的事

Settings 或 UninstallMcpServer 只摘掉账号里的 MCP，不会删文件、不会停长轮询。用户说卸载 / 卸掉微信插件时，按顺序自己做完，不要只卸 MCP。

1. 停 monitor：读 `$GROK_WECHAT_HOME/monitor.pid`，进程还在就杀掉；再 `pkill -f "grok-wechat-plugin/server/index.js --monitor"` 兜底。
2. 卸 MCP：`UninstallMcpServer`，server_id 一般是 `user-grok-wechat`。
3. 删 webhook Routine「微信入站唤醒」（以及残留的定时收件箱 Routine）。
4. 只删 Grok Bot 电脑上的：`/home/box/grok-wechat-plugin`、`$GROK_WECHAT_HOME`（默认 `/home/box/.grok-wechat`）、scratch `/workspace/grok-wechat-plugin`。
5. 不要删用户本机工程，也不要删他们的 GitHub 仓库。

也可跑插件里的 `scripts/uninstall.sh`。卸完告诉用户：通道已停，重新用要再装、再扫码、再贴 webhook。
