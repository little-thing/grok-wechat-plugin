---
name: 微信渠道
description: 用户要在 Grok Bot 里安装、登录、收发、登出或卸载微信 iLink 渠道时使用。入站私信经 webhook 唤醒并转交专属助手后，专属助手立刻 wechat_send 回复该微信对端。支持文字、语音转写、图片/视频/文件与正在输入。
---
# 微信渠道

通过 MCP `grok-wechat` 连接微信个人号。底层是腾讯 iLink（`ilinkai.weixin.qq.com`）。

`微信私信 → monitor 收件箱 → POST 共享 webhook → 安装助手醒来 → wechat_inbox → 按 ilink_bot_id 转交专属助手 → wechat_send / wechat_send_media`

专属助手收到转交后立刻向该微信对端回复：先 `wechat_typing`（on），再 `wechat_send` / `wechat_send_media`，发完关闭正在输入。

`base_info.bot_agent = Grokbot/1.0.0`。连接页显示 Grokbot。微信里的「ClawBot」是腾讯产品名。

仓库：https://github.com/little-thing/grok-wechat-plugin

## 安装

用户发一句「安装这个微信插件 https://github.com/little-thing/grok-wechat-plugin」即完成本渠道安装。技能就是本文件（本插件 `skills/wechat-channel/SKILL.md`）。

安装完成后 Grok Bot 上具备：

1. **连接器** `grok-wechat`，入口 `server/index.js`。用户若需确认则点「加」添加连接器。
2. **插件文件**落在 Grok Bot 电脑（`/home/box/grok-wechat-plugin`）。
3. **monitor 自启**：用户登录或 MCP `initialize` 时调用 `wechat_start_monitor` 拉起后台长轮询。已绑定账号时，每个账号独立长轮询入站。
4. **安装助手**创建两条 Routine（全渠道共用，只建一次）：
   - **「微信入站唤醒」**（webhook）：入站后 `wechat_inbox` → 按 `ilink_bot_id` 转交专属助手，专属助手立刻向该微信对端 `wechat_send`
   - **「微信监听保活」**：每 5 分钟，提示词 `只调用 wechat_start_monitor，确保微信入站监听在跑。除此之外什么都不要做。`
5. **全局 webhook（粘贴一次）**：Grok Bot 创建 webhook Routine 时**不会**把 url/key 返回给 agent；用户从该 Routine 面板复制 **webhook 地址**和**密钥**发来一次。安装助手调用 `wechat_set_wake`（url、key，省略 `ilink_bot_id`）写入全局 `wake.json`（权限 600），当前及后续所有已绑定账号共用。`wechat_status` 的 `global_wake_configured=true` 表示入站已就绪。
6. **扫码绑定**：`wechat_login_start` 出码并向用户展示 → 立即 `wechat_login_wait`，重复调用直至 `logged_in=true`；若 `expired=true` 则重新 `wechat_login_start` 后再 `wechat_login_wait`。对方先发一条才有 context_token。

每次扫码绑定成功后：

1. `wechat_login_wait` 返回该账号的 `ilink_bot_id`、`ilink_user_id`。
2. 该号复用全局 `wake.json`，**无需**再建入站 Routine、**无需**再粘贴 webhook。
3. 为该微信号码**创建专属 Grok Bot 助手**，描述使用：

   > 负责该微信号的入站私信。收到按 ilink_bot_id 转交的私信后，立刻用同一 ilink_bot_id 向该微信对端回复：先 wechat_typing（on），再 wechat_send 或 wechat_send_media，发完关闭正在输入。

   专属助手不创建「微信入站唤醒」。
4. 调用 `wechat_set_dedicated_assistant`（`ilink_bot_id`、`assistant_id`、`assistant_name`）写入 `account.json`。
5. 入站由安装助手 `wechat_inbox` 后按 `ilink_bot_id` 转交该专属助手，专属助手立刻向该微信对端 `wechat_send`。

多账号：每扫一个新码重复步骤 1–5；全局 webhook 覆盖全部已绑定号。`wechat_status` 列出 `global_wake_configured`、各账号 `has_wake` 与 `dedicated_assistant_name`。

stdio 支持换行分隔 JSON 与 Content-Length 分帧。

## 工具

| 工具 | 职责 |
|---|---|
| `wechat_login_start` | 出码并展示给用户，下一步立即 `wechat_login_wait` |
| `wechat_login_wait` | 轮询扫码；`logged_in=true` 时拉起 monitor；`expired=true` 时重新出码 |
| `wechat_set_wake` | 保存全局 webhook（url、key 必填）。可选 `ilink_bot_id` 同时写入该账号 |
| `wechat_set_dedicated_assistant` | 为已绑定账号登记专属助手 `assistant_id` / `assistant_name`。创建时描述写明：入站转交后立刻向该微信对端回复 |
| `wechat_status` | 账号列表、`global_wake_configured`、各号专属助手 / peers、allowlist、inbox、monitor |
| `wechat_inbox` | 立即取出 monitor 缓存的入站消息（取出后清空） |
| `wechat_send` | 入站转交后立刻向该微信对端发文本。必填 `text`、`to_user_id`；多账号时带同一 `ilink_bot_id`。Markdown 转纯文本，超 4000 字自动分段 |
| `wechat_send_media` | 入站转交后立刻向该微信对端发图片/视频/文件。必填本机 `path`、`kind`（`image` / `video` / `file`）、`to_user_id`；可选 `caption` |
| `wechat_typing` | 发送或取消「正在输入」。必填 `on`、`to_user_id`。回复前对同一对端打开，发完关闭 |
| `wechat_start_monitor` | 后台长轮询各已绑定账号，入站按账号 POST webhook |
| `wechat_stop_monitor` | 停止后台长轮询 |
| `wechat_approve` | `user_id` 加入 allowlist；`clear=true` 清空后接收全部私信。空列表表示接收全部 |
| `wechat_logout` | 默认登出全部并停 monitor；传入 `ilink_bot_id` 只登出一个 |
| `wechat_uninstall` | 本机完整清理，返回 `platform_cleanup` 与 `dedicated_assistants_sidebar_delete` |

## 入站之后

共享入站助手被 webhook 唤醒后 `wechat_inbox`。每条消息含：

- `ilink_bot_id` / `ilink_user_id`：本机已绑定账号
- `from_user_id`：对端
- `text`：文字、语音转写、引用标题（`引用: …`）拼成的纯文本
- `items`：`text` / `voice` / `image` / `video` / `file`；媒体已下载到本机 `~/.grok-wechat/media`，带 `path`

按 `ilink_bot_id` 转交对应专属助手。专属助手收到转交后立刻向 `from_user_id` 回复，调用时带同一 `ilink_bot_id`：先 `wechat_typing`（on），再 `wechat_send` / `wechat_send_media`，发完关闭正在输入。语音按转写文本处理；图片/视频/文件用本机路径回发。

## 协议

只处理私信（`message_type=USER` 且 `message_state=FINISH`）。对端先发过消息留下 context_token 后，专属助手用 `wechat_send` 立刻回文字。文字和语音转写都当文本。

## 卸载

在 Grok Bot 里发：

```
卸掉微信插件
```

安装助手**执行**下列全部步骤。

### 1. 本机清理

调用 `wechat_uninstall`（或 `scripts/uninstall.sh`）：

- 停止所有 monitor 进程
- 删除 `/home/box/grok-wechat-plugin` 与 `GROK_WECHAT_HOME` / `/home/box/.grok-wechat`（含 `account.json`、`wake.json`、token、inbox、media、pid、log、`ensure-monitor.sh`）
- 清理 crontab 与 shell 自启项

返回 `dedicated_assistants_sidebar_delete`（绑定期间登记的专属助手名称）。连接器进程退出或重启**不会**触发本机清理；必须先调用 `wechat_uninstall` 再卸载连接器。

### 2. 平台清理（安装助手执行）

1. **卸载** `grok-wechat` 连接器。
2. **删除**安装助手上 Routine「微信入站唤醒」与「微信监听保活」。
3. **删除**其他助手上残留的同名 Routine。
4. 根据 `dedicated_assistant_sidebar_names`，**告知用户**在侧栏右键 → 删除所列专属助手（如「微信1」「微信2」）。

### 3. 完成标准

- 无 `grok-wechat` 连接器
- 无插件目录、无 `.grok-wechat` 状态
- 无 monitor 进程
- 无「微信入站唤醒」「微信监听保活」Routine
- 用户已在侧栏删除 `dedicated_assistants_sidebar_delete` 所列专属助手
- 重装后 `wechat_status` 为零账号，需重新粘贴 webhook 并扫码
