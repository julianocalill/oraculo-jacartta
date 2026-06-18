#!/bin/zsh

set -euo pipefail

REPO_ROOT="/Users/julianocalil/oraculo"
NODE_BIN="/opt/homebrew/bin/node"
SCRIPT_PATH="$REPO_ROOT/scripts/sync-olist-current-month.js"
LOG_DIR="$REPO_ROOT/logs"

mkdir -p "$LOG_DIR"
cd "$REPO_ROOT"

SCRIPT_PATH="$REPO_ROOT/scripts/sync-olist-rolling-window.js"

exec "$NODE_BIN" "$SCRIPT_PATH"
