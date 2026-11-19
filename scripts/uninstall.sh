#!/bin/sh
set -e
ROOT="$(CDPATH= cd -P "$(dirname -- "$0")/.." && pwd -P)"
if [ ! -f "$ROOT/server/uninstall.js" ] || ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Uninstall requires Node.js and server/uninstall.js to verify cleanup paths.' >&2
  exit 1
fi
exec node "$ROOT/server/uninstall.js" --uninstall "$@"
