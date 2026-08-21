#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  appendInbox,
  clearPid,
  drainInbox,
  isAllowed,
  loadState,
  monitorRunning,
  homeDir,
  paths,
  peekInboxCount,
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
  setTyping,
} from "./ilink.js";

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

const tools = {
  wechat_login_start: {
    description: "获取微信 iLink 登录二维码。把 image 展示给用户扫码，然后调用 wechat_login_wait。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => ok(await loginStart()),
  },
  wechat_login_wait: {
    description: "等待用户扫码确认。可重复调用直到 logged_in=true。",
    inputSchema: {
      type: "object",
      properties: { timeout_ms: { type: "number", description: "本次等待毫秒，默认 120000" } },
    },
    handle: async ({ timeout_ms }) => ok(await loginWait(timeout_ms || 120_000)),
  },
  wechat_status: {
    description: "查看登录态、最近会话、allowlist、monitor 是否在跑。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => {
      const s = loadState();
      return ok({
        logged_in: Boolean(s.token),
        ilink_bot_id: s.ilinkBotId,
        ilink_user_id: s.ilinkUserId,
        last_from_user_id: s.lastFromUserId,
        peers: Object.keys(s.contextTokens || {}),
        allow_from: s.allowFrom,
        monitor_pid: monitorRunning(),
        inbox: peekInboxCount(),
      });
    },
  },
  wechat_logout: {
    description: "清除本地 bot_token 与会话状态。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => {
      const pid = monitorRunning();
      if (pid) {
        try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
        clearPid();
      }
      updateState((s) => {
        s.token = "";
        s.getUpdatesBuf = "";
        s.contextTokens = {};
        s.typingTickets = {};
        s.pendingQr = null;
        s.lastFromUserId = "";
        return s;
      });
      return ok({ logged_out: true });
    },
  },
  wechat_inbox: {
    description: "立即取出 monitor 缓存的入站消息（取出后清空）。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => ok({ messages: drainInbox(), from_monitor: true }),
  },
  wechat_send: {
    description: "向微信用户发文本。必须带该用户已缓存的 context_token（对方先发过消息）。Markdown 会转成纯文本。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        to_user_id: { type: "string", description: "默认最近一个发来消息的用户" },
      },
      required: ["text"],
    },
    handle: async ({ text, to_user_id }) => ok(await sendText(to_user_id, text)),
  },
  wechat_send_media: {
    description: "发送图片/视频/文件。路径是 Grok Bot 电脑上的本地文件。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        kind: { type: "string", enum: ["image", "video", "file"] },
        to_user_id: { type: "string" },
        caption: { type: "string" },
      },
      required: ["path", "kind"],
    },
    handle: async ({ path, kind, to_user_id, caption }) => ok(await sendMedia(to_user_id, path, kind, caption)),
  },
  wechat_typing: {
    description: "发送或取消「正在输入」。回复前先打开，发完后关闭。",
    inputSchema: {
      type: "object",
      properties: {
        on: { type: "boolean" },
        to_user_id: { type: "string" },
      },
      required: ["on"],
    },
    handle: async ({ on, to_user_id }) => ok(await setTyping(to_user_id, on)),
  },
  wechat_start_monitor: {
    description: "在本机后台启动长轮询，把入站消息写入收件箱并 POST webhook 唤醒 agent。",
    inputSchema: { type: "object", properties: {} },
    handle: async () => {
      const existing = monitorRunning();
      if (existing) return ok({ already_running: true, pid: existing });
      loadState();
      const child = spawn(process.execPath, [self, "--monitor"], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();
      writePid(child.pid);
      return ok({ started: true, pid: child.pid });
    },
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
  // MCP 2025-11-25 stdio: one JSON-RPC object per line, no Content-Length.
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
    return { jsonrpc: "2.0", id, result: { tools: TOOL_LIST } };
  }
  if (method === "tools/call") {
    const result = await dispatch(params?.name, params?.arguments);
    return { jsonrpc: "2.0", id, result };
  }
  if (id === undefined) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

function startMcp() {
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
  const wakeFile = `${homeDir()}/wake.json`;
  if (!fs.existsSync(wakeFile)) {
    log("wake skipped: no wake.json");
    return;
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(wakeFile, "utf8"));
  } catch (err) {
    log(`wake config error ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!cfg.url || !cfg.key) {
    log("wake skipped: url/key missing");
    return;
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
        count: messages.length,
        from_user_ids: messages.map((m) => m.from_user_id),
      }),
    });
    const text = await res.text();
    log(`wake ${res.status} ${text.slice(0, 180)}`);
  } catch (err) {
    log(`wake error ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runMonitor() {
  loadState();
  const logStream = fs.createWriteStream(paths().log, { flags: "a" });
  const log = (line) => {
    logStream.write(`${new Date().toISOString()} ${line}\n`);
  };
  log("monitor start");
  await notifyStart();
  const onExit = async () => {
    await notifyStop();
    clearPid();
    process.exit(0);
  };
  process.on("SIGTERM", onExit);
  process.on("SIGINT", onExit);
  let failures = 0;
  while (true) {
    try {
      const raw = await getUpdates();
      failures = 0;
      if (raw.session_expired) {
        await sleep(60_000);
        continue;
      }
      const collected = await collectInbound(raw.msgs || []);
      const allowed = collected.messages.filter((m) => isAllowed(loadState(), m.from_user_id));
      appendInbox(allowed);
      if (allowed.length) {
        log(`inbox +${allowed.length}`);
        await wakeAgent(allowed, log);
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
} else {
  startMcp();
}
