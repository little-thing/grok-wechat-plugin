import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearPid, homeDir, monitorRunning, readPid } from "./store.js";

const PLUGIN_DIR_NAMES = ["grok-wechat-plugin"];
const GROK_BOX_HOME = "/home/box";
const MONITOR_MATCH = "grok-wechat-plugin/server/index.js --monitor";
const MCP_MATCH = "grok-wechat-plugin/server/index.js";

function isPluginDir(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return PLUGIN_DIR_NAMES.includes(path.basename(path.resolve(dir)));
}

export function knownStateHomes() {
  const homes = new Set([
    path.join(GROK_BOX_HOME, ".grok-wechat"),
    path.join(os.homedir(), ".grok-wechat"),
  ]);
  const envHome = process.env.GROK_WECHAT_HOME?.trim();
  if (envHome) homes.add(path.resolve(envHome));
  homes.add(homeDir());
  return [...homes];
}

export function knownPluginDirs() {
  const dirs = new Set([
    path.join(GROK_BOX_HOME, "grok-wechat-plugin"),
    "/workspace/grok-wechat-plugin",
  ]);
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const parent = path.dirname(here);
    if (isPluginDir(parent)) dirs.add(parent);
  } catch {
    // ignore
  }
  return [...dirs];
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function listMonitorPids() {
  const pids = new Set();
  const fromFile = readPid();
  if (fromFile) pids.add(fromFile);
  const running = monitorRunning();
  if (running) pids.add(running);
  try {
    const out = sh(`pgrep -f "${MONITOR_MATCH}" 2>/dev/null || true`);
    for (const line of out.split("\n")) {
      const n = Number(line.trim());
      if (Number.isFinite(n) && n > 0) pids.add(n);
    }
  } catch {
    // ignore
  }
  return [...pids];
}

export function stopAllMonitors() {
  const stopped = [];
  for (const pid of listMonitorPids()) {
    try {
      process.kill(pid, "SIGTERM");
      stopped.push(pid);
    } catch {
      // already gone
    }
  }
  clearPid();
  try {
    sh(`pkill -TERM -f "${MONITOR_MATCH}" 2>/dev/null || true`);
  } catch {
    // ignore
  }
  return [...new Set(stopped)];
}

function removeDir(target) {
  if (!target || !fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

export function removeAllStateHomes() {
  const removed = [];
  for (const dir of knownStateHomes()) {
    if (removeDir(dir)) removed.push(dir);
  }
  return [...new Set(removed)];
}

export function removeAllPluginDirs() {
  const removed = [];
  for (const dir of knownPluginDirs()) {
    if (!isPluginDir(dir)) continue;
    if (removeDir(dir)) removed.push(dir);
  }
  return removed;
}

function lineMatchesAutostart(line) {
  const text = line.trim();
  if (!text || text.startsWith("#")) return false;
  return /grok-wechat|ensure-monitor\.sh/.test(text);
}

function stripAutostartFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const original = fs.readFileSync(filePath, "utf8");
  const lines = original.split("\n");
  const kept = lines.filter((line) => !lineMatchesAutostart(line));
  if (kept.length === lines.length) return false;
  const next = kept.join("\n");
  if (next.trim()) fs.writeFileSync(filePath, next.endsWith("\n") ? next : `${next}\n`);
  else fs.unlinkSync(filePath);
  return true;
}

export function removeAutostartEntries() {
  const touched = [];
  const profileFiles = [
    path.join(GROK_BOX_HOME, ".profile"),
    path.join(GROK_BOX_HOME, ".bashrc"),
    path.join(GROK_BOX_HOME, ".bash_profile"),
    path.join(os.homedir(), ".profile"),
    path.join(os.homedir(), ".bashrc"),
    path.join(os.homedir(), ".bash_profile"),
  ];
  for (const file of profileFiles) {
    if (stripAutostartFromFile(file)) touched.push(file);
  }
  try {
    const current = sh("crontab -l 2>/dev/null || true");
    if (current) {
      const lines = current.split("\n");
      const kept = lines.filter((line) => !lineMatchesAutostart(line));
      if (kept.length !== lines.length) {
        const tmp = path.join(os.tmpdir(), `grok-wechat-crontab-${process.pid}`);
        fs.writeFileSync(tmp, kept.join("\n") + (kept.length ? "\n" : ""));
        sh(`crontab "${tmp}"`);
        fs.unlinkSync(tmp);
        touched.push("crontab");
      }
    }
  } catch {
    // ignore
  }
  return touched;
}

function mcpStillRunning() {
  try {
    const out = sh(`pgrep -f "${MCP_MATCH}" 2>/dev/null || true`);
    for (const line of out.split("\n")) {
      const pid = Number(line.trim());
      if (!Number.isFinite(pid) || pid <= 0) continue;
      const args = sh(`ps -p ${pid} -o args= 2>/dev/null || true`);
      if (args && !args.includes("--monitor") && !args.includes("--uninstall")) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

let mcpGoneSince = 0;

export function connectorAbandoned() {
  if (mcpStillRunning()) {
    mcpGoneSince = 0;
    return false;
  }
  if (!mcpGoneSince) mcpGoneSince = Date.now();
  return Date.now() - mcpGoneSince > 30_000;
}

export function touchConnectorActive() {
  for (const home of knownStateHomes()) {
    try {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(path.join(home, "connector-active"), `${Date.now()}\n`);
    } catch {
      // ignore
    }
  }
}

function deferredCleanupShell() {
  const stateDirs = knownStateHomes().map((d) => `"${d}"`).join(" ");
  const pluginDirs = knownPluginDirs().map((d) => `"${d}"`).join(" ");
  return `
sleep 3
if pgrep -f "${MCP_MATCH}" >/dev/null 2>&1; then
  for pid in $(pgrep -f "${MCP_MATCH}" 2>/dev/null || true); do
    args=$(ps -p "$pid" -o args= 2>/dev/null || true)
    case "$args" in *--monitor*|*--uninstall*) ;; *) exit 0 ;; esac
  done
fi
pkill -TERM -f "${MONITOR_MATCH}" 2>/dev/null || true
for d in ${stateDirs}; do rm -rf "$d" 2>/dev/null || true; done
for d in ${pluginDirs}; do rm -rf "$d" 2>/dev/null || true; done
for f in /home/box/.profile /home/box/.bashrc /home/box/.bash_profile "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile"; do
  [ -f "$f" ] || continue
  grep -v -E 'grok-wechat|ensure-monitor\\.sh' "$f" > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f" || true
done
crontab -l 2>/dev/null | grep -v -E 'grok-wechat|ensure-monitor\\.sh' | crontab - 2>/dev/null || true
`.trim();
}

let shutdownHookRegistered = false;

export function scheduleDeferredUninstall() {
  try {
    const child = spawn("sh", ["-c", deferredCleanupShell()], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function registerShutdownCleanup() {
  if (shutdownHookRegistered) return;
  shutdownHookRegistered = true;
  const run = () => scheduleDeferredUninstall();
  process.once("SIGTERM", run);
  process.once("SIGINT", run);
  process.once("SIGHUP", run);
  process.stdin?.once("end", run);
  process.stdin?.once("close", run);
}

function platformCleanup() {
  return {
    connector: "grok-wechat",
    routine_names: ["微信入站唤醒", "微信监听保活"],
    execute: [
      "从 Grok Bot Settings 卸载 grok-wechat 连接器（若仍存在）",
      "删除安装助手上 Routine「微信入站唤醒」与「微信监听保活」",
      "删除其他助手上残留的同名 Routine",
    ],
  };
}

export function runUninstall({ deferPluginRemoval = false } = {}) {
  const stoppedPids = stopAllMonitors();
  const removedAutostart = removeAutostartEntries();
  const removedStateDirs = removeAllStateHomes();
  let removedPluginDirs = [];
  let deferredPluginRemoval = false;

  if (deferPluginRemoval || mcpStillRunning()) {
    scheduleDeferredUninstall();
    deferredPluginRemoval = true;
  } else {
    removedPluginDirs = removeAllPluginDirs();
  }

  return {
    uninstalled: true,
    stopped_monitor_pids: stoppedPids,
    removed_state_dirs: removedStateDirs,
    removed_plugin_dirs: removedPluginDirs,
    removed_autostart: removedAutostart,
    deferred_plugin_removal: deferredPluginRemoval,
    platform_cleanup: platformCleanup(),
  };
}

export function uninstallWechat() {
  return runUninstall({ deferPluginRemoval: true });
}

if (process.argv.includes("--uninstall")) {
  const immediate = process.argv.includes("--immediate");
  process.stdout.write(`${JSON.stringify(runUninstall({ deferPluginRemoval: !immediate }), null, 2)}\n`);
}
