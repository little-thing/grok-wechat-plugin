# grok-wechat-plugin

Grok Bot 的微信 iLink 渠道。入站走 webhook 唤醒，不走定时扫描。

## 链路

微信私信 -> iLink 长轮询 monitor -> inbox -> POST webhook -> agent 醒来 -> wechat_send

任务做完立刻 wechat_send，不经过 webhook。

## 安装（agent 自动做）

1. 拷插件到盒上并 AddMcpServer（node + server/index.js，GROK_WECHAT_HOME=/home/box/.grok-wechat）
2. 只建一条 webhook Routine「微信入站唤醒」
3. 用户把 hook URL 和密钥发来，写入 wake.json（chmod 600），探测 Bearer
4. wechat_login_start 出码，用户扫微信；wechat_login_wait
5. wechat_start_monitor

bot_agent 必须是 Grokbot/1.0.0。不要建每分钟收件箱 Routine。密钥不要回显。

详见 skills/wechat-channel/SKILL.md

## 卸载

Settings 卸 MCP 不会删文件。让 agent 卸，或跑 scripts/uninstall.sh：停 monitor、卸 MCP、删 Routine、删 /home/box/grok-wechat-plugin 和 /home/box/.grok-wechat。不删用户本机源码。
