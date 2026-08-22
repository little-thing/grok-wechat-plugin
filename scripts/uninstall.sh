#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/server/uninstall.js" ]; then
  node "$ROOT/server/uninstall.js" --uninstall "$@"
elif [ -f "$ROOT/server/index.js" ]; then
  node "$ROOT/server/index.js" --uninstall "$@"
else
  HOME_DIR="${GROK_WECHAT_HOME:-/home/box/.grok-wechat}"
  [ -d "$HOME_DIR" ] || HOME_DIR="${HOME:-/home/box}/.grok-wechat"
  PID_FILE="$HOME_DIR/monitor.pid"
  if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  fi
  pkill -TERM -f "grok-wechat-plugin/server/index.js --monitor" 2>/dev/null || true
  rm -rf /home/box/grok-wechat-plugin /workspace/grok-wechat-plugin "$HOME_DIR" /home/box/.grok-wechat
  echo '{"uninstalled":true,"note":"fallback shell cleanup"}'
fi
