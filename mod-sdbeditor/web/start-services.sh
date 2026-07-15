#!/bin/bash

# Auto-restart script for SDBEditor backend services
# This script will restart services automatically if they exit

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting SDBEditor backend services with auto-restart..."

# Function to run a service with auto-restart
run_with_restart() {
    local service_name=$1
    local script_file=$2
    local log_file=$3
    
    echo "Starting $service_name..."
    while true; do
        echo "[$(date)] Starting $service_name" >> "$log_file"
        node "$script_file" >> "$log_file" 2>&1
        EXIT_CODE=$?
        echo "[$(date)] $service_name exited with code $EXIT_CODE" >> "$log_file"
        
        # If exit code is 0, it's an intentional restart
        if [ $EXIT_CODE -eq 0 ]; then
            echo "[$(date)] $service_name restarting..." >> "$log_file"
            sleep 1
        else
            echo "[$(date)] $service_name crashed! Restarting in 5 seconds..." >> "$log_file"
            sleep 5
        fi
    done
}

# Start file service in background
run_with_restart "File Service" "server.js" "/tmp/sdbeditor-file.log" &
FILE_SERVICE_PID=$!

# Start starter service in background
run_with_restart "Starter Service" "starter-server.js" "/tmp/sdbeditor-starter.log" &
STARTER_SERVICE_PID=$!

echo "Services started:"
echo "  File Service (server.js) - PID: $FILE_SERVICE_PID"
echo "  Starter Service (starter-server.js) - PID: $STARTER_SERVICE_PID"
echo ""
echo "Logs:"
echo "  File Service: tail -f /tmp/sdbeditor-file.log"
echo "  Starter Service: tail -f /tmp/sdbeditor-starter.log"
echo ""
echo "To stop all services: pkill -P $$ or kill $$"
echo ""
echo "Services will auto-restart if they exit or crash."

# Wait for both background processes
wait
