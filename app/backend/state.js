'use strict';

const fs = require('fs');
const path = require('path');

const STATE_DIR = '/root/data';
const STATE_FILE = path.join(STATE_DIR, 'state.json');

const INITIAL_STATE = {
  version: 1,
  playit_secret: null,
  tunnel_id: null,
  public_endpoint: null,
  claim_code: null,
  claim_status: 'idle',
  agent_status: 'stopped',
  last_updated: new Date().toISOString(),
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
    // Ensure all expected fields exist
    currentState = { ...INITIAL_STATE, ...currentState };
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
