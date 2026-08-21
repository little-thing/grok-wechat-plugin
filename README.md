# grok-wechat-plugin

Grok Bot 的微信 iLink 渠道。入站走 webhook 唤醒，不走定时扫描。

## 一句话安装

在 Grok Bot 里粘贴：

```
安装这个微信插件 https://github.com/little-thing/grok-wechat-plugin
```

## 给安装 agent

1. 先拉取并严格按 [skills/wechat-channel/SKILL.md](https://raw.githubusercontent.com/little-thing/grok-wechat-plugin/main/skills/wechat-channel/SKILL.md)（或仓库内同路径文件）执行，不要向用户索要 clone、拷贝或 MCP JSON。
2. 按 SKILL 完成安装：把本仓库下载到 Grok Bot 的电脑 `/home/box/grok-wechat-plugin`，注册本地 MCP，建 webhook Routine，写 wake.json，扫码登录，启动 monitor。

## 链路

微信私信 → iLink 长轮询 monitor → inbox → POST webhook → agent 醒来 → wechat_send

任务做完立刻 wechat_send，不经过 webhook。

## 卸载

Settings 只卸 MCP 注册，不会删文件、停 monitor 或删 Routine。让 agent 按 SKILL 卸载，或跑 `scripts/uninstall.sh`：停 monitor、卸 MCP、删 Routine、删 `/home/box/grok-wechat-plugin` 与 `/home/box/.grok-wechat`。不删用户个人电脑上的副本。
