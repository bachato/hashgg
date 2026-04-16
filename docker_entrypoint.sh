#!/bin/sh
set -e

mkdir -p /root/data

# Read config values
DATUM_STRATUM_PORT=$(yq e '.advanced.datum_stratum_port // 23335' /root/start9/config.yaml)

echo "[hashgg] Datum stratum port: ${DATUM_STRATUM_PORT}"

# Start socat TCP proxy: forward local stratum port to Datum Gateway
# Use -d -d for verbose logging so we can see connection issues
echo "[hashgg] Starting socat proxy: 127.0.0.1:${DATUM_STRATUM_PORT} -> datum.embassy:${DATUM_STRATUM_PORT}"
socat -d -d TCP-LISTEN:${DATUM_STRATUM_PORT},fork,reuseaddr TCP:datum.embassy:${DATUM_STRATUM_PORT} 2>&1 | while IFS= read -r line; do echo "[socat] $line"; done &
SOCAT_PID=$!

# Start the Node.js backend (manages playit agent lifecycle + serves UI)
echo "[hashgg] Starting backend server..."
exec node /usr/local/lib/hashgg/backend/server.js
