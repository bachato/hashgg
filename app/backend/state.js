'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR = '/root/data';
const STATE_FILE = path.join(STATE_DIR, 'state.json');

const INITIAL_STATE = {
  version: 1,
  // --- Tunnel mode ---
  tunnel_mode: null,            // null | 'playit' | 'vps'
  // --- Shared ---
  public_endpoint: null,
  last_updated: new Date().toISOString(),
  // --- Playit.gg ---
  playit_secret: null,
  tunnel_id: null,
  claim_code: null,
  claim_status: 'idle',
  agent_status: 'stopped',
  agent_renamed: false,         // true once we've renamed our agent to "HashGG (...)"
  // --- VPS tunnel ---
  vps_host: null,
  vps_ssh_port: 22,
  vps_ssh_user: 'hashgg',
  vps_remote_port: 23335,
  vps_ssh_private_key: null,    // PKCS8 PEM — never sent to frontend
  vps_ssh_public_key: null,     // OpenSSH authorized_keys format — safe to display
  vps_tunnel_status: 'disconnected',
  vps_last_error: null,
  vps_host_key_verified: false, // true after first successful connect + key stored
  // --- Bitcoin P2P clearnet inbound (advanced; independent of tunnel_mode) ---
  // Flat keys, deliberately: load() does a SHALLOW {...freshInitial(), ...stored}
  // merge, so a nested object read from an older state.json would be taken
  // wholesale and silently miss any sub-field added later.
  btc_p2p_enabled: false,
  btc_p2p_remote_port: 8333,          // public port on the P2P VPS
  btc_p2p_target_host: null,          // manual override; null = auto-detect
  btc_p2p_target_port: null,
  // Its own VPS record — populated even when the user picks "same as my stratum
  // VPS", so a stratum-side reset or mode switch can never orphan this tunnel.
  btc_p2p_vps_source: null,           // 'shared' | 'own' | 'startos'  (UI copy only)
  btc_p2p_vps_host: null,
  btc_p2p_vps_ssh_port: 22,
  btc_p2p_vps_ssh_user: 'hashgg',
  // Its own copy of the key, not a reference to vps_ssh_private_key. Same key
  // material — we mint one keypair — but an independent lifetime: /api/vps/reset
  // nulls the stratum key, which would otherwise leave this tunnel unable to
  // reconnect after any restart. Same reasoning as storing the host.
  btc_p2p_vps_private_key: null,
  // The matching public key, stored for the same reason: the P2P setup script
  // must install the key THIS tunnel authenticates with. Reading the stratum
  // record's copy would hand the user a script that installs a different key
  // after /api/vps/reset, so re-running it could never fix the auth failure.
  btc_p2p_vps_public_key: null,
  btc_p2p_tunnel_status: 'disconnected',
  btc_p2p_last_error: null,
  // The endpoint the user actually pasted into their node, captured at ack time.
  // BOTH halves matter: the line is `host:port`, so changing the public port
  // under Advanced invalidates it just as surely as changing the VPS does.
  btc_p2p_advertised_for_host: null,
  btc_p2p_advertised_port: null,
  btc_p2p_acked: false,
  btc_p2p_verified_at: null,
  btc_p2p_verified_agent: null,
  // --- Additional miners (advanced) ---
  // Each: { id, name, local_ip, local_port, listen_port (local socat bridge),
  //         tunnel_id (playit), public_endpoint, remote_port (vps), status, last_error }
  extra_connections: [],
};

let currentState = null;

// Fresh copy of the defaults with its own array instances, so we never share the
// INITIAL_STATE.extra_connections reference (in-place mutation would leak into it).
function freshInitial() {
  return { ...INITIAL_STATE, extra_connections: [] };
}

function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
}

function load() {
  ensureDir();
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    // Tighten an existing file created before we started writing 0600. save()
    // would fix it on the next write, but an idle install might not write for a
    // long time, and the file holds the SSH private key — so narrow it on sight.
    try { fs.chmodSync(STATE_FILE, 0o600); } catch (_) {}
    currentState = JSON.parse(raw);
    if (!currentState || typeof currentState !== 'object') {
      throw new Error('Invalid state format');
    }
    // Ensure all expected fields exist (backfills new fields on upgrade from 0.1.x / 0.2.x)
    currentState = { ...freshInitial(), ...currentState };
    // Migration: existing users with playit_secret but no tunnel_mode — tunnel_mode
    // field didn't exist before 0.3.0.0, so any existing secret means they were on playit.
    if (!currentState.tunnel_mode && currentState.playit_secret) {
      currentState.tunnel_mode = 'playit';
    }
    // Migration: clear stale 'pending' claim state left over from a claim flow
    // that was never completed before an upgrade. The claim code is long expired
    // so the claim screen would be broken; drop back to the setup screen instead.
    if (currentState.claim_status === 'pending' && !currentState.playit_secret) {
      currentState.claim_status = 'idle';
      currentState.claim_code = null;
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      currentState = freshInitial();
      save();
    } else {
      // Corrupt file — back it up and reset
      const backupPath = `${STATE_FILE}.corrupt.${Date.now()}`;
      try { fs.copyFileSync(STATE_FILE, backupPath); } catch (_) {}
      console.error(`[state] Corrupt state file backed up to ${backupPath}, resetting`);
      currentState = freshInitial();
      save();
    }
  }
  return currentState;
}

function save() {
  // In-memory state stays authoritative; a failed persist (disk full, read-only
  // fs) must not throw out of update() — many callers are inside child-process
  // event handlers where an uncaught throw would crash the supervisor. Atomic
  // temp+rename so a partial write never corrupts the live file.
  // This file holds secrets — the VPS SSH private key and the playit agent key —
  // and on Umbrel it lives in a host directory (app-data/…/data) readable by any
  // local user, not just inside the container. Write it 0600.
  //
  // The mode is set explicitly with chmod rather than relying on writeFileSync's
  // `mode`, which is ignored when the temp file already exists (a leftover from a
  // crashed write would keep its old, wider mode). Both happen before the rename,
  // so the live file is never briefly world-readable.
  try {
    ensureDir();
    currentState.last_updated = new Date().toISOString();
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(currentState, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error(`[state] Failed to persist state: ${err.message}`);
  }
}

function get() {
  if (!currentState) load();
  return currentState;
}

function update(patch) {
  if (!currentState) load();
  Object.assign(currentState, patch);
  save();
  return currentState;
}

function reset() {
  currentState = freshInitial();
  save();
  return currentState;
}

module.exports = { load, get, update, reset };
