#!/bin/bash
# Restart the full SDB Editor stack:
#   1. Backend API       (port 3001) - server.js
#   2. Starter/Auth      (port 5000) - starter-server.js
#   3. Vite Frontend     (port 5173) - npx vite
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Stopping existing servers..."
pkill -9 -f "node server.js" 2>/dev/null
pkill -9 -f "node starter-server" 2>/dev/null
pkill -9 -f "vite" 2>/dev/null
sleep 1

cd "$DIR"

# 1. Backend API
nohup node server.js > /tmp/sdbeditor-api.log 2>&1 &
echo "Backend API (PID $!) starting on port 3001..."

# 2. Starter/Auth service
nohup node starter-server.js > /tmp/sdbeditor-starter.log 2>&1 &
echo "Starter Auth (PID $!) starting on port 5000..."

sleep 2

# 3. Vite frontend (needs backend up first for proxy)
nohup npx vite --host 0.0.0.0 > /tmp/sdbeditor-vite.log 2>&1 &
echo "Vite Frontend (PID $!) starting on port 5173..."

sleep 3

# Verify all ports
echo ""
echo "=== Status ==="
for port in 3001 5000 5173; do
    if ss -tlnp | grep -q ":${port} "; then
        echo "  Port $port: UP"
    else
        echo "  Port $port: DOWN"
    fi
done
