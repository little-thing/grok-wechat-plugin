import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_BASE = "https://ilinkai.weixin.qq.com";

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

export function emptyState() {
  return {
    token: "",
    baseUrl: DEFAULT_BASE,
    ilinkBotId: "",
    ilinkUserId: "",
    getUpdatesBuf: "",
    contextTokens: {},
    typingTickets: {},
    allowFrom: [],
    pendingQr: null,
    lastFromUserId: "",
  };
}

function ensureHome() {
  const { home, media } = paths();
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(media, { recursive: true });
}

export function loadState() {
  ensureHome();
  const { state } = paths();
  if (!fs.existsSync(state)) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(state, "utf8")) };
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

export function rememberContext(state, userId, contextToken) {
  if (!userId || !contextToken) return state;
  state.contextTokens[userId] = { token: contextToken, at: Date.now() };
  state.lastFromUserId = userId;
  return state;
}

export function contextFor(state, userId) {
  const entry = state.contextTokens[userId];
  return entry?.token || "";
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
    .filter(Boolean);
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
