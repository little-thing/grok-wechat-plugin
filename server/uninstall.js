import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { homeDir, isMonitorProcess, listAccounts, loadState, monitorEntryPath } from "./store.js";

const GROK_BOX_HOME = "/home/box";
const PLUGIN_NAME = "grok-wechat-plugin";
const STATE_FILES = [
  "inbox.jsonl", "monitor.pid", "monitor.log",
  "ensure-monitor.sh", "connector-active",
];
const CREDENTIAL_TEMP = /^(?:account|wake)\.json\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

function standardStateHomes() {
  return [...new Set([GROK_BOX_HOME, os.homedir()].map((home) => path.join(home, ".grok-wechat")))];
}

function checkedEntry(file, type) {
  try {
    const stats = fs.lstatSync(file);
    const correctType = type === "dir" ? stats.isDirectory() : stats.isFile();
    if (!correctType || fs.realpathSync(file) !== file) return null;
    if (type === "private-file" && (stats.uid !== process.getuid() || stats.nlink !== 1 || (stats.mode & 0o077))) return null;
    return { path: file, dev: stats.dev, ino: stats.ino };
  } catch {
    return null;
  }
}

function sameEntry(a, b) {
  return Boolean(a && b && a.path === b.path && a.dev === b.dev && a.ino === b.ino);
}

function readJson(file, entry = checkedEntry(file, "file")) {
  if (!entry) return null;
  let fd;
  try {
    const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
    fd = fs.openSync(file, flags);
    const stats = fs.fstatSync(fd);
    if (!stats.isFile() || stats.dev !== entry.dev || stats.ino !== entry.ino) return null;
    return JSON.parse(fs.readFileSync(fd, "utf8"));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isAccountState(account) {
  if (Array.isArray(account?.accounts) && Array.isArray(account.pendingQrs) && Array.isArray(account.allowFrom)) return true;
  return (nonBlank(account?.token) && nonBlank(account.ilinkBotId)) || nonBlank(account?.pendingQr?.qrcode);
}

function isWakeState(wake) {
  return nonBlank(wake?.url) && nonBlank(wake.key);
}

function credentialEntries(dir) {
  return [
    ["account.json", isAccountState],
    ["wake.json", isWakeState],
  ].map(([name, matches]) => {
    const file = path.join(dir, name);
    const entry = checkedEntry(file, "file");
    return matches(readJson(file, entry)) ? entry : null;
  }).filter(Boolean);
}

function hasStateEvidence(dir) {
  return credentialEntries(dir).length > 0;
}

export function validateStateHome(dir, standardHomes = standardStateHomes(), protectedHomes = [os.homedir(), GROK_BOX_HOME, os.tmpdir()]) {
  if (!path.isAbsolute(dir) || path.dirname(dir) === path.parse(dir).root) return null;
  if (protectedHomes.some((home) => home === dir || home.startsWith(dir + path.sep))) return null;
  const root = checkedEntry(dir, "dir");
  if (!root) return null;
  if (standardHomes.includes(dir)) return { root, dedicated: true };
  const credentials = credentialEntries(dir);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    if (["EACCES", "EPERM", "ENOENT"].includes(error.code)) return null;
    throw error;
  }
  const temporaryCredentials = names.sort()
    .filter((name) => CREDENTIAL_TEMP.test(name))
    .map((name) => checkedEntry(path.join(dir, name), "private-file")).filter(Boolean);
  if (!credentials.length) {
    // A first write may have stopped before publishing any credential file.
    const files = temporaryCredentials.filter((file) => {
      const matches = path.basename(file.path).startsWith("account.") ? isAccountState : isWakeState;
      return matches(readJson(file.path, file));
    });
    return files.length ? { root, dedicated: false, files } : null;
  }

  const known = STATE_FILES.map((name) => checkedEntry(path.join(dir, name), "file")).filter(Boolean);
  const files = [...credentials, ...known, ...temporaryCredentials];
  const media = checkedEntry(path.join(dir, "media"), "dir");
  if (media) {
    for (const name of fs.readdirSync(media.path).sort()) {
      if (!/^\d{13}-.+/.test(name)) continue;
      const file = checkedEntry(path.join(media.path, name), "file");
      if (file) files.push(file);
    }
  }
  return { root, dedicated: false, files, media };
}

function pluginDirs() {
  const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = new Set([
    path.join(GROK_BOX_HOME, PLUGIN_NAME),
    path.join("/workspace", PLUGIN_NAME),
    source,
  ]);
  return [...candidates].map((dir) => {
    if (path.basename(dir) !== PLUGIN_NAME || !checkedEntry(dir, "dir")) return null;
    if (readJson(path.join(dir, "plugin.json"))?.name !== "grok-wechat") return null;
    if (!checkedEntry(path.join(dir, "server", "index.js"), "file")) return null;
    return checkedEntry(dir, "dir");
  }).filter(Boolean);
}

function command(file, args, input) {
  try {
    return execFileSync(file, args, {
      input,
      encoding: "utf8",
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
      timeout: 2000,
    });
  } catch {
    return null;
  }
}

function serverPids() {
  const out = command("pgrep", ["-f", "(^|[ /])server/index\\.js"]);
  return (out ?? "").trim().split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
}

function monitorPids(plugins) {
  const entries = [monitorEntryPath(), ...plugins.map((dir) => path.join(dir.path, "server", "index.js"))];
  return serverPids().filter((pid) => entries.some((entry) => isMonitorProcess(pid, entry)));
}

function stopMonitors(pids) {
  const stopped = [];
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      stopped.push(pid);
    } catch {}
  }
  return stopped;
}

function mcpStillRunning(plugins) {
  const entries = [monitorEntryPath(), ...plugins.map((dir) => path.join(dir.path, "server", "index.js"))];
  return serverPids().some((pid) => {
    const args = command("ps", ["-ww", "-p", String(pid), "-o", "args="])?.trim();
    if (!args || /(?:^|\s)--(?:monitor|uninstall|ensure-monitor)(?:\s|$)/.test(args)) return false;
    if (entries.some((entry) => args.includes(entry))) return true;
    if (!/\s(?:\.\/)?server\/index\.js(?:\s|$)/.test(args)) return false;
    if (process.platform !== "linux") return true;
    try {
      const cwd = fs.realpathSync("/proc/" + pid + "/cwd");
      return entries.includes(path.join(cwd, "server", "index.js"));
    } catch {
      return false;
    }
  });
}

function removeEmptyDir(dir) {
  if (!dir || !sameEntry(dir, checkedEntry(dir.path, "dir"))) return false;
  try {
    fs.rmdirSync(dir.path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTEMPTY") return false;
    throw error;
  }
}

function removeStateHome(home) {
  const { root, dedicated, files, media } = home;
  const current = validateStateHome(root.path);
  if (!sameEntry(root, current?.root) || current.dedicated !== dedicated) return false;
  if (dedicated) {
    fs.rmSync(root.path, { recursive: true, force: true });
    return true;
  }
  const approved = new Set(files.map((file) => file.path));
  for (const file of current.files) {
    if (approved.has(file.path) && sameEntry(file, checkedEntry(file.path, "file"))) fs.unlinkSync(file.path);
  }
  removeEmptyDir(media);
  return removeEmptyDir(root);
}

function removePluginDirs(approved) {
  const verified = pluginDirs();
  return approved.filter((dir) => {
    if (!verified.some((current) => sameEntry(dir, current))) return false;
    if (!sameEntry(dir, checkedEntry(dir.path, "dir"))) return false;
    fs.rmSync(dir.path, { recursive: true, force: true });
    return true;
  }).map((dir) => dir.path);
}

function withoutAutostart(text) {
  const custom = path.join(homeDir(), "ensure-monitor.sh");
  return text.split("\n").filter((line) => {
    const content = line.trim();
    if (content.startsWith("#")) return true;
    if (/(?:grok-wechat-plugin\/server\/index\.js|(?:grok-wechat-plugin|\.grok-wechat)\/ensure-monitor\.sh)(?=[\s"';&|)]|$)/.test(content)) return false;
    return !content.includes(custom) || !checkedEntry(custom, "file") || !hasStateEvidence(homeDir());
  }).join("\n");
}

function matchingProfiles() {
  const profiles = new Set();
  for (const home of [GROK_BOX_HOME, os.homedir()]) {
    for (const name of [".profile", ".bashrc", ".bash_profile"]) profiles.add(path.join(home, name));
  }
  return [...profiles].map((file) => {
    const entry = checkedEntry(file, "file");
    if (!entry) return null;
    return editProfile(entry, false) ? entry : null;
  }).filter(Boolean);
}

function replaceProfile(entry, fd, stats, content) {
  const tmp = `${entry.path}.grok-wechat.${randomUUID()}.tmp`;
  const tmpFd = fs.openSync(tmp, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(tmpFd, content);
      const tmpStats = fs.fstatSync(tmpFd);
      if (tmpStats.uid !== stats.uid || tmpStats.gid !== stats.gid) fs.fchownSync(tmpFd, stats.uid, stats.gid);
      fs.fchmodSync(tmpFd, stats.mode & 0o7777);
      fs.fsyncSync(tmpFd);
    } finally {
      fs.closeSync(tmpFd);
    }
    const current = fs.fstatSync(fd);
    if (current.nlink !== 1 || current.size !== stats.size || current.mtimeMs !== stats.mtimeMs
        || current.ctimeMs !== stats.ctimeMs || !sameEntry(entry, checkedEntry(entry.path, "file"))) return false;
    fs.renameSync(tmp, entry.path);
    return true;
  } finally {
    try { fs.unlinkSync(tmp); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function editProfile(entry, write) {
  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  const fd = fs.openSync(entry.path, flags);
  try {
    const stats = fs.fstatSync(fd);
    if (!stats.isFile() || stats.nlink !== 1 || stats.dev !== entry.dev || stats.ino !== entry.ino) return false;
    const current = fs.readFileSync(fd, "utf8");
    const next = withoutAutostart(current);
    if (current === next) return false;
    return !write || replaceProfile(entry, fd, stats, next);
  } finally {
    fs.closeSync(fd);
  }
}

export function touchConnectorActive() {
  const homes = new Set(standardStateHomes());
  const active = homeDir();
  if (checkedEntry(active, "dir") && hasStateEvidence(active)) homes.add(active);
  for (const dir of homes) {
    if (!checkedEntry(dir, "dir")) continue;
    const marker = path.join(dir, "connector-active");
    try {
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
      const fd = fs.openSync(marker, flags, 0o600);
      try {
        const stats = fs.fstatSync(fd);
        if (!stats.isFile() || stats.nlink !== 1) continue;
        fs.ftruncateSync(fd, 0);
        fs.writeFileSync(fd, String(Date.now()) + "\n");
      } finally {
        fs.closeSync(fd);
      }
    } catch {}
  }
}

export async function finishDeferredUninstall(plan) {
  await delay(3000);
  const deadline = Date.now() + 60_000;
  while (mcpStillRunning(plan.plugins)) {
    if (Date.now() >= deadline) return;
    await delay(1000);
  }
  stopMonitors(monitorPids(plan.plugins));
  const monitorDeadline = Date.now() + 30_000;
  while (monitorPids(plan.plugins).length) {
    if (Date.now() >= monitorDeadline) return;
    await delay(500);
  }
  executeCleanup(plan);
}

function scheduleDeferredUninstall(plan) {
  const worker = [
    "const { finishDeferredUninstall } = await import(process.argv[1]);",
    "process.stdin.setEncoding('utf8');",
    "let plan = '';",
    "for await (const chunk of process.stdin) plan += chunk;",
    "await finishDeferredUninstall(JSON.parse(plan));",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", worker, import.meta.url], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
  });
  child.on("error", () => {});
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify(plan));
  child.unref();
  return Boolean(child.pid);
}

function collectDedicatedAssistants(stateHomes) {
  const state = path.join(homeDir(), "account.json");
  if (!stateHomes.some(({ root }) => root.path === homeDir()) || !checkedEntry(state, "file")) return [];
  return listAccounts(loadState({ createHome: false }))
    .map((a) => ({
      ilink_bot_id: a.ilinkBotId,
      assistant_id: a.dedicatedAssistant?.id || "",
      assistant_name: a.dedicatedAssistant?.name || "",
    }))
    .filter((a) => a.assistant_id || a.assistant_name);
}

function platformCleanup(dedicatedAssistants) {
  const sidebarNames = dedicatedAssistants.map((a) => a.assistant_name).filter(Boolean);
  return {
    connector: "grok-wechat",
    routine_names: ["微信入站唤醒", "微信监听保活"],
    dedicated_assistants_sidebar_delete: dedicatedAssistants,
    dedicated_assistant_sidebar_names: sidebarNames,
    execute: [
      "从 Grok Bot Settings 卸载 grok-wechat 连接器（若仍存在）",
      "删除安装助手上 Routine「微信入站唤醒」与「微信监听保活」",
      "删除其他助手上残留的同名 Routine",
      sidebarNames.length
        ? `告知用户在侧栏右键 → 删除专属助手：${sidebarNames.join("、")}`
        : "告知用户在侧栏删除绑定期间创建的专属助手",
    ],
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function executeCleanup({ stateHomes, plugins, profiles, crontabHash }) {
  const removedAutostart = [];
  const currentProfiles = matchingProfiles();
  for (const file of profiles) {
    if (currentProfiles.some((current) => sameEntry(file, current)) && editProfile(file, true)) {
      removedAutostart.push(file.path);
    }
  }
  const crontab = crontabHash && command("crontab", ["-l"]);
  if (crontab && digest(crontab) === crontabHash && command("crontab", ["-"], withoutAutostart(crontab)) !== null) {
    removedAutostart.push("crontab");
  }

  const statePaths = new Set([...standardStateHomes(), homeDir()]);
  const removedStateDirs = [];
  const retainedStateDirs = [];
  for (const home of stateHomes) {
    if (!statePaths.has(home.root.path)) continue;
    const result = removeStateHome(home) ? removedStateDirs : retainedStateDirs;
    result.push(home.root.path);
  }
  return {
    removed_state_dirs: removedStateDirs,
    retained_state_dirs: retainedStateDirs,
    removed_plugin_dirs: removePluginDirs(plugins),
    removed_autostart: removedAutostart,
  };
}

export function runUninstall({ deferPluginRemoval = false } = {}) {
  const standardHomes = standardStateHomes();
  const candidates = [...new Set([...standardHomes, homeDir()])];
  const stateHomes = candidates.map((dir) => validateStateHome(dir)).filter(Boolean);
  const plugins = pluginDirs();
  const profiles = matchingProfiles();
  const crontab = command("crontab", ["-l"]);
  const crontabHash = crontab && withoutAutostart(crontab) !== crontab ? digest(crontab) : null;
  const plan = { stateHomes, plugins, profiles, crontabHash };
  const token = digest(JSON.stringify({
    ...plan,
    stateHomes: stateHomes.map(({ files, ...home }) => ({ ...home, files: files?.map((file) => file.path) })),
  }));
  const dedicatedAssistants = collectDedicatedAssistants(stateHomes);
  const platform = {
    dedicated_assistants_sidebar_delete: dedicatedAssistants,
    platform_cleanup: platformCleanup(dedicatedAssistants),
  };

  const customHome = homeDir();
  const skippedCustomHome = !standardHomes.includes(customHome) && !stateHomes.some(({ root }) => root.path === customHome)
    ? customHome : undefined;
  const args = process.argv.slice(2);
  const confirmation = args.indexOf("--confirm");
  const confirmed = args.includes("--uninstall") && confirmation !== -1 && args[confirmation + 1] === token;
  if (!confirmed) {
    return {
      uninstalled: false,
      confirmation_required: true,
      state_dirs: stateHomes.map(({ root, dedicated, files, media }) => ({
        path: root.path,
        recursive: dedicated,
        ...(dedicated ? {} : { files: files.map((file) => file.path), media: media?.path }),
      })),
      plugin_dirs: plugins.map((dir) => dir.path),
      profile_files: profiles.map((file) => file.path),
      remove_crontab_entries: Boolean(crontabHash),
      skipped_custom_home: skippedCustomHome,
      confirmation_token: token,
      confirmation_command: [
        ...(process.env.GROK_WECHAT_HOME?.trim() ? ["env", "GROK_WECHAT_HOME=" + customHome] : []),
        process.execPath, fileURLToPath(import.meta.url), "--uninstall", "--confirm", token,
      ],
      next_step: "Review the absolute paths. On this host, run sh scripts/uninstall.sh --confirm TOKEN in the plugin directory with the same configuration. Use confirmation_token for TOKEN.",
      ...platform,
    };
  }

  if (deferPluginRemoval || mcpStillRunning(plugins) || monitorPids(plugins).length) {
    const deferred = scheduleDeferredUninstall(plan);
    return {
      uninstalled: false,
      cleanup_deferred: deferred,
      deferred_plugin_removal: deferred && plugins.length > 0,
      skipped_custom_home: skippedCustomHome,
      ...platform,
    };
  }
  return {
    uninstalled: true,
    skipped_custom_home: skippedCustomHome,
    ...executeCleanup(plan),
    ...platform,
  };
}

export function uninstallWechat() {
  return runUninstall({ deferPluginRemoval: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runUninstall();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
