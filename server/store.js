import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  };
}

const warnedModes = new Set();

function warnIfExposed(file, stats) {
  if (!stats) {
    try {
      stats = fs.lstatSync(file, { throwIfNoEntry: false });
    } catch {
      return;
    }
  }
  if (!stats || stats.isSymbolicLink() || !(stats.mode & 0o077)) return;
  const mode = (stats.mode & 0o777).toString(8);
  const warning = `grok-wechat: ${file} has mode ${mode}; restrict access to the owner`;
  if (warnedModes.has(warning)) return;
  warnedModes.add(warning);
  process.emitWarning(warning);
}

function checkStateHome(home) {
  const stats = fs.lstatSync(home, { throwIfNoEntry: false });
  if (!stats) {
    const parent = path.dirname(home);
    if (parent !== home) checkStateHome(parent);
    return null;
  }
  if (!stats.isDirectory() || fs.realpathSync(home) !== home) {
    throw new Error(`grok-wechat: state directory must be a real directory without symbolic links: ${home}`);
  }
  return stats;
}

function ensureStateHome(home) {
  const existing = checkStateHome(home);
  if (existing) return existing;
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  return checkStateHome(home);
}

export function ensureMediaDirectory() {
  const { media } = paths();
  ensureStateHome(media);
  return media;
}

function ensureHome() {
  const stats = ensureStateHome(homeDir());
  ensureMediaDirectory();
  return stats;
}

function ensurePrivateWriteHome() {
  const { home } = paths();
  let stats = ensureStateHome(home);
  const defaultHome = path.join(os.homedir(), ".grok-wechat");
  if (home === defaultHome) {
    const fd = fs.openSync(home, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      stats = fs.fstatSync(fd);
      if ((stats.mode & 0o7777) !== 0o700) {
        fs.fchmodSync(fd, 0o700);
        stats = fs.fstatSync(fd);
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  if (stats.mode & 0o022) throw new Error(`grok-wechat: state directory is writable by other users: ${home}`);
  warnIfExposed(home, stats);
  ensureHome();
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

function readCredential(file) {
  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  let fd;
  try {
    fd = fs.openSync(file, flags);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw new Error(`grok-wechat: credential file is a symbolic link: ${file}`);
    throw error;
  }
  try {
    const stats = fs.fstatSync(fd);
    if (!stats.isFile()) throw new Error(`grok-wechat: credential path must be a regular file: ${file}`);
    warnIfExposed(file, stats);
    const content = fs.readFileSync(fd, "utf8");
    try {
      return JSON.parse(content);
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function loadState({ createHome = true } = {}) {
  const { home, state, inbox, media, log } = paths();
  const stats = createHome ? ensureHome() : checkStateHome(home);
  if (!stats) return emptyState();
  warnIfExposed(home, stats);
  for (const file of [inbox, media, log]) warnIfExposed(file);
  const raw = readCredential(state);
  return raw ? { ...emptyState(), ...migrateLegacyState(raw) } : emptyState();
}

function writePrivateJson(file, value) {
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`grok-wechat: credential file is a symbolic link: ${file}`);
  }
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    try {
      fs.fchmodSync(fd, 0o600);
      fs.writeFileSync(fd, payload);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

export function saveState(next) {
  ensurePrivateWriteHome();
  writePrivateJson(paths().state, next);
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
  fs.appendFileSync(inbox, lines, { mode: 0o600 });
}

export function drainInbox() {
  const { inbox } = paths();
  if (!fs.existsSync(inbox)) return [];
  const raw = fs.readFileSync(inbox, "utf8");
  fs.writeFileSync(inbox, "", { mode: 0o600 });
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
  fs.writeFileSync(paths().pid, String(pid), { mode: 0o600 });
}

export function readPid() {
  const { pid } = paths();
  if (!fs.existsSync(pid)) return 0;
  const n = Number(fs.readFileSync(pid, "utf8").trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function clearPid() {
  const { pid } = paths();
  if (fs.existsSync(pid)) fs.unlinkSync(pid);
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function monitorEntryPath() {
  return fileURLToPath(new URL("./index.js", import.meta.url));
}

function sameFile(token, entry) {
  if (token === entry) return true;
  if (!token || token.startsWith("-") || !token.includes(path.sep)) return false;
  try {
    return fs.realpathSync(token) === fs.realpathSync(entry);
  } catch {
    return false;
  }
}

function containsArg(line, token) {
  let from = 0;
  while (from <= line.length) {
    const idx = line.indexOf(token, from);
    if (idx < 0) return false;
    const before = idx === 0 ? " " : line[idx - 1];
    const after = line[idx + token.length] ?? " ";
    if (/\s/.test(before) && /\s/.test(after)) return true;
    from = idx + Math.max(token.length, 1);
  }
  return false;
}

function readLinuxArgv(pid) {
  try {
    const parts = fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean);
    return parts.length ? parts : null;
  } catch {
    return null;
  }
}

function readPosixCommand(pid) {
  try {
    const comm = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const args = execFileSync("ps", ["-ww", "-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!comm || !args) return null;
    return { comm, args };
  } catch {
    return null;
  }
}

function commandLineIsMonitor(line, entry) {
  if (!containsArg(line, "--monitor")) return false;
  if (containsArg(line, entry)) return true;
  try {
    const real = fs.realpathSync(entry);
    return real !== entry && containsArg(line, real);
  } catch {
    return false;
  }
}

// Linux thread ids share the pid namespace, so kill(pid, 0) can succeed for a
// live thread inside the MCP host. A recorded id counts only when argv is this
// install's server entry plus --monitor.
export function isMonitorProcess(pid, entry = monitorEntryPath()) {
  if (!isPidAlive(pid)) return false;
  if (process.platform === "linux") {
    const argv = readLinuxArgv(pid);
    return Boolean(argv && argv.includes("--monitor") && argv.some((arg) => sameFile(arg, entry)));
  }
  const info = readPosixCommand(pid);
  if (!info || path.basename(info.comm) !== path.basename(process.execPath)) return false;
  return commandLineIsMonitor(info.args, entry);
}

export function monitorRunning() {
  const pid = readPid();
  if (!pid) return 0;
  if (isMonitorProcess(pid)) return pid;
  clearPid();
  return 0;
}

export function stopMonitorProcess() {
  const pid = monitorRunning();
  if (!pid || !isMonitorProcess(pid)) {
    if (pid) clearPid();
    return 0;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
  clearPid();
  return pid;
}

export function fallbackWakePath() {
  return path.join(homeDir(), "wake.json");
}

export function loadFallbackWake() {
  if (!checkStateHome(homeDir())) return null;
  const cfg = readCredential(fallbackWakePath());
  return cfg?.url && cfg.key ? { url: cfg.url, key: cfg.key } : null;
}

export function saveGlobalWake(url, key) {
  ensurePrivateWriteHome();
  writePrivateJson(fallbackWakePath(), { url, key });
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

export { saveState as saveStateSecure };
