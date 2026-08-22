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
2. **插件文件**落在 Grok Bot 电脑（默认 `/home/box/grok-wechat-plugin`）。
3. **monitor 自启**：用户登录或 MCP `initialize` 时调用 `wechat_start_monitor` 拉起后台长轮询。
4. **Routine「微信监听保活」**：每 5 分钟，提示词 `只调用 wechat_start_monitor，确保微信入站监听在跑。除此之外什么都不要做。` 一次调用为所有已绑定账号保活 monitor。
5. **扫码绑定**：`wechat_login_start` 出码 → 用户扫码 → `wechat_login_wait`。对方先发一条才有 context_token。

每次扫码绑定成功后：

1. `wechat_login_wait` 返回该账号的 `ilink_bot_id`、`ilink_user_id`。
2. 为该微信用户**创建专属助手**。
3. 在该助手下创建 Routine **「微信入站唤醒」**（webhook）。入站后 `wechat_inbox` → typing / `wechat_send`，只处理该号的私信。
4. 用户从该 Routine 复制 **webhook 地址**和**密钥**发来；调用 `wechat_set_wake`（传入该号 `ilink_bot_id`、url、key）。配置写入 `account.json`（权限 600），并探测 Bearer。
5. 该微信号的入站只 POST 该助手的 webhook；其他已绑定号不受影响。

多账号：同一连接器继续 `wechat_login_start` 取新码，为每个号重复「专属助手 + 微信入站唤醒 + wechat_set_wake」。`wechat_status` 列出全部账号及 `has_wake`。

stdio 用换行分隔 JSON（MCP 2025-11-25）。

## 入站之后

`wechat_inbox`。有消息则在微信里回复。每条消息含 `ilink_bot_id`、`from_user_id`。用同一 `ilink_bot_id` 回复该用户。语音按转写文本处理，用 `wechat_send` 回文字。

## 协议

只处理私信。回复依赖 context_token。文字和语音转写都当文本，用 `wechat_send` 回文字。

## 卸载

用户说「卸掉微信插件」时，按顺序完成本机与平台清理。

### 1. 本机清理（先做）

调用 `wechat_uninstall`，或执行 `scripts/uninstall.sh`。二者等价，会：

- 停止所有 monitor 进程（`monitor.pid` + 匹配 `grok-wechat-plugin/server/index.js --monitor` 的进程）
- 删除插件目录（如 `/home/box/grok-wechat-plugin`）与状态目录（`GROK_WECHAT_HOME` 或 `~/.grok-wechat`，含 `account.json`、`wake.json`、inbox、media、`monitor.pid`、`monitor.log`）
- 返回 `platform_cleanup` 清单，供后续步骤使用

### 2. 平台清理

1. 从 Grok Bot Settings **卸载** `grok-wechat` 连接器。
2. 在**每个**仍有 Routine「微信入站唤醒」或「微信监听保活」的助手上**删除**这两条 Routine。当前助手自行删除；若其他助手仍保留，通知那些助手删除。
3. **专属助手**（扫码绑定时为每个微信号创建的助手）：删除其「微信入站唤醒」Routine；wake 绑定随状态目录删除而失效。助手本身按用户意愿保留或删除。

### 3. 卸载完成标准

- 无 `grok-wechat` MCP 连接器
- 无插件目录、无 `~/.grok-wechat` 状态
- 无 `node .../server/index.js --monitor` 进程
- 各助手无「微信入站唤醒」「微信监听保活」Routine

重新使用需再次安装、扫码、配置 webhook。
