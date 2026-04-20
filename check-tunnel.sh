#!/bin/bash

read DURATION
if [ "$DURATION" -le 5000 ]; then
    exit 60
else
    # Determine tunnel mode from state
    MODE=$(jq -r '.tunnel_mode // empty' /root/data/state.json 2>/dev/null || echo "")

    if [ "$MODE" = "vps" ]; then
        STATUS=$(jq -r '.vps_tunnel_status // "disconnected"' /root/data/state.json 2>/dev/null || echo "disconnected")
        ENDPOINT=$(jq -r '.public_endpoint // empty' /root/data/state.json 2>/dev/null || echo "")
        if [ "$STATUS" = "connected" ] && [ -n "$ENDPOINT" ]; then
            exit 0
        elif [ "$STATUS" = "connected" ] || [ "$STATUS" = "connecting" ]; then
            echo "VPS SSH tunnel is $STATUS but no endpoint yet" >&2
            exit 61
        else
            LAST_ERR=$(jq -r '.vps_last_error // empty' /root/data/state.json 2>/dev/null || echo "")
            echo "VPS SSH tunnel is not connected (status: ${STATUS}${LAST_ERR:+ — ${LAST_ERR}})" >&2
            exit 1
        fi
    else
        # Playit.gg mode (or mode not set yet)
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
        elif [ "$MODE" = "" ] || [ "$MODE" = "null" ]; then
            echo "Tunnel mode not configured yet" >&2
            exit 61
        else
            echo "Playit tunnel is not connected (agent status: ${AGENT_STATUS})" >&2
            exit 1
        fi
    fi
fi
