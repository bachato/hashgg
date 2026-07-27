'use strict';

// Drives the StartTunnel setup on the user's VPS over SSH.
//
// HashGG connects as an account that sshd pins to a shim, which maps to exactly
// two root commands and nothing else (see starttunnel-payload.js). So this file
// cannot run arbitrary commands even if it wanted to: the strings below are
// requests, and the VPS decides what they mean.
//
// It exists so that the slow, failure-prone part of the flow belongs to
// software rather than to a person. Installing a package over a fresh VPS's
// network takes minutes and fails in ways that need a retry, not a paragraph of
// instructions — and the audience for this feature is explicitly people who
// should not have to read shell output to find out what went wrong.

const { spawn } = require('child_process');
const fs = require('fs');
const payload = require('./starttunnel-payload');

const KEY_FILE = '/root/data/btc_setup_ssh_key';
const KNOWN_HOSTS_FILE = '/root/data/btc_setup_known_hosts';

// A first run installs StartTunnel over the VPS's network. Two minutes is
// typical, so the ceiling is generous — the point of it is to end a wedged run,
// not to bound a slow one.
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const CONNECT_TIMEOUT_S = 20;
const MAX_LINES = 200;

// One run at a time, in memory. Deliberately not persisted: it describes an
// operation in progress, and a restart means it is no longer in progress.
let run = null;

function state() {
  if (!run) return { state: 'idle', lines: [] };
  return {
    state: run.state,
    lines: run.lines.slice(-40),
    error: run.error || null,
    config: run.state === 'done' ? run.config : null,
    host: run.host,
  };
}

function isRunning() {
  return !!run && run.state === 'running';
}

/**
 * Ask the VPS to run one of its two permitted commands.
 * Resolves with { ok, lines, config, error } — never rejects.
 */
function invoke(host, privateKey, request, onLine) {
  return new Promise((resolve) => {
    try {
      fs.writeFileSync(KEY_FILE, privateKey, { mode: 0o600 });
      fs.chmodSync(KEY_FILE, 0o600);
    } catch (err) {
      return resolve({ ok: false, error: `Could not prepare the SSH key: ${err.message}` });
    }

    const args = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${KNOWN_HOSTS_FILE}`,
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${CONNECT_TIMEOUT_S}`,
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=8',
      '-i', KEY_FILE,
      `${payload.SETUP_USER}@${host}`,
      request,
    ];

    const proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [];
    let stderr = '';
    let buf = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, lines, error: 'The VPS took too long to respond. It may still be working — wait a minute and try again.' });
    }, RUN_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (lines.length < MAX_LINES) lines.push(line);
        if (onLine) onLine(line);
      }
    });
    proc.stderr.on('data', (c) => { if (stderr.length < 4096) stderr += c.toString(); });

    proc.on('error', (err) => finish({ ok: false, lines, error: friendlySsh(err.message) }));

    proc.on('close', () => {
      const text = lines.join('\n');
      const failed = lines.find((l) => l.startsWith(payload.FAIL_MARKER));
      if (failed) {
        return finish({ ok: false, lines, error: failed.slice(payload.FAIL_MARKER.length).trim() });
      }
      if (!text.includes(payload.OK_MARKER)) {
        return finish({ ok: false, lines, error: friendlySsh(stderr.trim() || 'The setup did not finish.') });
      }
      const m = text.match(
        new RegExp(`${payload.CONFIG_BEGIN}\\n([\\s\\S]*?)\\n${payload.CONFIG_END}`));
      finish({ ok: true, lines, config: m ? m[1].trim() : null });
    });
  });
}

// ssh's own words are precise and unhelpful to the person reading them here.
function friendlySsh(raw) {
  const s = String(raw || '');
  if (/permission denied|publickey/i.test(s)) {
    return 'The VPS refused HashGG\'s key. Paste the setup command into your VPS again, then retry.';
  }
  if (/connection timed out|no route to host|network is unreachable/i.test(s)) {
    return 'Could not reach the VPS. Check it is running and the address is right.';
  }
  if (/connection refused/i.test(s)) {
    return 'The VPS refused the connection. It may still be starting up — wait a minute and try again.';
  }
  if (/host key verification failed/i.test(s)) {
    return 'The VPS\'s identity changed. If you rebuilt it, start this step again.';
  }
  if (/name or service not known|could not resolve/i.test(s)) {
    return 'That address could not be found. Check it against the Manage page.';
  }
  return s.split('\n').filter(Boolean).pop() || 'The setup did not finish.';
}

/**
 * Start a setup run. Returns immediately; poll state().
 */
function start(host, privateKey) {
  if (isRunning()) return { ok: false, error: 'Setup is already running.' };
  run = { state: 'running', host, lines: [], error: null, config: null };
  const current = run;

  let inConfig = false;
  invoke(host, privateKey, 'setup', (line) => {
    if (current !== run || !line) return;
    if (line.startsWith(payload.CONFIG_BEGIN)) { inConfig = true; return; }
    if (line.startsWith(payload.CONFIG_END)) { inConfig = false; return; }
    if (inConfig || line.startsWith('HASHGG_')) return;
    current.lines.push(line);
  }).then((r) => {
    if (current !== run) return;   // superseded
    if (r.ok && r.config) {
      run.state = 'done';
      run.config = r.config;
    } else {
      run.state = 'error';
      run.error = r.error || 'The setup did not finish.';
    }
  });

  return { ok: true };
}

/**
 * Remove HashGG's access from the VPS. Best-effort by design: the account it
 * removes can only run this and the setup command, so failing to remove it
 * leaves a bounded thing behind rather than an open door. Never block the user
 * on it.
 */
async function cleanup(host, privateKey) {
  const r = await invoke(host, privateKey, 'cleanup', null);
  return { ok: !!r.ok, error: r.error || null };
}

function reset() {
  run = null;
  try { fs.unlinkSync(KEY_FILE); } catch (_) {}
  try { fs.unlinkSync(KNOWN_HOSTS_FILE); } catch (_) {}
}

module.exports = { start, state, isRunning, cleanup, reset };
