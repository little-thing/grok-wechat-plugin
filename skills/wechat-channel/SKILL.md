---
name: 微信渠道
description: 用户要在 Grok Bot 里安装、登录、收发或卸载微信 iLink 渠道时使用。入站用 webhook 唤醒。
---
# 微信渠道

通过 MCP `grok-wechat` 连接微信个人号。底层是腾讯 iLink（`ilinkai.weixin.qq.com`）。

`微信私信 → monitor 收件箱 → POST 共享 webhook → 安装助手醒来 → wechat_inbox → 按 ilink_bot_id 处理或分流 → wechat_send`

任务做完或需要用户拍板：立刻 `wechat_send`。

`base_info.bot_agent = Grokbot/1.0.0`。连接页显示 Grokbot。微信里的「ClawBot」是腾讯产品名。

仓库：https://github.com/little-thing/grok-wechat-plugin

## 安装

用户发一句「安装这个微信插件 https://github.com/little-thing/grok-wechat-plugin」即完成本渠道安装。技能就是本文件（本插件 `skills/wechat-channel/SKILL.md`）。

安装完成后 Grok Bot 上具备：

1. **连接器** `grok-wechat`，入口 `server/index.js`。用户若需确认则点「加」添加连接器。
2. **插件文件**落在 Grok Bot 电脑（`/home/box/grok-wechat-plugin`）。
3. **monitor 自启**：用户登录或 MCP `initialize` 时调用 `wechat_start_monitor` 拉起后台长轮询。
4. **安装助手**创建两条 Routine（全渠道共用，只建一次）：
   - **「微信入站唤醒」**（webhook）：入站后 `wechat_inbox` → 按消息内 `ilink_bot_id` 处理或分流 → typing / `wechat_send`
   - **「微信监听保活」**：每 5 分钟，提示词 `只调用 wechat_start_monitor，确保微信入站监听在跑。除此之外什么都不要做。`
5. **全局 webhook（粘贴一次）**：Grok Bot 创建 webhook Routine 时**不会**把 url/key 返回给 agent；用户从该 Routine 面板复制 **webhook 地址**和**密钥**发来一次。安装助手调用 `wechat_set_wake`（url、key，省略 `ilink_bot_id`）写入全局 `wake.json`（权限 600），当前及后续所有已绑定账号共用。`wechat_status` 的 `global_wake_configured=true` 表示入站已就绪。
6. **扫码绑定**：`wechat_login_start` 出码并向用户展示 → 立即 `wechat_login_wait`，重复调用直至 `logged_in=true`；若 `expired=true` 则重新 `wechat_login_start` 后再 `wechat_login_wait`。对方先发一条才有 context_token。

每次扫码绑定成功后：

1. `wechat_login_wait` 返回该账号的 `ilink_bot_id`、`ilink_user_id`。
2. 该号自动复用全局 `wake.json`，**无需**再建入站 Routine、**无需**再粘贴 webhook。
3. 可选：为该号创建专属助手并按 `ilink_bot_id` 分流；专属助手**不**创建「微信入站唤醒」。

多账号：同一连接器继续 `wechat_login_start` → `wechat_login_wait` 即可；全局 webhook 覆盖全部已绑定号。`wechat_status` 列出 `global_wake_configured` 与各账号 `has_wake`。

stdio 用换行分隔 JSON（MCP 2025-11-25）。

## 入站之后

共享入站助手被 webhook 唤醒后 `wechat_inbox`。每条消息含 `ilink_bot_id`、`from_user_id`。用同一 `ilink_bot_id` 回复该用户，或转交专属助手处理。语音按转写文本处理，用 `wechat_send` 回文字。

## 协议

只处理私信。回复依赖 context_token。文字和语音转写都当文本，用 `wechat_send` 回文字。

## 卸载

用户说「卸掉微信插件」时，安装助手**执行**下列全部步骤。

### 1. 本机清理

调用 `wechat_uninstall`（或 `scripts/uninstall.sh`）：

- 停止所有 monitor 进程
- 删除 `/home/box/grok-wechat-plugin` 与 `GROK_WECHAT_HOME` / `/home/box/.grok-wechat`（含 `account.json`、`wake.json`、token、inbox、media、pid、log、`ensure-monitor.sh`）
- 清理 crontab 与 shell 自启项

用户若先从 Settings 卸载连接器，MCP 退出与 monitor 看门狗也会触发同等本机清理。

### 2. 平台清理（安装助手执行）

1. 从 Grok Bot Settings **卸载** `grok-wechat` 连接器（若仍存在）。
2. **删除**安装助手上 Routine「微信入站唤醒」与「微信监听保活」。
3. **删除**其他助手上残留的同名 Routine。

### 3. 完成标准

- 无 `grok-wechat` 连接器
- 无插件目录、无 `.grok-wechat` 状态
- 无 monitor 进程
- 无「微信入站唤醒」「微信监听保活」Routine
- 重装后 `wechat_status` 为零账号，需重新粘贴 webhook 并扫码
