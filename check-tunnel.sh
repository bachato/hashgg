#!/bin/bash

read DURATION
if [ "$DURATION" -le 5000 ]; then
    exit 60
else
    DATUM_STRATUM_PORT=$(yq e '.advanced.datum_stratum_port // 23335' /root/start9/config.yaml 2>/dev/null || echo 23335)

    # Check if the backend reports the tunnel as connected
    STATUS=$(curl -s --max-time 3 http://127.0.0.1:3000/api/status 2>/dev/null)
    if [ $? -ne 0 ]; then
        echo "HashGG backend is not responding" >&2
        exit 1
    fi

    AGENT_STATUS=$(echo "$STATUS" | jq -r '.agent_status' 2>/dev/null)
    PUBLIC_ENDPOINT=$(echo "$STATUS" | jq -r '.public_endpoint' 2>/dev/null)

    if [ "$AGENT_STATUS" = "running" ] && [ "$PUBLIC_ENDPOINT" != "null" ] && [ -n "$PUBLIC_ENDPOINT" ]; then
        exit 0
    elif [ "$AGENT_STATUS" = "running" ]; then
        echo "Playit agent is running but no tunnel endpoint assigned yet" >&2
        exit 61
    else
        echo "Playit tunnel is not connected (agent status: ${AGENT_STATUS})" >&2
        exit 1
    fi
fi
