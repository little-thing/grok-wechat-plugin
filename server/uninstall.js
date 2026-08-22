import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearPid, homeDir, monitorRunning, paths, readPid } from "./store.js";

const PLUGIN_DIR_NAMES = ["grok-wechat-plugin"];

function isPluginDir(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  const base = path.basename(path.resolve(dir));
  return PLUGIN_DIR_NAMES.includes(base);
}

function defaultPluginDirs() {
  const dirs = new Set([
    "/home/box/grok-wechat-plugin",
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

function stopMonitorProcesses() {
  const stopped = [];
  const pid = readPid();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
      stopped.push(pid);
    } catch {
      // already gone
    }
    clearPid();
  }
  const running = monitorRunning();
  if (running && !stopped.includes(running)) {
    try {
      process.kill(running, "SIGTERM");
      stopped.push(running);
    } catch {
      // already gone
    }
    clearPid();
  }
  try {
    execSync('pkill -f "grok-wechat-plugin/server/index.js --monitor" 2>/dev/null || true', {
      stdio: "ignore",
      shell: "/bin/sh",
    });
  } catch {
    // ignore
  }
  return stopped;
}

function removeDir(target) {
  if (!target || !fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function removeStateDir(stateHome) {
  const removed = [];
  const candidates = new Set([stateHome, homeDir(), path.join(os.homedir(), ".grok-wechat")]);
  const envHome = process.env.GROK_WECHAT_HOME?.trim();
  if (envHome) candidates.add(path.resolve(envHome));
  for (const dir of candidates) {
    if (removeDir(dir)) removed.push(dir);
  }
  return removed;
}

function removePluginDirs(extraDirs = []) {
  const removed = [];
  const candidates = new Set([...defaultPluginDirs(), ...extraDirs]);
  for (const dir of candidates) {
    if (!isPluginDir(dir)) continue;
    if (removeDir(dir)) removed.push(dir);
  }
  return removed;
}

export function uninstallWechat() {
  const stateHome = homeDir();
  const stoppedPids = stopMonitorProcesses();
  const removedPluginDirs = removePluginDirs();
  const removedStateDirs = removeStateDir(stateHome);

  return {
    uninstalled: true,
    stopped_monitor_pids: stoppedPids,
    removed_plugin_dirs: removedPluginDirs,
    removed_state_dirs: removedStateDirs,
    platform_cleanup: {
      connector: "grok-wechat",
      routines: ["微信入站唤醒", "微信监听保活"],
      actions: [
        "从 Grok Bot Settings 卸载 grok-wechat 连接器",
        "在每个仍有 Routine「微信入站唤醒」或「微信监听保活」的助手上删除这两条 Routine（当前助手自行删除；通知其他仍保留这些 Routine 的助手一并删除）",
        "为扫码绑定创建的专属助手：删除其微信 Routine，并解除该号的 wake 绑定（wechat_set_wake 所配 webhook 随状态目录删除而失效；可删除或保留该助手本身，按用户意愿）",
      ],
    },
    verify: {
      no_monitor_process: "pgrep -af 'index.js --monitor' 应无 grok-wechat 相关进程",
      no_plugin_dir: "插件目录应不存在",
      no_state_dir: `${stateHome} 及 ~/.grok-wechat 应不存在`,
      no_connector: "Settings 中无 grok-wechat 连接器",
      no_routines: "各助手无「微信入站唤醒」「微信监听保活」Routine",
    },
  };
}

if (process.argv.includes("--uninstall")) {
  process.stdout.write(`${JSON.stringify(uninstallWechat(), null, 2)}\n`);
}
