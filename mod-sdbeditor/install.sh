#!/usr/bin/env bash
set -euo pipefail

# Install Node.js (LTS) and npm on Debian/Ubuntu
if ! command -v node >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  NODE_MAJOR=20
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

# Install web app dependencies
cd /root/azerothcore-wotlk/modules/mod-sdbeditor/web
npm install

LOG_DIR=/tmp

start_if_missing() {
  local pattern="$1"
  local cmd="$2"
  local log="$3"

  if pgrep -f "$pattern" >/dev/null 2>&1; then
    echo "Already running: $pattern"
    return
  fi

  nohup bash -c "$cmd" >"$log" 2>&1 &
  echo "Started: $pattern (log: $log)"
}

start_if_missing "starter-server.js" "node starter-server.js" "$LOG_DIR/sdbeditor-starter.log"
start_if_missing "server.js" "node server.js" "$LOG_DIR/sdbeditor-files.log"
start_if_missing "vite" "npm run dev -- --host 0.0.0.0 --port 5173" "$LOG_DIR/sdbeditor-ui.log"

echo "Done. Open setup at:"
echo "  http://<server-ip>:5000"
