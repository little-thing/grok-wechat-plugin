#!/bin/sh
set -e
HOME_DIR="${GROK_WECHAT_HOME:-/home/box/.grok-wechat}"
PID_FILE="$HOME_DIR/monitor.pid"
if [ -f "$PID_FILE" ]; then pid=$(cat "$PID_FILE"); [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; fi
pkill -f "grok-wechat-plugin/server/index.js --monitor" 2>/dev/null || true
rm -rf /home/box/grok-wechat-plugin /workspace/grok-wechat-plugin "$HOME_DIR"
echo "removed plugin files and state; unload MCP and delete webhook routine separately"
