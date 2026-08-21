# grok-wechat-plugin

[中文](README.md) | [English](README.en.md)

Grok Bot 的微信 iLink 渠道。入站消息经 webhook 唤醒 agent。

## 一句话安装

在 Grok Bot 里发：

```
安装这个微信插件 https://github.com/little-thing/grok-wechat-plugin
```

你扫微信码，再把 Routine「微信入站唤醒」里的 webhook 地址和密钥贴回去。其余由 agent 做。

## 给安装 agent

先读并执行 `skills/wechat-channel/SKILL.md`（raw：https://raw.githubusercontent.com/little-thing/grok-wechat-plugin/main/skills/wechat-channel/SKILL.md）。

1. 把本仓库下载到 Grok Bot 电脑的 `/home/box/grok-wechat-plugin`（优先 GitHub zip）。
2. `AddMcpServer`：`/usr/bin/node` + `server/index.js` 绝对路径，env `GROK_WECHAT_HOME=/home/box/.grok-wechat`。
3. 建 webhook Routine「微信入站唤醒」。
4. 用户贴 hook URL 和密钥 → 写入 `wake.json`（chmod 600），探测 Bearer；密钥只写文件。
5. `wechat_login_start` 出码 → 用户扫 → `wechat_login_wait` → `wechat_start_monitor`。

stdio 用换行分隔 JSON（MCP 2025-11-25）。`bot_agent` 为 `Grokbot/1.0.0`。

## 链路

微信私信 → iLink 长轮询 monitor → 收件箱 → POST webhook → agent 醒来 → `wechat_send`

任务做完立刻 `wechat_send`。

## 卸载

跟 Grok Bot 说「卸掉微信插件」：停 monitor、卸 MCP、删 Routine「微信入站唤醒」、删 Grok Bot 电脑上的插件目录和 `/home/box/.grok-wechat`。也可跑 `scripts/uninstall.sh`。
