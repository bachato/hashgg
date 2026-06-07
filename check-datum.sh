#!/bin/bash

read DURATION
# Guard against empty/non-numeric input from the health harness (would otherwise
# make the integer test error out unpredictably).
case "$DURATION" in (''|*[!0-9]*) DURATION=0 ;; esac
if [ "$DURATION" -le 5000 ]; then
    exit 60
else
    DATUM_STRATUM_PORT=$(yq e '.advanced.datum_stratum_port // 23335' /root/start9/config.yaml 2>/dev/null || echo "${DATUM_STRATUM_PORT:-23335}")
    DATUM_HOST="${DATUM_HOST:-datum.embassy}"

    if nc -z -w2 "$DATUM_HOST" "$DATUM_STRATUM_PORT" >/dev/null 2>&1; then
        exit 0
    else
        echo "Datum Gateway stratum port ($DATUM_STRATUM_PORT) is not reachable" >&2
        exit 1
    fi
fi
