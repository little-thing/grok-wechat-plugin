# grok-wechat-plugin

[中文](README.md) | [English](README.en.md)

Grok Bot 的微信 iLink 渠道。入站走 webhook 唤醒，不走定时扫描。

## 一句话安装

在 Grok Bot 里发：

```
安装这个微信插件 https://github.com/little-thing/grok-wechat-plugin
```

你只需扫微信码，再把 Routine「微信入站唤醒」里的 webhook 地址和密钥贴回去。其余由 agent 自动做。

## 给安装 agent

先拉取并严格执行本仓库的 `skills/wechat-channel/SKILL.md`（raw：https://raw.githubusercontent.com/little-thing/grok-wechat-plugin/main/skills/wechat-channel/SKILL.md）。

不要让用户自己拷文件、填 MCP JSON，或建「每分钟扫收件箱」Routine。

1. 把本仓库下载到 Grok Bot 电脑的 `/home/box/grok-wechat-plugin`（优先 GitHub zip；不要下到用户本机）。
2. `AddMcpServer`：`/usr/bin/node` + `server/index.js` 绝对路径，env `GROK_WECHAT_HOME=/home/box/.grok-wechat`。
3. 只建一条 webhook Routine「微信入站唤醒」。
4. 用户贴 hook URL 和密钥 → 写入 `wake.json`（chmod 600），探测 Bearer，不要回显密钥。
5. `wechat_login_start` 出码 → 用户扫 → `wechat_login_wait` → `wechat_start_monitor`。

stdio 用换行分隔 JSON（MCP 2025-11-25）。`bot_agent` 必须是 `Grokbot/1.0.0`。

## 链路

微信私信 -> iLink 长轮询 monitor -> inbox -> POST webhook -> agent 醒来 -> wechat_send

任务做完立刻 wechat_send，不经过 webhook。

## 卸载

跟 Grok Bot 说「卸掉微信插件」。Settings 只摘 MCP。完整卸：停 monitor、卸 MCP、删 Routine、删 Grok Bot 电脑上的插件目录和 `/home/box/.grok-wechat`。不要删用户的 GitHub / 本机源码。也可跑 `scripts/uninstall.sh`。
