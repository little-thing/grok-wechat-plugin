---
name: 微信渠道
description: 用户要在 Grok Bot 里安装、登录、收发或卸载微信 iLink 渠道时使用。入站用 webhook 唤醒。
---
# 微信渠道

通过 MCP `grok-wechat` 连接微信个人号。底层是腾讯 iLink（`ilinkai.weixin.qq.com`）。

`微信私信 → monitor 收件箱 → POST 该号专属 webhook → 专属助手醒来 → wechat_send`

任务做完或需要用户拍板：立刻 `wechat_send`。

`base_info.bot_agent = Grokbot/1.0.0`。连接页显示 Grokbot。微信里的「ClawBot」是腾讯产品名。

仓库：https://github.com/little-thing/grok-wechat-plugin

## 安装

用户发一句「安装这个微信插件 https://github.com/little-thing/grok-wechat-plugin」即完成本渠道安装。技能就是本文件（本插件 `skills/wechat-channel/SKILL.md`）。

安装完成后 Grok Bot 上具备：

1. **连接器** `grok-wechat`，入口 `server/index.js`。用户若需确认则点「加」添加连接器。
2. **插件文件**落在 Grok Bot 电脑（`/home/box/grok-wechat-plugin`）。
3. **monitor 自启**：用户登录或 MCP `initialize` 时调用 `wechat_start_monitor` 拉起后台长轮询。
4. **Routine「微信监听保活」**：每 5 分钟，提示词 `只调用 wechat_start_monitor，确保微信入站监听在跑。除此之外什么都不要做。` 一次调用为所有已绑定账号保活 monitor。
5. **扫码绑定**：`wechat_login_start` 出码并向用户展示 → 立即 `wechat_login_wait`，重复调用直至 `logged_in=true`；若 `expired=true` 则重新 `wechat_login_start` 后再 `wechat_login_wait`。对方先发一条才有 context_token。

每次扫码绑定成功后：

1. `wechat_login_wait` 返回该账号的 `ilink_bot_id`、`ilink_user_id`。
2. 安装助手为该微信用户**创建专属助手**，把 `ilink_bot_id` 交给该助手（若平台允许，也可由安装助手在其上建好 Routine 框架）。
3. **专属助手**在其自身下创建 Routine **「微信入站唤醒」**（webhook）。入站后 `wechat_inbox` → typing / `wechat_send`，只处理该号的私信。
4. 同一专属助手立即调用 `wechat_set_wake`（传入本 Routine 的 url、key、`ilink_bot_id`，以及 `assistant_id` / `assistant_name` 写入 `account.json`）。连接器为账号级，专属助手可直接调用。配置权限 600，并探测 Bearer。
5. `wechat_status` 显示该账号 `has_wake=true` 时绑定完成。该微信号的入站只 POST 该助手的 webhook；其他已绑定号不受影响。

多账号：同一连接器 `wechat_login_start` 出码 → 立即 `wechat_login_wait` 至绑定成功，为每个号重复「专属助手自建 Routine + 自调 wechat_set_wake」。`wechat_status` 列出全部账号及 `has_wake`。

stdio 用换行分隔 JSON（MCP 2025-11-25）。

## 入站之后

`wechat_inbox`。有消息则在微信里回复。每条消息含 `ilink_bot_id`、`from_user_id`。用同一 `ilink_bot_id` 回复该用户。语音按转写文本处理，用 `wechat_send` 回文字。

## 协议

只处理私信。回复依赖 context_token。文字和语音转写都当文本，用 `wechat_send` 回文字。

## 卸载

用户说「卸掉微信插件」时，安装助手**执行**下列全部步骤。

### 1. 本机清理

调用 `wechat_uninstall`（或 `scripts/uninstall.sh`）：

- 停止所有 monitor 进程
- 删除 `/home/box/grok-wechat-plugin` 与 `GROK_WECHAT_HOME` / `/home/box/.grok-wechat`（含 `account.json`、token、wake、inbox、media、pid、log、`ensure-monitor.sh`）
- 清理 crontab 与 shell 自启项

返回的 `platform_cleanup` 含 `dedicated_assistants_sidebar_delete`（绑定期间记录的专属助手 id/名称）。用户若先从 Settings 卸载连接器，MCP 退出与 monitor 看门狗也会触发同等本机清理。

### 2. 平台清理（安装助手执行）

1. 从 Grok Bot Settings **卸载** `grok-wechat` 连接器（若仍存在）。
2. **删除**每个助手上的 Routine「微信入站唤醒」与「微信监听保活」：安装助手删除自己的；向仍保留这两条 Routine 的其他助手发消息要求其删除，或在可访问范围内直接删除这两条 Routine。
3. 根据 `wechat_uninstall` 返回的 `dedicated_assistant_sidebar_names`，**告知用户**在侧栏对下列专属助手右键 → 删除（如「微信1」「微信2」）。Grok Bot 无跨助手删除 API，侧栏删除由用户完成。

### 3. 完成标准

- 无 `grok-wechat` 连接器
- 无插件目录、无 `.grok-wechat` 状态
- 无 monitor 进程
- 各助手无「微信入站唤醒」「微信监听保活」Routine
- 用户已在侧栏删除 `dedicated_assistants_sidebar_delete` 所列专属助手
- 重装后 `wechat_status` 为零账号
