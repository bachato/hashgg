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
};

let currentState = null;

function ensureDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    currentState = JSON.parse(raw);
    if (!currentState || typeof currentState !== 'object') {
      throw new Error('Invalid state format');
    }
    // Ensure all expected fields exist (backfills new fields on upgrade from 0.1.x / 0.2.x)
    currentState = { ...INITIAL_STATE, ...currentState };
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
      currentState = { ...INITIAL_STATE };
      save();
    } else {
      // Corrupt file — back it up and reset
      const backupPath = `${STATE_FILE}.corrupt.${Date.now()}`;
      try { fs.copyFileSync(STATE_FILE, backupPath); } catch (_) {}
      console.error(`[state] Corrupt state file backed up to ${backupPath}, resetting`);
      currentState = { ...INITIAL_STATE };
      save();
    }
  }
  return currentState;
}

function save() {
  ensureDir();
  currentState.last_updated = new Date().toISOString();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(currentState, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
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
  currentState = { ...INITIAL_STATE };
  save();
  return currentState;
}

module.exports = { load, get, update, reset };
