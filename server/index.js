#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  appendInbox,
  clearPid,
  drainInbox,
  findAccount,
  isAllowed,
  listAccounts,
  loadState,
  monitorRunning,
  paths,
  removeAccount,
  resolveWakeForAccount,
  updateState,
  writePid,
} from "./store.js";
import {
  collectInbound,
  getUpdates,
  loginStart,
  loginWait,
  notifyStart,
  notifyStop,
  sendMedia,
  sendText,
  setAccountWake,
  setTyping,
  statusPayload,
} from "./ilink.js";
import { registerShutdownCleanup, touchConnectorActive, connectorAbandoned, runUninstall, uninstallWechat } from "./uninstall.js";

const self = fileURLToPath(import.meta.url);

try {
  fs.mkdirSync("/workspace/.grok-wechat", { recursive: true });
  fs.appendFileSync(
    "/workspace/.grok-wechat/mcp-host.log",
    `${new Date().toISOString()} spawn pid=${process.pid} argv=${JSON.stringify(process.argv)} cwd=${process.cwd()}\n`,
  );
} catch { /* ignore */ }
try {
  if (process.stdout._handle?.setBlocking) process.stdout._handle.setBlocking(true);
  if (process.stdin._handle?.setBlocking) process.stdin._handle.setBlocking(true);
} catch { /* ignore */ }


function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }], isError: true };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function ensureMonitor() {
  const existing = monitorRunning();
  if (existing) return { already_running: true, pid: existing };
  const accounts = listAccounts();
  if (!accounts.length) return { started: false, reason: "not_logged_in" };
  const child = spawn(process.execPath, [self, "--monitor"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  writePid(child.pid);
  return { started: true, pid: child.pid, account_count: accounts.length };
}

const accountRefSchema = {
  ilink_bot_id: { type: "string", description: "指定要操作的已绑定微信账号 bot id" },
  ilink_user_id: { type: "string", description: "指定要操作的已绑定微信 user id" },
};

const tools = {
  wechat_login_start: {
    description: "获取新的微信 iLink 登录二维码。已有绑定账号会保持在线，可继续扫码绑定更多账号。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => ok(await loginStart()),
  },
  wechat_login_wait: {
    description: "等待用户扫码确认。可重复调用直到 logged_in=true。",
    inputSchema: {
      type: "object",
      properties: {
        timeout_ms: { type: "number", description: "本次等待毫秒，默认 120000" },
        qrcode: { type: "string", description: "可选，指定等待的二维码 id；默认等待最近一次 wechat_login_start 返回的码" },
      },
    },
    handle: async ({ timeout_ms, qrcode }) => {
      const r = await loginWait(timeout_ms || 120_000, qrcode);
      if (r && r.logged_in) ensureMonitor();
      return ok(r);
    },
  },
  wechat_status: {
    description: "查看所有已绑定账号、allowlist、monitor 是否在跑。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => {
      const payload = statusPayload();
      payload.monitor_pid = monitorRunning();
      return ok(payload);
    },
  },
  wechat_logout: {
    description: "登出微信账号。默认登出全部已绑定账号；可指定 ilink_bot_id 只登出一个。",
    inputSchema: {
      type: "object",
      properties: {
        ...accountRefSchema,
        all: { type: "boolean", description: "true 时登出全部账号（默认行为）" },
      },
    },
    handle: async ({ ilink_bot_id, ilink_user_id, all }) => {
      const pid = monitorRunning();
      const state = loadState();
      const logoutAll = all !== false && !ilink_bot_id && !ilink_user_id;
      if (logoutAll) {
        if (pid) {
          try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
          clearPid();
        }
        updateState((s) => {
          s.accounts = [];
          s.pendingQrs = [];
          return s;
        });
        return ok({ logged_out: true, scope: "all" });
      }
      const before = listAccounts(state).length;
      updateState((s) => removeAccount(s, { ilink_bot_id, ilink_user_id }));
      const after = listAccounts(loadState()).length;
      if (after === before) {
        throw new Error("未找到要登出的账号");
      }
      if (!after && pid) {
        try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
        clearPid();
      } else if (after && !monitorRunning()) {
        ensureMonitor();
      }
      return ok({
        logged_out: true,
        scope: "one",
        ilink_bot_id: ilink_bot_id || undefined,
        remaining_accounts: after,
      });
    },
  },
  wechat_inbox: {
    description: "立即取出 monitor 缓存的入站消息（取出后清空）。每条消息带 ilink_bot_id，回复时用同一账号。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => ok({ messages: drainInbox(), from_monitor: true }),
  },
  wechat_send: {
    description: "向微信用户发文本。必须带该用户已缓存的 context_token（对方先发过消息）。Markdown 会转成纯文本。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        to_user_id: { type: "string", description: "微信对端 user id" },
        ilink_bot_id: accountRefSchema.ilink_bot_id,
      },
      required: ["text", "to_user_id"],
    },
    handle: async ({ text, to_user_id, ilink_bot_id }) => ok(await sendText(to_user_id, text, ilink_bot_id)),
  },
  wechat_send_media: {
    description: "发送图片/视频/文件。路径是 Grok Bot 电脑上的本地文件。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        kind: { type: "string", enum: ["image", "video", "file"] },
        to_user_id: { type: "string" },
        ilink_bot_id: accountRefSchema.ilink_bot_id,
        caption: { type: "string" },
      },
      required: ["path", "kind", "to_user_id"],
    },
    handle: async ({ path, kind, to_user_id, ilink_bot_id, caption }) =>
      ok(await sendMedia(to_user_id, path, kind, caption, ilink_bot_id)),
  },
  wechat_typing: {
    description: "发送或取消「正在输入」。回复前先打开，发完后关闭。",
    inputSchema: {
      type: "object",
      properties: {
        on: { type: "boolean" },
        to_user_id: { type: "string" },
        ilink_bot_id: accountRefSchema.ilink_bot_id,
      },
      required: ["on", "to_user_id"],
    },
    handle: async ({ on, to_user_id, ilink_bot_id }) => ok(await setTyping(to_user_id, on, ilink_bot_id)),
  },
  wechat_start_monitor: {
    description: "在本机后台启动长轮询，为每个已绑定账号拉取入站消息并按账号 POST 对应 webhook。已在跑则直接返回。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => ok(ensureMonitor()),
  },
  wechat_set_wake: {
    description: "为指定已绑定微信账号保存专属 webhook（url + key）。入站只唤醒该账号对应的助手。保存后探测 Bearer。",
    inputSchema: {
      type: "object",
      properties: {
        ilink_bot_id: { type: "string", description: "要配置 webhook 的已绑定账号 bot id" },
        url: { type: "string", description: "该助手 Routine「微信入站唤醒」的 webhook 地址" },
        key: { type: "string", description: "webhook 密钥" },
      },
      required: ["ilink_bot_id", "url", "key"],
    },
    handle: async ({ ilink_bot_id, url, key }) => ok(await setAccountWake(ilink_bot_id, url, key)),
  },
  wechat_stop_monitor: {
    description: "停止后台长轮询。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => {
      const pid = monitorRunning();
      if (!pid) return ok({ stopped: true, was_running: false });
      try { process.kill(pid, "SIGTERM"); } catch { /* ignore */ }
      clearPid();
      return ok({ stopped: true, pid });
    },
  },
  wechat_approve: {
    description: "把用户加入 allowlist。allowlist 为空表示接受所有私信；非空则只处理列表内用户。",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        clear: { type: "boolean", description: "true 时清空 allowlist，恢复接收全部私信" },
      },
    },
    handle: async ({ user_id, clear }) => {
      const state = updateState((s) => {
        if (clear) s.allowFrom = [];
        else if (user_id && !s.allowFrom.includes(user_id)) s.allowFrom.push(user_id);
        return s;
      });
      return ok({ allow_from: state.allowFrom });
    },
  },
  wechat_uninstall: {
    description: "完整卸载微信渠道：停止 monitor、删除状态与插件目录、清理自启项，并返回平台侧 Routine/连接器清理步骤。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => ok(uninstallWechat()),
  },
};

const TOOL_LIST = Object.entries(tools).map(([name, t]) => ({
  name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

async function dispatch(name, args) {
  const tool = tools[name];
  if (!tool) return fail(`未知工具: ${name}`);
  try {
    return await tool.handle(args || {});
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function writeMessage(msg) {
  const json = JSON.stringify(msg);
  fs.writeSync(1, json + "\n");
  try {
    fs.appendFileSync("/workspace/.grok-wechat/mcp-host.log", `${new Date().toISOString()} out ${json.slice(0, 200)}\n`);
  } catch { /* ignore */ }
}

async function onRpc(msg) {
  try {
    fs.appendFileSync("/workspace/.grok-wechat/mcp-host.log", `${new Date().toISOString()} in ${JSON.stringify({id: msg.id, method: msg.method}).slice(0,300)}\n`);
  } catch { /* ignore */ }
  const { id, method, params } = msg;
  if (method === "initialize") {
    touchConnectorActive();
    ensureMonitor();
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "grok-wechat", version: "1.0.0" },
      },
    };
  }
  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") {
    touchConnectorActive();
    return { jsonrpc: "2.0", id, result: { tools: TOOL_LIST } };
  }
  if (method === "tools/call") {
    touchConnectorActive();
    const result = await dispatch(params?.name, params?.arguments);
    return { jsonrpc: "2.0", id, result };
  }
  if (id === undefined) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

function startMcp() {
  registerShutdownCleanup();
  ensureMonitor();
  let buf = Buffer.alloc(0);
  process.stdin.on("data", async (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          const line = buf.slice(0, nl).toString("utf8").trim();
          buf = buf.slice(nl + 1);
          if (line.startsWith("{")) {
            try {
              const reply = await onRpc(JSON.parse(line));
              if (reply) writeMessage(reply);
            } catch (err) {
              writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(err) } });
            }
            continue;
          }
        }
        break;
      }
      const header = buf.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buf = buf.slice(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) break;
      const body = buf.slice(start, start + len).toString("utf8");
      buf = buf.slice(start + len);
      try {
        const reply = await onRpc(JSON.parse(body));
        if (reply) writeMessage(reply);
      } catch (err) {
        writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(err) } });
      }
    }
  });
}


async function wakeAgent(messages, log) {
  if (!messages.length) return;
  const state = loadState();
  const byBot = new Map();
  for (const m of messages) {
    const botId = m.ilink_bot_id || "";
    if (!byBot.has(botId)) byBot.set(botId, []);
    byBot.get(botId).push(m);
  }
  for (const [botId, batch] of byBot) {
    const account = findAccount(state, { ilink_bot_id: botId });
    const cfg = resolveWakeForAccount(account);
    if (!cfg) {
      log(`wake skipped bot=${botId}: no wake config`);
      continue;
    }
    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "grok-wechat",
          count: batch.length,
          from_user_ids: batch.map((m) => m.from_user_id),
          ilink_bot_id: botId,
          ilink_user_id: account?.ilinkUserId || batch[0]?.ilink_user_id || "",
        }),
      });
      const text = await res.text();
      log(`wake bot=${botId} ${res.status} ${text.slice(0, 180)}`);
    } catch (err) {
      log(`wake error bot=${botId} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function pollAccount(account, log) {
  const raw = await getUpdates(account);
  if (raw.session_expired) {
    log(`session expired bot=${account.ilinkBotId}`);
    return { messages: [], expired: true };
  }
  const collected = await collectInbound(raw.msgs || [], account);
  const state = loadState();
  const allowed = collected.messages.filter((m) => isAllowed(state, m.from_user_id));
  return { messages: allowed, expired: false };
}

async function runMonitor() {
  const logStream = fs.createWriteStream(paths().log, { flags: "a" });
  const log = (line) => {
    logStream.write(`${new Date().toISOString()} ${line}\n`);
  };
  log("monitor start");
  const accounts = listAccounts();
  await Promise.all(accounts.map((a) => notifyStart(a)));
  const onExit = async () => {
    const current = listAccounts();
    await Promise.all(current.map((a) => notifyStop(a)));
    clearPid();
    process.exit(0);
  };
  process.on("SIGTERM", onExit);
  process.on("SIGINT", onExit);
  let failures = 0;
  while (true) {
    try {
      if (connectorAbandoned()) {
        log("connector removed, running uninstall");
        runUninstall();
        process.exit(0);
      }
      const accountsNow = listAccounts();
      if (!accountsNow.length) {
        log("no accounts, stopping");
        clearPid();
        process.exit(0);
      }
      const results = await Promise.all(accountsNow.map((account) => pollAccount(account, log)));
      failures = 0;
      const batch = results.flatMap((r) => r.messages);
      if (results.some((r) => r.expired)) {
        await sleep(60_000);
      }
      if (batch.length) {
        appendInbox(batch);
        log(`inbox +${batch.length}`);
        await wakeAgent(batch, log);
      }
    } catch (err) {
      failures += 1;
      log(`getupdates error ${err instanceof Error ? err.message : String(err)}`);
      await sleep(failures >= 3 ? 30_000 : 2_000);
    }
  }
}

if (process.argv.includes("--monitor")) {
  runMonitor();
} else if (process.argv.includes("--ensure-monitor")) {
  process.stdout.write(JSON.stringify(ensureMonitor()) + "\n");
} else if (process.argv.includes("--uninstall")) {
  process.stdout.write(`${JSON.stringify(runUninstall({ deferPluginRemoval: false }), null, 2)}\n`);
} else {
  startMcp();
}
