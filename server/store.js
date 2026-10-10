import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_BASE = "https://ilinkai.weixin.qq.com";
const MAX_LOCAL_TOKENS = 10;

export function homeDir() {
  const raw = process.env.GROK_WECHAT_HOME?.trim();
  if (raw) return path.resolve(raw);
  return path.join(os.homedir(), ".grok-wechat");
}

export function paths() {
  const home = homeDir();
  return {
    home,
    state: path.join(home, "account.json"),
    inbox: path.join(home, "inbox.jsonl"),
    pid: path.join(home, "monitor.pid"),
    media: path.join(home, "media"),
    log: path.join(home, "monitor.log"),
  };
}

export function emptyAccount() {
  return {
    token: "",
    baseUrl: DEFAULT_BASE,
    ilinkBotId: "",
    ilinkUserId: "",
    getUpdatesBuf: "",
    contextTokens: {},
    typingTickets: {},
    wake: null,
    dedicatedAssistant: null,
  };
}

export function emptyState() {
  return {
    accounts: [],
    pendingQrs: [],
    allowFrom: [],
    /** One shared Grok Bot assistant for all WeChat talks (keeps chat context). */
    sharedAssistant: null,
  };
}

const MAX_TALK_TURNS = 80;

export function talkKey(ilinkBotId, fromUserId) {
  return `${ilinkBotId || ""}::${fromUserId || ""}`;
}

function talksPath() {
  return path.join(homeDir(), "talks.json");
}

export function loadTalks() {
  ensureHome();
  const file = talksPath();
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveTalks(talks) {
  ensureHome();
  const file = talksPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(talks, null, 2));
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // ignore
  }
}

/**
 * Append a turn to the shared Grok-session talk log for a WeChat peer.
 * role: "user" | "assistant"
 */
export function appendTalk({ ilink_bot_id, from_user_id, role, text, items, at } = {}) {
  if (!from_user_id || !role) return [];
  const key = talkKey(ilink_bot_id, from_user_id);
  const talks = loadTalks();
  const entry = {
    role,
    text: String(text || "").slice(0, 8000),
    at: at || Date.now(),
  };
  if (items?.length) entry.items = items;
  const list = Array.isArray(talks[key]) ? talks[key] : [];
  list.push(entry);
  talks[key] = list.slice(-MAX_TALK_TURNS);
  saveTalks(talks);
  return talks[key];
}

export function getTalkHistory(ilink_bot_id, from_user_id, limit = 40) {
  if (!from_user_id) return [];
  const list = loadTalks()[talkKey(ilink_bot_id, from_user_id)] || [];
  const n = Math.max(1, Math.min(Number(limit) || 40, MAX_TALK_TURNS));
  return list.slice(-n);
}

export function getSharedAssistant(state = loadState()) {
  if (state.sharedAssistant?.name || state.sharedAssistant?.id) {
    return {
      id: state.sharedAssistant.id || "",
      name: state.sharedAssistant.name || "",
    };
  }
  for (const a of listAccounts(state)) {
    if (a.dedicatedAssistant?.name || a.dedicatedAssistant?.id) {
      return {
        id: a.dedicatedAssistant.id || "",
        name: a.dedicatedAssistant.name || "",
      };
    }
  }
  return null;
}

export function setSharedAssistant(assistant_id, assistant_name) {
  if (!assistant_name) throw new Error("assistant_name 必填");
  updateState((s) => {
    s.sharedAssistant = {
      id: assistant_id || s.sharedAssistant?.id || "",
      name: assistant_name,
    };
    // Keep per-account fields in sync so older status/uninstall paths still work.
    for (const a of s.accounts) {
      a.dedicatedAssistant = { ...s.sharedAssistant };
    }
    return s;
  });
  return getSharedAssistant();
}

function ensureHome() {
  const { home, media } = paths();
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(media, { recursive: true });
}

function migrateLegacyState(raw) {
  if (Array.isArray(raw.accounts)) return raw;
  const state = emptyState();
  if (raw.token) {
    state.accounts.push({
      ...emptyAccount(),
      token: raw.token,
      baseUrl: raw.baseUrl || DEFAULT_BASE,
      ilinkBotId: raw.ilinkBotId || "",
      ilinkUserId: raw.ilinkUserId || "",
      getUpdatesBuf: raw.getUpdatesBuf || "",
      contextTokens: raw.contextTokens || {},
      typingTickets: raw.typingTickets || {},
    });
  }
  if (raw.pendingQr?.qrcode) {
    state.pendingQrs.push(raw.pendingQr);
  }
  state.allowFrom = raw.allowFrom || [];
  return state;
}

export function loadState() {
  ensureHome();
  const { state } = paths();
  if (!fs.existsSync(state)) return emptyState();
  try {
    const raw = JSON.parse(fs.readFileSync(state, "utf8"));
    const migrated = { ...emptyState(), ...migrateLegacyState(raw) };
    if (!migrated.sharedAssistant?.name) {
      const fromAccount = migrated.accounts.find((a) => a.dedicatedAssistant?.name);
      if (fromAccount?.dedicatedAssistant) {
        migrated.sharedAssistant = {
          id: fromAccount.dedicatedAssistant.id || "",
          name: fromAccount.dedicatedAssistant.name || "",
        };
      }
    }
    return migrated;
  } catch {
    return emptyState();
  }
}

export function saveState(next) {
  ensureHome();
  const { state } = paths();
  const tmp = `${state}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, state);
}

export function updateState(mutator) {
  const current = loadState();
  const next = mutator(current) ?? current;
  saveState(next);
  return next;
}

export function listAccounts(state = loadState()) {
  return state.accounts.filter((a) => a.token);
}

export function findAccount(state, { ilink_bot_id, ilink_user_id, token } = {}) {
  if (ilink_bot_id) {
    const hit = state.accounts.find((a) => a.ilinkBotId === ilink_bot_id);
    if (hit) return hit;
  }
  if (ilink_user_id) {
    const hit = state.accounts.find((a) => a.ilinkUserId === ilink_user_id);
    if (hit) return hit;
  }
  if (token) {
    const hit = state.accounts.find((a) => a.token === token);
    if (hit) return hit;
  }
  return null;
}

export function requireAccount(state, { ilink_bot_id, ilink_user_id } = {}) {
  if (ilink_bot_id || ilink_user_id) {
    const account = findAccount(state, { ilink_bot_id, ilink_user_id });
    if (!account?.token) {
      throw new Error(`未找到账号 ilink_bot_id=${ilink_bot_id || ""} ilink_user_id=${ilink_user_id || ""}`);
    }
    return account;
  }
  const accounts = listAccounts(state);
  if (!accounts.length) throw new Error("未登录。先 wechat_login_start 出码，立即 wechat_login_wait 至 logged_in=true");
  if (accounts.length === 1) return accounts[0];
  throw new Error("已绑定多个微信账号，请指定 ilink_bot_id");
}

export function localTokenList(state = loadState()) {
  return listAccounts(state)
    .map((a) => a.token)
    .slice(0, MAX_LOCAL_TOKENS);
}

export function upsertAccount(state, account) {
  const idx = state.accounts.findIndex((a) =>
  (account.ilinkBotId && a.ilinkBotId === account.ilinkBotId)
  || (account.token && a.token === account.token));
  if (idx >= 0) {
    state.accounts[idx] = { ...state.accounts[idx], ...account };
    const [updated] = state.accounts.splice(idx, 1);
    state.accounts.unshift(updated);
  } else {
    state.accounts.unshift(account);
  }
  return state;
}

export function removeAccount(state, { ilink_bot_id, ilink_user_id } = {}) {
  state.accounts = state.accounts.filter((a) => {
    if (ilink_bot_id && a.ilinkBotId === ilink_bot_id) return false;
    if (ilink_user_id && a.ilinkUserId === ilink_user_id) return false;
    return true;
  });
  return state;
}

export function rememberContext(state, account, userId, contextToken) {
  if (!account || !userId || !contextToken) return state;
  account.contextTokens[userId] = { token: contextToken, at: Date.now() };
  return state;
}

export function contextFor(account, userId) {
  const entry = account?.contextTokens?.[userId];
  return entry?.token || "";
}

export function accountsWithContext(state, userId) {
  return listAccounts(state).filter((a) => contextFor(a, userId));
}

export function resolveAccountForPeer(state, { to_user_id, ilink_bot_id } = {}) {
  if (ilink_bot_id) return requireAccount(state, { ilink_bot_id });
  if (!to_user_id) throw new Error("没有目标用户。传入 to_user_id，或等对方先发一条微信");
  const matches = accountsWithContext(state, to_user_id);
  if (!matches.length) {
    throw new Error("还没有该用户的 context_token。对方需要先从微信给你发一条消息，会话通道才会建立");
  }
  if (matches.length > 1) {
    throw new Error(`多个账号都能回复 ${to_user_id}，请指定 ilink_bot_id`);
  }
  return matches[0];
}

export function isAllowed(state, userId) {
  if (!userId) return false;
  if (!state.allowFrom?.length) return true;
  return state.allowFrom.includes(userId);
}

export function appendInbox(messages) {
  if (!messages.length) return;
  ensureHome();
  const { inbox } = paths();
  const lines = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  fs.appendFileSync(inbox, lines);
}

export function drainInbox() {
  const { inbox } = paths();
  if (!fs.existsSync(inbox)) return [];
  const raw = fs.readFileSync(inbox, "utf8");
  fs.writeFileSync(inbox, "");
  const shared = getSharedAssistant();
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((msg) => ({
      ...msg,
      session_id: msg.session_id || talkKey(msg.ilink_bot_id, msg.from_user_id),
      shared_assistant_id: shared?.id || msg.dedicated_assistant_id || msg.shared_assistant_id || "",
      shared_assistant_name: shared?.name || msg.dedicated_assistant_name || msg.shared_assistant_name || "",
      // Prefer history stamped before the current turn was recorded.
      history: Array.isArray(msg.history)
        ? msg.history
        : getTalkHistory(msg.ilink_bot_id, msg.from_user_id),
    }));
}

export function peekInboxCount() {
  const { inbox } = paths();
  if (!fs.existsSync(inbox)) return 0;
  return fs
    .readFileSync(inbox, "utf8")
    .split("\n")
    .filter((line) => line.trim()).length;
}

export function writePid(pid) {
  ensureHome();
  fs.writeFileSync(paths().pid, String(pid));
}

export function readPid() {
  const { pid } = paths();
  if (!fs.existsSync(pid)) return 0;
  const n = Number(fs.readFileSync(pid, "utf8").trim());
  return Number.isFinite(n) ? n : 0;
}

export function clearPid() {
  const { pid } = paths();
  if (fs.existsSync(pid)) fs.unlinkSync(pid);
}

export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function monitorRunning() {
  const pid = readPid();
  if (isPidAlive(pid)) return pid;
  if (pid) clearPid();
  return 0;
}

export function fallbackWakePath() {
  return path.join(homeDir(), "wake.json");
}

export function loadFallbackWake() {
  const wakeFile = fallbackWakePath();
  if (!fs.existsSync(wakeFile)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(wakeFile, "utf8"));
    if (cfg.url && cfg.key) return { url: cfg.url, key: cfg.key };
  } catch {
    // ignore
  }
  return null;
}

export function saveGlobalWake(url, key) {
  ensureHome();
  const wakeFile = fallbackWakePath();
  const tmp = `${wakeFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ url, key }, null, 2));
  fs.renameSync(tmp, wakeFile);
  try {
    fs.chmodSync(wakeFile, 0o600);
  } catch {
    // ignore
  }
}

export function hasGlobalWake() {
  return Boolean(loadFallbackWake());
}

export function resolveWakeForAccount(account) {
  if (account?.wake?.url && account?.wake?.key) return account.wake;
  return loadFallbackWake();
}

export function hasAccountWake(account) {
  return hasGlobalWake() || Boolean(account?.wake?.url && account?.wake?.key);
}

export function saveStateSecure(next) {
  saveState(next);
  try {
    fs.chmodSync(paths().state, 0o600);
  } catch {
    // ignore
  }
}
