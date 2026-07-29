#!/usr/bin/env bash
#
# start-hashgg.sh — one command to get HashGG running on a personal machine.
#
# Aimed at the "I run Bitcoin Knots as bitcoin-qt on my desktop" user. It walks
# through the whole chain, explaining each step and asking before it changes
# anything:
#
#   1. Check the tools it needs (Docker, curl, jq).
#   2. Find Bitcoin Knots, confirm it's running, and check bitcoin.conf for the
#      settings Datum Gateway needs. It NEVER edits bitcoin.conf — it prints the
#      lines for you to paste, because that file belongs to your node.
#   3. Make sure Datum Gateway is installed, configured, and running.
#   4. Start HashGG in Docker and hand you the dashboard URL.
#
# Safe to re-run: every step detects what's already done and skips it.
#
#   ./start-hashgg.sh          # or `up`
#   ./start-hashgg.sh status
#   ./start-hashgg.sh logs
#   ./start-hashgg.sh down
#
# ---------------------------------------------------------------------------
# Platform notes
# ---------------------------------------------------------------------------
#
# Linux  — Datum Gateway is built and run natively on the host, delegating to
#          host-setup/install-datum-gateway.sh. Bitcoin's RPC stays on loopback.
#
# macOS  — Datum Gateway CANNOT be built natively: it uses epoll(7) and argp,
#          neither of which exists on macOS (upstream ships no macOS build path;
#          even FreeBSD needs libepoll-shim). So on macOS we run Datum in Docker
#          instead. That works, but it moves Datum off the host, which means
#          Bitcoin's RPC has to accept connections from the Docker VM rather
#          than loopback only. The script detects this and prints the exact
#          bitcoin.conf lines. It is the one genuinely awkward part of the macOS
#          path, and it is a real (if small) widening of your node's RPC
#          exposure — the script says so at the time rather than burying it.
#
# Written for bash 3.2 so it runs on stock macOS: no associative arrays, no
# `mapfile`, no `${var^^}`.

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATUM_HELPER="$REPO_DIR/host-setup/install-datum-gateway.sh"

# Runtime state lives outside the repo so a `git status` stays clean.
STATE_DIR="${HASHGG_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/hashgg}"
COMPOSE_FILE="$STATE_DIR/compose.yml"
DATUM_PID_FILE="$STATE_DIR/datum.pid"
DATUM_LOG_FILE="$STATE_DIR/datum.log"
DATUM_CONTAINER_CONF="$STATE_DIR/datum_gateway.container.json"

# Published image by default. Override for local development:
#   HASHGG_IMAGE=paulscode/hashgg:latest ./start-hashgg.sh
# (Note `make docker-build-local` tags from manifest.yaml, which may differ from
# the tag pinned here — that mismatch is why this is an explicit knob.)
HASHGG_IMAGE="${HASHGG_IMAGE:-paulscode/hashgg:0.7.2.0}"
HASHGG_UI_PORT="${HASHGG_UI_PORT:-3000}"

# Built locally on macOS from the pinned upstream Datum release.
DATUM_REPO="${DATUM_REPO:-https://github.com/ocean-xyz/datum_gateway.git}"
DATUM_REF="${DATUM_REF:-v0.4.1beta}"
DATUM_IMAGE="${DATUM_IMAGE:-hashgg-local/datum_gateway:$DATUM_REF}"

DATUM_STRATUM_PORT_DEFAULT=23335
DATUM_API_PORT_DEFAULT=7152

DATUM_ADMIN_PASSWORD_NEW=""   # set only when we generate one this run

USER_DATUM_BIN="$HOME/.local/bin/datum_gateway"
USER_DATUM_CONF="$HOME/.config/datum_gateway/datum_gateway.json"

# ---------------------------------------------------------------------------
# Output helpers (same vocabulary as install-datum-gateway.sh)
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'
  C_BLU=$'\033[34m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_BLU=""; C_DIM=""; C_OFF=""
fi

say()  { printf '%s\n' "$*"; }
info() { printf '%s[info]%s %s\n' "$C_BLU" "$C_OFF" "$*"; }
ok()   { printf '%s[ ok ]%s %s\n' "$C_GRN" "$C_OFF" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
err()  { printf '%s[err ]%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; }
step() { printf '\n%s==> %s%s\n' "$C_BLU" "$*" "$C_OFF"; }
die()  { err "$*"; exit 1; }

confirm() {
  local prompt="$1" def="${2:-default-no}" reply hint="[y/N]"
  [ "$def" = "default-yes" ] && hint="[Y/n]"
  read -r -p "$(printf '%s %s ' "$prompt" "$hint")" reply || true
  if [ -z "$reply" ]; then
    [ "$def" = "default-yes" ] && return 0 || return 1
  fi
  case "$reply" in [Yy]|[Yy][Ee][Ss]) return 0 ;; *) return 1 ;; esac
}

on_error() {
  local code=$? line=${1:-?}
  err "Stopped on line $line (exit $code)."
  err "Nothing is left half-started — re-run './start-hashgg.sh' after fixing the problem."
  exit "$code"
}
trap 'on_error $LINENO' ERR

# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------

have() { command -v "$1" >/dev/null 2>&1; }

# TCP connect test. `nc -z` where available (present on both Linux and macOS),
# falling back to bash's /dev/tcp.
port_open() {
  local host="$1" port="$2"
  if have nc; then
    nc -z -w 2 "$host" "$port" >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/$host/$port") >/dev/null 2>&1
  fi
}

# Poll an HTTP endpoint until it actually answers.
#
# Use this, not wait_for_port, for anything published by Docker: `docker-proxy`
# binds the host port the moment the container is created, so a TCP connect
# succeeds long before the process inside is serving. Waiting on the port alone
# reports "up" too early and the first request then fails.
wait_for_http() {
  local url="$1" limit="$2" label="$3" i=0
  while [ "$i" -lt "$limit" ]; do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  warn "$label did not respond at $url within ${limit}s."
  return 1
}

# Poll a port until it answers. wait_for_port <host> <port> <seconds> <label>
# Fine for a native process; see wait_for_http for containers.
wait_for_port() {
  local host="$1" port="$2" limit="$3" label="$4" i=0
  while [ "$i" -lt "$limit" ]; do
    if port_open "$host" "$port"; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  warn "$label did not start listening on $host:$port within ${limit}s."
  return 1
}

json_get() {
  # json_get <file> <jq-path> — empty string when jq is absent or key missing.
  # NOT for booleans: jq's `//` treats `false` the same as null, so a genuine
  # `false` comes back as "". Use json_raw for those.
  local file="$1" path="$2"
  have jq || return 0
  [ -r "$file" ] || return 0
  jq -r "$path // \"\"" "$file" 2>/dev/null || true
}

json_raw() {
  # json_raw <file> <jq-path> — the literal value: "true", "false", "null", ...
  local file="$1" path="$2"
  have jq || { printf 'null'; return 0; }
  [ -r "$file" ] || { printf 'null'; return 0; }
  jq -r "$path" "$file" 2>/dev/null || printf 'null'
}

# Fixed project name so the stack is identified the same way regardless of
# where the generated compose file lives (HASHGG_STATE_DIR is overridable).
compose() {
  docker compose -p hashgg -f "$COMPOSE_FILE" "$@"
}

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

OS=""            # linux | macos
DATUM_MODE=""    # native | docker

detect_platform() {
  case "$(uname -s)" in
    Linux)  OS="linux"; DATUM_MODE="native" ;;
    Darwin) OS="macos"; DATUM_MODE="docker" ;;
    *) die "Unsupported OS: $(uname -s). This script handles Linux and macOS; Windows needs a different approach." ;;
  esac
}

# ---------------------------------------------------------------------------
# Step 1 — tools
# ---------------------------------------------------------------------------

check_tools() {
  step "Checking the tools this needs"

  local missing=""

  if have docker; then
    if docker info >/dev/null 2>&1; then
      ok "Docker is installed and running"
    else
      err "Docker is installed but the daemon isn't reachable."
      if [ "$OS" = "macos" ]; then
        err "Start Docker Desktop (or OrbStack/colima) and run this again."
      else
        err "Try: sudo systemctl start docker   — and make sure you're in the 'docker' group."
      fi
      exit 1
    fi
  else
    missing="$missing docker"
  fi

  if have docker && ! docker compose version >/dev/null 2>&1; then
    err "The Docker Compose v2 plugin is missing ('docker compose' doesn't work)."
    [ "$OS" = "linux" ] && err "Try: sudo apt install docker-compose-v2"
    exit 1
  fi

  have curl || missing="$missing curl"
  have jq   || missing="$missing jq"
  # macOS builds the Datum image from a source clone, so git is required there.
  if [ "$OS" = "macos" ]; then
    have git || missing="$missing git"
  fi

  if [ -n "$missing" ]; then
    err "Missing:$missing"
    if [ "$OS" = "macos" ]; then
      err "Install Docker Desktop from docker.com, then: brew install${missing// docker/}"
    else
      err "Try: sudo apt install${missing}"
    fi
    exit 1
  fi

  ok "curl and jq present"
  mkdir -p "$STATE_DIR"
}

# ---------------------------------------------------------------------------
# Step 2 — Bitcoin Knots
# ---------------------------------------------------------------------------

BITCOIN_CONF=""
BITCOIN_DATADIR=""
# Set by verify_hashgg_to_bitcoin so the closing summary can repeat a warning
# that would otherwise have scrolled off the screen.
BITCOIN_REACHABLE="unknown"
BITCOIN_RPC_PORT="8332"

bitcoin_pid() {
  # `pgrep -x` misses bitcoin-qt on some systems; match on the full command line.
  # Match case-insensitively: the macOS app ships the binary as `Bitcoin-Qt`.
  #
  # The `|| true` matters: with `set -o pipefail`, a grep that matches nothing
  # makes the whole pipeline return 1, which under `set -e` would abort the
  # script the moment it's used in an assignment — i.e. exactly when Bitcoin
  # isn't running, which is a case we want to handle gracefully.
  ps -axo pid=,args= 2>/dev/null \
    | grep -iE 'bitcoin-qt|bitcoind' | grep -v grep \
    | awk '{print $1}' | head -1 || true
}

bitcoin_running() {
  [ -n "$(bitcoin_pid)" ]
}

# Find the data directory of the *running* node. Layered, most authoritative
# first — the naive "guess the default path" approach is wrong surprisingly
# often, because bitcoin-qt lets you pick a data directory on first run and then
# stores it in Qt's settings rather than on the command line.
find_bitcoin_datadir() {
  local pid; pid="$(bitcoin_pid)"

  # 1. An explicit -datadir= on the command line.
  if [ -n "$pid" ]; then
    local args from_args
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    from_args="$(printf '%s' "$args" | sed -n 's/.*-datadir=\([^ ]*\).*/\1/p' || true)"
    if [ -n "$from_args" ] && [ -d "$from_args" ]; then
      printf '%s' "$from_args"; return 0
    fi
  fi

  # 2. The lock file the node holds open — true regardless of how it was told.
  if [ -n "$pid" ]; then
    local lock=""
    if [ -d "/proc/$pid/fd" ]; then
      lock="$(ls -l "/proc/$pid/fd" 2>/dev/null \
              | sed -n 's|.*-> \(/.*\)/\.lock$|\1|p' | head -1 || true)"
    elif have lsof; then
      lock="$(lsof -p "$pid" -Fn 2>/dev/null \
              | sed -n 's|^n\(/.*\)/\.lock$|\1|p' | head -1 || true)"
    fi
    if [ -n "$lock" ] && [ -d "$lock" ]; then
      printf '%s' "$lock"; return 0
    fi
  fi

  # 3. bitcoin-qt's remembered choice from its "choose data directory" prompt.
  local qt_dir=""
  if [ "$OS" = "macos" ]; then
    local dom
    for dom in org.bitcoin.Bitcoin-Qt org.bitcoinknots.Bitcoin-Qt; do
      qt_dir="$(defaults read "$dom" strDataDir 2>/dev/null || true)"
      [ -n "$qt_dir" ] && break
    done
  elif [ -r "$HOME/.config/Bitcoin/Bitcoin-Qt.conf" ]; then
    qt_dir="$(sed -n 's/^strDataDir=//p' "$HOME/.config/Bitcoin/Bitcoin-Qt.conf" | head -1)"
  fi
  if [ -n "$qt_dir" ] && [ -d "$qt_dir" ]; then
    printf '%s' "$qt_dir"; return 0
  fi

  # 4. Platform defaults.
  local c
  for c in "$HOME/.bitcoin" "$HOME/Library/Application Support/Bitcoin" "/etc/bitcoin"; do
    [ -d "$c" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

check_bitcoin() {
  step "Checking Bitcoin Knots"

  if bitcoin_running; then
    ok "Bitcoin Knots is running"
  else
    warn "No bitcoin-qt or bitcoind process found."
    say ""
    say "Datum Gateway needs your node running to build block templates."
    say "Start Bitcoin Knots, let it finish loading, then run this again."
    say ""
    confirm "Continue anyway?" default-no || exit 0
  fi

  BITCOIN_DATADIR="$(find_bitcoin_datadir || true)"
  if [ -n "$BITCOIN_DATADIR" ]; then
    ok "Data directory: $BITCOIN_DATADIR"
  else
    warn "Couldn't work out your Bitcoin data directory."
    read -r -p "Full path to the Bitcoin data directory: " BITCOIN_DATADIR || true
    [ -d "$BITCOIN_DATADIR" ] || die "Not a directory: $BITCOIN_DATADIR"
  fi

  # A -conf= override can point outside the data directory.
  local pid conf_arg=""
  pid="$(bitcoin_pid)"
  if [ -n "$pid" ]; then
    conf_arg="$(ps -p "$pid" -o args= 2>/dev/null | sed -n 's/.*-conf=\([^ ]*\).*/\1/p' || true)"
  fi
  case "$conf_arg" in
    /*) BITCOIN_CONF="$conf_arg" ;;
    "") BITCOIN_CONF="$BITCOIN_DATADIR/bitcoin.conf" ;;
    *)  BITCOIN_CONF="$BITCOIN_DATADIR/$conf_arg" ;;
  esac

  if [ -r "$BITCOIN_CONF" ]; then
    ok "Config: $BITCOIN_CONF"
  else
    warn "No bitcoin.conf at $BITCOIN_CONF."
    say ""
    say "Knots runs fine without one, but Datum Gateway needs a few settings."
    say "Create that file (an empty one is fine) and re-run — the next check"
    say "will tell you exactly what to put in it."
    say ""
    confirm "Continue anyway?" default-no || exit 0
  fi

  # The helper does its own, shallower, lookup — hand it what we found so it
  # doesn't stop to ask.
  export BITCOIN_CONF

  local p
  p="$(awk -F= '$1=="rpcport"{gsub(/[ \t]/,"",$2); print $2}' "$BITCOIN_CONF" 2>/dev/null | tail -1 || true)"
  [ -n "$p" ] && BITCOIN_RPC_PORT="$p"

  # Delegate the actual config audit — one implementation, already maintained.
  say ""
  info "Running the Bitcoin config check (it only reads; it never edits)..."
  say ""
  bash "$DATUM_HELPER" check-knots || true

  say ""
  say "If the check printed a block of lines above, add them to:"
  say "  $BITCOIN_CONF"
  say "then restart Bitcoin Knots before continuing."
  say ""
  confirm "Ready to carry on?" default-yes || exit 0
}

# ---------------------------------------------------------------------------
# Step 3 — Datum Gateway
# ---------------------------------------------------------------------------

ensure_datum_installed_native() {
  if [ -x "$USER_DATUM_BIN" ]; then
    ok "Datum Gateway is installed ($USER_DATUM_BIN)"
    return 0
  fi
  warn "Datum Gateway isn't installed yet."
  say ""
  say "This will install build tools with apt (needs sudo), then compile Datum"
  say "Gateway $DATUM_REF into $USER_DATUM_BIN. Nothing is installed system-wide."
  say ""
  confirm "Build Datum Gateway now?" default-yes || die "Can't continue without Datum Gateway."
  bash "$DATUM_HELPER" build
  [ -x "$USER_DATUM_BIN" ] || die "Build finished but $USER_DATUM_BIN is missing."
  ok "Datum Gateway built"
}

ensure_datum_installed_docker() {
  if docker image inspect "$DATUM_IMAGE" >/dev/null 2>&1; then
    ok "Datum Gateway image present ($DATUM_IMAGE)"
    return 0
  fi
  warn "Datum Gateway image isn't built yet."
  say ""
  say "macOS can't build Datum natively (it needs Linux's epoll), so we build it"
  say "as a Docker image instead — from upstream $DATUM_REF. Takes a few minutes."
  say ""
  confirm "Build the Datum Gateway image now?" default-yes || die "Can't continue without Datum Gateway."

  local src="$STATE_DIR/datum_src"
  if [ -d "$src/.git" ]; then
    ( cd "$src" && git fetch --depth 1 origin "$DATUM_REF" && git checkout -q FETCH_HEAD )
  else
    rm -rf "$src"
    git clone --depth 1 --branch "$DATUM_REF" "$DATUM_REPO" "$src"
  fi
  docker build -t "$DATUM_IMAGE" "$src"
  ok "Datum Gateway image built"
}

ensure_datum_configured() {
  if [ -r "$USER_DATUM_CONF" ]; then
    ok "Datum config present ($USER_DATUM_CONF)"
    return 0
  fi
  warn "Datum Gateway isn't configured yet."
  say ""
  say "The next step asks for your payout address and coinbase tags, and writes"
  say "$USER_DATUM_CONF."
  say ""
  confirm "Configure Datum Gateway now?" default-yes || die "Can't continue without a Datum config."
  bash "$DATUM_HELPER" configure
  [ -r "$USER_DATUM_CONF" ] || die "Configuration didn't produce $USER_DATUM_CONF."
}

datum_stratum_port() {
  local p
  p="$(json_get "$USER_DATUM_CONF" '.stratum.listen_port')"
  [ -n "$p" ] && printf '%s' "$p" || printf '%s' "$DATUM_STRATUM_PORT_DEFAULT"
}

datum_api_port() {
  local p
  p="$(json_get "$USER_DATUM_CONF" '.api.listen_port')"
  [ -n "$p" ] && printf '%s' "$p" || printf '%s' "$DATUM_API_PORT_DEFAULT"
}

# Datum's api_listen_port defaults to 0, and 0 means "API disabled" — it logs
# "No API port configured. API disabled." and never opens the port
# (src/datum_api.c). Configs written before this was noticed have no
# api.listen_port at all, so the dashboard URL this script prints at the end
# went nowhere. Fill it in. An explicit 0 is someone turning the API off on
# purpose and is left alone; DATUM_API_ENABLED then keeps us from publishing
# and advertising a port nothing is behind.
DATUM_API_ENABLED=1

ensure_datum_api_port() {
  local p; p="$(json_raw "$USER_DATUM_CONF" '.api.listen_port')"

  if [ "$p" = "0" ]; then
    DATUM_API_ENABLED=0
    warn "Datum's dashboard is off (api.listen_port is 0 in $USER_DATUM_CONF)."
    info "Set it to $DATUM_API_PORT_DEFAULT and re-run if you want the dashboard back."
    return 0
  fi

  case "$p" in
    ''|null) ;;
    *) return 0 ;;
  esac

  local tmp="$USER_DATUM_CONF.tmp.$$"
  jq --argjson p "$DATUM_API_PORT_DEFAULT" \
     '(.api //= {}) | .api.listen_port = $p' "$USER_DATUM_CONF" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$USER_DATUM_CONF"
  DATUM_CONF_CHANGED=1
  ok "Datum config: added api.listen_port=$DATUM_API_PORT_DEFAULT (its dashboard was disabled)"
}

# Datum's own dashboard is where the payout address, coinbase tags and
# pool/solo choice actually live. Its settings form is read-only unless BOTH an
# admin_password is set AND modify_conf is true — miss either and Save is
# refused with "Config file disallows editing" (src/datum_api.c). Since this
# config file is one we generate, offering to fix it is fair game; bitcoin.conf
# is the file we never touch.
DATUM_CONF_CHANGED=0

ensure_datum_admin() {
  local pass mod
  pass="$(json_get "$USER_DATUM_CONF" '.api.admin_password')"
  mod="$(json_raw "$USER_DATUM_CONF" '.api.modify_conf')"

  if [ -n "$pass" ] && [ "$mod" = "true" ]; then
    ok "Datum dashboard: settings are editable (sign in as 'admin')"
    return 0
  fi

  # Note for whoever reads this next: enabling these two is necessary but not
  # sufficient. Datum's settings page itself never sends a 401, so a browser
  # that lands straight on it has no credentials and the save POST is rejected.
  # /clients is the page that issues the digest challenge. The finishing message
  # spells this out — it is not obvious and the error text doesn't hint at it.

  say ""
  warn "Datum's dashboard won't let you save settings yet."
  say ""
  say "Its settings page — payout address, coinbase tags, pool vs solo — needs"
  say "two things in Datum's config before the Save button works:"
  [ -n "$pass" ] && say "  - an admin password ....... already set" \
                 || say "  - an admin password ....... MISSING"
  [ "$mod" = "true" ] && say "  - config editing enabled .. already on" \
                      || say "  - config editing enabled .. OFF"
  say ""
  say "Datum's dashboard listens on 127.0.0.1 only, so this is reachable from"
  say "this machine and nowhere else. Enabling it means anyone who can use this"
  say "computer and knows the password can change Datum's settings."
  say ""
  if ! confirm "Enable editing Datum's settings from its dashboard?" default-yes; then
    info "Left as-is. You can still view the dashboard; the settings form stays read-only."
    info "To change settings, edit $USER_DATUM_CONF by hand and restart."
    return 0
  fi

  local newpass="$pass"
  if [ -z "$newpass" ]; then
    newpass="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 20 || true)"
    [ -n "$newpass" ] || newpass="hashgg-$$-$(date +%s)"
    DATUM_ADMIN_PASSWORD_NEW="$newpass"
  fi

  local tmp="$USER_DATUM_CONF.tmp.$$"
  jq --arg p "$newpass" '.api.admin_password = $p | .api.modify_conf = true' \
     "$USER_DATUM_CONF" >"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$USER_DATUM_CONF"
  DATUM_CONF_CHANGED=1
  ok "Datum config updated — settings are now editable from its dashboard"
}

datum_native_running() {
  [ -r "$DATUM_PID_FILE" ] || return 1
  local pid; pid="$(cat "$DATUM_PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  # Guard against PID reuse. A stale pid file whose number has been recycled by
  # an unrelated process would otherwise make us report it as running — and,
  # worse, make `down` kill something that isn't ours.
  ps -p "$pid" -o args= 2>/dev/null | grep -q datum_gateway
}

stop_datum_native() {
  datum_native_running || return 0
  local pid; pid="$(cat "$DATUM_PID_FILE")"
  info "Stopping Datum Gateway (pid $pid)..."
  kill "$pid" 2>/dev/null || true
  local i=0
  while [ "$i" -lt 10 ] && kill -0 "$pid" 2>/dev/null; do sleep 1; i=$((i + 1)); done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  rm -f "$DATUM_PID_FILE"
  ok "Datum Gateway stopped"
}

start_datum_native() {
  local sport; sport="$(datum_stratum_port)"

  if datum_native_running; then
    ok "Datum Gateway already running (pid $(cat "$DATUM_PID_FILE"))"
    return 0
  fi
  if port_open 127.0.0.1 "$sport"; then
    warn "Something is already listening on 127.0.0.1:$sport — assuming that's Datum."
    return 0
  fi

  info "Starting Datum Gateway in the background..."
  info "Logs: $DATUM_LOG_FILE"
  nohup "$USER_DATUM_BIN" -c "$USER_DATUM_CONF" >>"$DATUM_LOG_FILE" 2>&1 &
  echo $! >"$DATUM_PID_FILE"
  sleep 2

  if ! datum_native_running; then
    err "Datum Gateway exited immediately. Last lines of $DATUM_LOG_FILE:"
    tail -20 "$DATUM_LOG_FILE" >&2 || true
    die "Datum Gateway failed to start."
  fi
  wait_for_port 127.0.0.1 "$sport" 30 "Datum Gateway" || {
    err "Last lines of $DATUM_LOG_FILE:"; tail -20 "$DATUM_LOG_FILE" >&2 || true
    die "Datum Gateway started but never opened its stratum port."
  }
  ok "Datum Gateway listening on 127.0.0.1:$sport"
}

# macOS: derive a container-flavoured copy of the user's config. The original is
# never touched — inside a container '127.0.0.1' means the container itself, so
# the RPC URL and the API bind address both have to change.
write_container_datum_conf() {
  local sport aport
  sport="$(datum_stratum_port)"
  aport="$(datum_api_port)"

  local cookie; cookie="$(json_get "$USER_DATUM_CONF" '.bitcoind.rpccookiefile')"
  local new_cookie=""
  if [ -n "$cookie" ]; then
    new_cookie="/bitcoin/$(basename "$cookie")"
  fi

  jq \
    --arg url "http://host.docker.internal:$BITCOIN_RPC_PORT" \
    --arg cookie "$new_cookie" \
    --argjson aport "$aport" \
    '
    .bitcoind.rpcurl = $url
    | .stratum.listen_addr = "0.0.0.0"
    | .api.listen_addr = "0.0.0.0"
    | .api.listen_port = $aport
    | if $cookie != "" then .bitcoind.rpccookiefile = $cookie else . end
    ' "$USER_DATUM_CONF" >"$DATUM_CONTAINER_CONF"
  # 0600 because this file carries RPC credentials. The Datum image runs as an
  # unprivileged 'datumuser', but Docker Desktop's file sharing presents bind
  # mounts as owned by the accessing container user, so it can still read it.
  # If Datum ever logs a permissions error reading its config, that assumption
  # is where to look first.
  chmod 600 "$DATUM_CONTAINER_CONF"
  ok "Wrote container config: $DATUM_CONTAINER_CONF"
  info "(Your own $USER_DATUM_CONF is untouched.)"
}

# macOS: Datum lives in the Docker VM, so Bitcoin's RPC must accept it.
check_macos_rpc_reachability() {
  step "Checking Bitcoin RPC is reachable from Docker"

  # --entrypoint is required: the Datum image sets ENTRYPOINT to datum_gateway,
  # so without it these args would be appended to datum_gateway's own argv.
  if docker run --rm --entrypoint nc --add-host=host.docker.internal:host-gateway \
       "$DATUM_IMAGE" -z -w 3 host.docker.internal "$BITCOIN_RPC_PORT" >/dev/null 2>&1; then
    ok "Docker can reach Bitcoin's RPC port"
    return 0
  fi

  warn "Docker can't reach Bitcoin's RPC on port $BITCOIN_RPC_PORT."
  say ""
  say "On macOS, Datum Gateway has to run inside Docker, so it reaches your node"
  say "over Docker's virtual network rather than loopback. Bitcoin has to allow"
  say "that. Add these lines to:"
  say "  $BITCOIN_CONF"
  say ""
  say "  # --- allow Datum Gateway (in Docker) to reach RPC ---"
  say "  rpcbind=127.0.0.1"
  say "  rpcbind=0.0.0.0"
  say "  rpcallowip=192.168.65.0/24"
  say ""
  warn "Understand what this does: your node's RPC stops being loopback-only."
  warn "Anything that can reach your Mac on port $BITCOIN_RPC_PORT can now attempt"
  warn "to authenticate. Keep your Mac's firewall on, and prefer a node with"
  warn "disablewallet=1 for mining."
  say ""
  say "If 192.168.65.0/24 turns out to be wrong for your Docker version, check"
  say "Bitcoin's debug.log after a failed attempt — it logs the rejected IP."
  say ""
  say "Restart Bitcoin Knots after editing, then run this script again."
  confirm "Continue anyway (Datum will keep retrying)?" default-no || exit 0
}

# ---------------------------------------------------------------------------
# Step 4 — compose file + HashGG
# ---------------------------------------------------------------------------

write_compose() {
  local sport aport
  sport="$(datum_stratum_port)"
  aport="$(datum_api_port)"

  {
    say "# Generated by start-hashgg.sh — safe to delete and regenerate."
    say "# Platform: $OS (Datum mode: $DATUM_MODE)"
    say ""
    say "services:"

    if [ "$DATUM_MODE" = "docker" ]; then
      say "  datum:"
      say "    image: $DATUM_IMAGE"
      say "    container_name: hashgg-datum"
      say "    restart: unless-stopped"
      say "    ports:"
      say "      - \"$sport:$sport\""
      if [ "$DATUM_API_ENABLED" = "1" ]; then
        say "      # API on loopback so bitcoin.conf's blocknotify can reach it."
        say "      - \"127.0.0.1:$aport:$aport\""
      fi
      say "    volumes:"
      say "      - \"$DATUM_CONTAINER_CONF:/app/config/config.json:ro\""
      say "      - \"$BITCOIN_DATADIR:/bitcoin:ro\""
      say "    extra_hosts:"
      say "      - \"host.docker.internal:host-gateway\""
      # The upstream image's HEALTHCHECK hardcodes Datum's own default stratum
      # port (23334). Ours is configurable and defaults to 23335, so that check
      # can only ever fail — the container sits "unhealthy" while working fine.
      say "    healthcheck:"
      say "      test: [\"CMD-SHELL\", \"nc -z localhost $sport || exit 1\"]"
      say "      interval: 30s"
      say "      timeout: 5s"
      say "      start_period: 15s"
      say "      retries: 3"
      say ""
    fi

    say "  hashgg:"
    say "    image: $HASHGG_IMAGE"
    say "    container_name: hashgg"
    say "    restart: unless-stopped"
    say "    ports:"
    say "      # Loopback only — the HashGG UI has no authentication."
    say "      - \"127.0.0.1:$HASHGG_UI_PORT:3000\""
    say "    environment:"
    if [ "$DATUM_MODE" = "docker" ]; then
      say "      DATUM_HOST: datum"
    else
      say "      DATUM_HOST: host.docker.internal"
    fi
    say "      DATUM_STRATUM_PORT: \"$sport\""
    say "      # Used by the Bitcoin clearnet-inbound feature; harmless otherwise."
    say "      # BITCOIN_CONF is the file this script already located, passed on so"
    say "      # HashGG can name it exactly rather than saying \"your bitcoin.conf\"."
    say "      BITCOIN_CONF: \"${BITCOIN_CONF:-}\""
    say "      BITCOIN_P2P_HOST: host.docker.internal"
    say "      BITCOIN_P2P_PORT: \"8333\""
    say "      HASHGG_PLATFORM: docker"
    say "      # Read-only RPC for the advertisement check. Optional: without it"
    say "      # the feature still works, it just cannot confirm your node picked"
    say "      # up the externalip line. Set these to your node's RPC if you want it."
    say "      BITCOIN_RPC_HOST: \"${BITCOIN_RPC_HOST:-}\""
    say "      BITCOIN_RPC_PORT: \"${BITCOIN_RPC_PORT:-}\""
    say "      BITCOIN_RPC_USER: \"${BITCOIN_RPC_USER:-}\""
    say "      BITCOIN_RPC_PASS: \"${BITCOIN_RPC_PASS:-}\""
    say "    extra_hosts:"
    say "      - \"host.docker.internal:host-gateway\""
    say "    volumes:"
    say "      - hashgg-data:/root/data"
    if [ "$DATUM_MODE" = "docker" ]; then
      say "    depends_on:"
      say "      - datum"
    fi
    say ""
    say "volumes:"
    say "  hashgg-data:"
  } >"$COMPOSE_FILE"

  ok "Wrote $COMPOSE_FILE"
}

# A container called `hashgg` left over from the repo's own docker-compose.yml,
# or from a plain `docker run`, will collide with ours by name. Compose's error
# for that is opaque, so catch it here and offer the fix.
check_container_collision() {
  local proj
  proj="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' hashgg 2>/dev/null || true)"
  # No such container, or it's already ours — nothing to do.
  [ -n "$proj" ] || { docker inspect hashgg >/dev/null 2>&1 || return 0; }
  [ "$proj" = "hashgg" ] && return 0

  warn "A container named 'hashgg' already exists and wasn't created by this script."
  say ""
  say "It's probably from an earlier 'docker compose up' in the repo directory."
  say "Both can't hold the same name."
  say ""
  confirm "Remove the old container? (its data volume is kept)" default-yes || \
    die "Can't start while the name is taken."
  docker rm -f hashgg >/dev/null
  ok "Old container removed"
}

start_hashgg() {
  step "Starting HashGG"
  info "Image: $HASHGG_IMAGE"
  check_container_collision
  # Check the registry for this tag before starting. Without this, `up` reuses
  # whatever copy is already on the machine, so a reinstall or a restart quietly
  # keeps running an older build of the same version. Failure here is not fatal —
  # a machine that is offline should still start with the image it already has.
  info "Checking for an updated image..."
  if ! compose pull 2>/dev/null; then
    warn "Could not reach the registry — starting with the image already on this machine."
  fi
  compose up -d
  # /api/status is cheap and only answers once the backend is actually serving.
  if wait_for_http "http://127.0.0.1:$HASHGG_UI_PORT/api/status" 60 "HashGG"; then
    ok "HashGG is up"
  else
    err "Recent logs:"
    compose logs --tail 30 hashgg >&2 || true
    die "HashGG didn't come up."
  fi
}

# The dashboard being reachable does NOT mean the chain works — HashGG still has
# to reach Datum. Ask HashGG itself rather than declaring success and letting the
# user discover a broken dashboard.
# HashGG reaches Bitcoin Knots across the Docker bridge, and a default-deny host
# firewall drops those packets silently. HashGG then reports "no Bitcoin node
# found", which sends people looking for a node that is running perfectly well —
# so the setup finished looking successful while the feature that depends on it
# could never work. Say so here, where the user is already in a terminal and the
# fix is one command.
verify_hashgg_to_bitcoin() {
  step "Checking HashGG can reach Bitcoin Knots"

  local port; port="${BITCOIN_P2P_PORT:-8333}"
  local out detecting detected err

  out="$(curl -fsS --max-time 45 "http://127.0.0.1:$HASHGG_UI_PORT/api/btc/status" 2>/dev/null || true)"
  detecting="$(printf '%s' "$out" | jq -r '.detecting // false' 2>/dev/null || echo false)"
  if [ "$detecting" = "true" ]; then
    # The first sweep can still be running; give it one chance to finish rather
    # than reporting a problem that resolves itself a few seconds later.
    sleep 8
    out="$(curl -fsS --max-time 45 "http://127.0.0.1:$HASHGG_UI_PORT/api/btc/status" 2>/dev/null || true)"
  fi

  if [ -z "$out" ]; then
    warn "Could not ask HashGG about your Bitcoin node — skipping this check."
    return 0
  fi

  detected="$(printf '%s' "$out" | jq -r 'if .detected then "yes" else "no" end' 2>/dev/null || echo '?')"
  if [ "$detected" = "yes" ]; then
    BITCOIN_REACHABLE="yes"
    ok "HashGG → Bitcoin Knots: reachable"
    return 0
  fi
  BITCOIN_REACHABLE="no"

  err="$(printf '%s' "$out" | jq -r '.detect_error // ""' 2>/dev/null || true)"

  warn "HashGG cannot reach Bitcoin Knots on port $port."
  say ""
  say "Your mining setup is unaffected. This only stops the optional feature that"
  say "makes your Bitcoin node reachable from the internet — if you set that up,"
  say "it will not be able to find your node."
  say ""

  case "$err" in
    *"timed out"*)
      say "The packets are being dropped rather than refused, which on this setup is"
      say "almost always the host firewall: HashGG runs in Docker and reaches Knots"
      say "across the Docker bridge, and a default-deny firewall blocks that."
      say ""
      if have ufw && systemctl is-active --quiet ufw 2>/dev/null; then
        say "This machine has ufw active. Fix it with:"
        say "  bash host-setup/install-datum-gateway.sh open-firewall"
        say ""
        say "or by hand:"
        say "  sudo ufw allow from 172.16.0.0/12 to any port $port proto tcp"
      else
        say "Allow the Docker bridge range to reach the port:"
        say "  172.16.0.0/12 -> $port/tcp"
      fi
      ;;
    *)
      say "Check that Bitcoin Knots is running, and that it listens on an address the"
      say "Docker bridge can reach — binding only to 127.0.0.1 is not enough."
      if [ -n "$err" ]; then
        say ""
        say "HashGG reported: $err"
      fi
      ;;
  esac
  say ""
  say "Re-run  ./start-hashgg.sh up  afterwards to confirm it is fixed."
  say ""
}

verify_hashgg_to_datum() {
  step "Checking HashGG can reach Datum Gateway"

  # One retry: /api/diag opens sockets to Datum and can be slow on first call.
  local out
  out="$(curl -fsS --max-time 40 "http://127.0.0.1:$HASHGG_UI_PORT/api/diag" 2>/dev/null || true)"
  if [ -z "$out" ]; then
    sleep 3
    out="$(curl -fsS --max-time 40 "http://127.0.0.1:$HASHGG_UI_PORT/api/diag" 2>/dev/null || true)"
  fi
  if [ -z "$out" ]; then
    # /api/diag can hang rather than answer when Datum isn't responding, so an
    # empty result here usually means Datum, not HashGG.
    warn "HashGG's diagnostics didn't answer in time."
    warn "That usually means Datum Gateway isn't responding — check: ./start-hashgg.sh logs datum"
    return 0
  fi

  local dc; dc="$(printf '%s' "$out" | jq -r '.datum_connect // "?"' 2>/dev/null || echo '?')"
  if [ "$dc" = "ok" ]; then
    ok "HashGG → Datum Gateway: connected"
    return 0
  fi

  warn "HashGG cannot reach Datum Gateway (reported: $dc)"
  say ""
  if [ "$DATUM_MODE" = "native" ]; then
    say "HashGG runs in Docker and reaches Datum across the Docker bridge, so the"
    say "usual causes are a host firewall, or Datum listening on loopback only."
    say ""
    if have ufw; then
      say "This machine has ufw. If it's active, open the bridge to Datum with:"
      say "  bash host-setup/install-datum-gateway.sh open-firewall"
      say ""
    fi
    local addr; addr="$(json_get "$USER_DATUM_CONF" '.stratum.listen_addr')"
    if [ -n "$addr" ] && [ "$addr" != "0.0.0.0" ]; then
      warn "Datum's stratum.listen_addr is '$addr' — it must be 0.0.0.0 for the"
      warn "container to reach it. Re-run: bash host-setup/install-datum-gateway.sh configure"
      say ""
    fi
  else
    say "Check the Datum container's logs:  ./start-hashgg.sh logs datum"
    say ""
  fi
  say "HashGG is running either way — it just can't serve miners until this is fixed."
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_up() {
  detect_platform

  step "HashGG local setup"
  say ""
  say "This will, pausing for confirmation before anything that changes your system:"
  say "  1. check for Docker, curl and jq"
  say "  2. find Bitcoin Knots and check its config (read-only)"
  if [ "$OS" = "macos" ]; then
    say "  3. build and run Datum Gateway in Docker (macOS can't build it natively)"
  else
    say "  3. build, configure and run Datum Gateway on this machine"
  fi
  say "  4. start HashGG and give you the dashboard URL"
  say ""
  say "Datum Gateway is installed either way — it is what HashGG mines with. You"
  say "do not have to mine: making your node reachable is the other thing HashGG"
  say "does, and you can set up just that."
  say ""
  say "Platform: $OS"
  say "State:    $STATE_DIR"
  say ""
  confirm "Start?" default-yes || exit 0

  check_tools
  check_bitcoin

  step "Setting up Datum Gateway"
  if [ "$DATUM_MODE" = "native" ]; then
    ensure_datum_installed_native
    ensure_datum_configured
    ensure_datum_api_port
    ensure_datum_admin
    # A config change only takes effect on start, so bounce an already-running
    # Datum rather than silently leaving the old settings live.
    if [ "$DATUM_CONF_CHANGED" = "1" ]; then stop_datum_native; fi
    start_datum_native
  else
    ensure_datum_installed_docker
    ensure_datum_configured
    ensure_datum_api_port
    ensure_datum_admin
    check_macos_rpc_reachability
    write_container_datum_conf
  fi

  write_compose
  start_hashgg
  verify_hashgg_to_datum
  verify_hashgg_to_bitcoin

  local sport aport
  sport="$(datum_stratum_port)"
  aport="$(datum_api_port)"

  say ""
  step "Done"
  say ""
  if [ "$DATUM_API_ENABLED" = "1" ]; then
    say "  Datum Gateway     http://127.0.0.1:$aport"
    say "                    payout address, coinbase tags, pool or solo"
    say ""
  fi
  say "  HashGG            http://localhost:$HASHGG_UI_PORT"
  say "                    tunnel setup and your public mining endpoint"
  say ""
  say "  Stratum (local)   127.0.0.1:$sport"
  say "                    for miners on this machine or your LAN"
  say ""

  if [ "$DATUM_API_ENABLED" = "1" ] && [ -n "$(json_get "$USER_DATUM_CONF" '.api.admin_password')" ]; then
    say "  Sign in first     http://127.0.0.1:$aport/clients"
    if [ -n "$DATUM_ADMIN_PASSWORD_NEW" ]; then
      say "                    admin / $DATUM_ADMIN_PASSWORD_NEW"
      say "                    (generated just now; kept in $USER_DATUM_CONF)"
    else
      say "                    username 'admin', password from api.admin_password in"
      say "                    $USER_DATUM_CONF"
    fi
    say ""
    say "                    Datum's settings page never prompts for a password, so"
    say "                    saving there fails with \"This action requires admin"
    say "                    access\" until your browser has signed in somewhere that"
    say "                    does. The /clients page above is the one that asks."
    say ""
  fi

  say "To mine: start with Datum Gateway — set your payout address and coinbase"
  say "tag there first. Then use HashGG to pick a tunnel and get your public"
  say "endpoint."
  say ""
  if [ "$BITCOIN_REACHABLE" = "no" ]; then
    warn "One thing needs fixing: HashGG cannot reach Bitcoin Knots (see above)."
    say "Mining works regardless. Making your node reachable will not, until that"
    say "is sorted out."
    say ""
  else
    say "HashGG can also just make your Bitcoin node reachable from the internet,"
    say "without mining. That is on the same first screen, and stopping there is a"
    say "perfectly good place to stop."
    say ""
  fi
  say "  ./start-hashgg.sh status    what's running"
  say "  ./start-hashgg.sh logs      follow HashGG's logs ('logs datum' for Datum)"
  say "  ./start-hashgg.sh down      stop everything"
  say ""
}

cmd_down() {
  detect_platform
  step "Stopping"

  if [ -r "$COMPOSE_FILE" ]; then
    compose down || warn "docker compose down reported a problem."
    ok "Containers stopped"
  else
    info "No generated compose file — nothing container-side to stop."
  fi

  if [ "$DATUM_MODE" = "native" ] && datum_native_running; then
    stop_datum_native
  fi
  say ""
  ok "Stopped. Your Bitcoin node was not touched."
  info "HashGG's data volume is kept, so your tunnel settings survive."
  info "To wipe it too: docker volume rm hashgg_hashgg-data"
}

cmd_status() {
  detect_platform
  step "Status"

  if bitcoin_running; then
    ok "Bitcoin Knots: running"
  else
    warn "Bitcoin Knots: not running"
  fi

  local sport; sport="$(datum_stratum_port)"
  if [ "$DATUM_MODE" = "native" ]; then
    if datum_native_running; then
      ok "Datum Gateway: running (pid $(cat "$DATUM_PID_FILE"), native)"
    elif port_open 127.0.0.1 "$sport"; then
      ok "Datum Gateway: port $sport open (started outside this script)"
    else
      warn "Datum Gateway: not running"
    fi
  else
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^hashgg-datum$'; then
      ok "Datum Gateway: running (container hashgg-datum)"
    else
      warn "Datum Gateway: not running"
    fi
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^hashgg$'; then
    ok "HashGG: running — http://localhost:$HASHGG_UI_PORT"
    local bs bdet
    bs="$(curl -fsS --max-time 20 "http://127.0.0.1:$HASHGG_UI_PORT/api/btc/status" 2>/dev/null || true)"
    if [ -n "$bs" ]; then
      bdet="$(printf '%s' "$bs" | jq -r 'if .detected then "yes" elif .detecting then "checking" else "no" end' 2>/dev/null || echo '?')"
      case "$bdet" in
        yes)      ok   "Bitcoin Knots: reachable from HashGG" ;;
        checking) info "Bitcoin Knots: still checking" ;;
        no)       warn "Bitcoin Knots: NOT reachable from HashGG — run ./start-hashgg.sh up for how to fix it" ;;
      esac
    fi
  else
    warn "HashGG: not running"
  fi

  say ""
  say "  Datum Gateway   http://127.0.0.1:$(datum_api_port)"
  say "  HashGG          http://localhost:$HASHGG_UI_PORT"
  say "  Stratum         127.0.0.1:$sport"
  say ""
  say "State dir: $STATE_DIR"
}

cmd_logs() {
  detect_platform
  local what="${1:-hashgg}"

  case "$what" in
    datum)
      if [ "$DATUM_MODE" = "native" ]; then
        [ -r "$DATUM_LOG_FILE" ] || die "No Datum log yet at $DATUM_LOG_FILE."
        info "Datum log: $DATUM_LOG_FILE (Ctrl-C to stop)"
        say ""
        tail -n 40 -f "$DATUM_LOG_FILE"
      else
        [ -r "$COMPOSE_FILE" ] || die "Nothing to show yet — run './start-hashgg.sh' first."
        compose logs -f --tail 40 datum
      fi
      ;;
    hashgg)
      [ -r "$COMPOSE_FILE" ] || die "Nothing to show yet — run './start-hashgg.sh' first."
      [ "$DATUM_MODE" = "native" ] && info "(Datum logs separately: ./start-hashgg.sh logs datum)"
      compose logs -f --tail 40 hashgg
      ;;
    *) die "Unknown log target '$what'. Use 'hashgg' or 'datum'." ;;
  esac
}

print_help() {
  cat <<EOF
start-hashgg.sh — get HashGG running on this machine.

  up       (default) Walk through the whole setup and leave HashGG running.
  down     Stop HashGG and Datum Gateway. Bitcoin Knots is left alone.
  status   Show what's running.
  logs     Follow HashGG's logs. Use 'logs datum' for Datum Gateway instead.
  help     This message.

Environment overrides:
  HASHGG_IMAGE      Docker image to run (default: $HASHGG_IMAGE)
                    Use this to test a local build.
  HASHGG_UI_PORT    Host port for the dashboard (default: 3000)
  HASHGG_STATE_DIR  Where generated files live (default: $STATE_DIR)
  DATUM_REF         Upstream Datum Gateway tag (default: $DATUM_REF)

The script never edits bitcoin.conf. When your node needs a setting it prints
the lines and waits for you to add them.
EOF
}

case "${1:-up}" in
  up|"")        cmd_up ;;
  down|stop)    cmd_down ;;
  status)       cmd_status ;;
  logs)         shift; cmd_logs "$@" ;;
  -h|--help|help) print_help ;;
  *) err "Unknown command: $1"; say ""; print_help; exit 1 ;;
esac
