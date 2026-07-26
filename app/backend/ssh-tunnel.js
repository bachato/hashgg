'use strict';

// SshTunnel — supervises one `ssh -N -R …` child process.
//
// Extracted verbatim from vps-manager.js so a second tunnel (Bitcoin P2P) can
// reuse it instead of duplicating the lifecycle logic. The subtle parts are all
// load-bearing and were arrived at through real failures — do not simplify them
// without understanding why each exists:
//
//   * generation counters — a child that exits *after* we've moved on must not
//     drive status or schedule a restart; without this a stop→start races itself.
//   * kill by process HANDLE, never by raw PID — a PID captured before a fast
//     restart can be reused by an unrelated process by the time we SIGKILL.
//   * "connected" comes from ssh, not from a clock — we wait for its own
//     `remote forward success for: listen …` line. An earlier version declared
//     success after a fixed 5 s, which fired *inside* ssh's 30 s ConnectTimeout:
//     against an unreachable host it reported connected for ~25 s out of every
//     35 s cycle, publishing an endpoint that did not work. A timer cannot know
//     whether a socket was established; ssh does.
//   * the debounced restart — several forward changes in quick succession
//     coalesce into one reconnect instead of flapping the tunnel.
//
// The class owns process supervision only. Anything app-specific (reading state,
// publishing an endpoint, mapping stderr to user-facing text) belongs to the
// caller, which supplies it through the callbacks below.

const { spawn } = require('child_process');
const fs = require('fs');
const EventEmitter = require('events');

const SSH_BIN = '/usr/bin/ssh';
const MAX_BACKOFF = 60000;
const RECONFIGURE_DEBOUNCE_MS = 600;
const RESTART_DELAY_MS = 1000;
const KILL_GRACE_MS = 5000;
const SSH_CONNECT_TIMEOUT_S = 30;
// Backstop only — we normally learn we're up from ssh itself (see below). This
// must comfortably exceed SSH_CONNECT_TIMEOUT_S, or it fires while ssh is still
// dialling and we report a tunnel that was never established.
const FORWARD_TIMEOUT_MS = (SSH_CONNECT_TIMEOUT_S + 15) * 1000;

class SshTunnel extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}   opts.name            label used in log lines, e.g. 'vps'
   * @param {string}   opts.keyFile         where the private key is written (0600)
   * @param {string}   opts.knownHostsFile  UserKnownHostsFile for this tunnel
   * @param {function} opts.getConfig       () => null | {
   *                     host, port, user, privateKey, forwards: string[] }
   *                   Returning null means "not configured" — start() is a no-op.
   * @param {function} [opts.onStatus]      (status, errorMessage|null) => void
   *                   status: disconnected | connecting | connected | error
   * @param {function} [opts.onStable]      () => void — fired once per successful
   *                   connect, after the stable timer, before onStatus('connected')
   */
  constructor(opts) {
    super();
    this.name = opts.name;
    this.keyFile = opts.keyFile;
    this.knownHostsFile = opts.knownHostsFile;
    this.getConfig = opts.getConfig;
    this.onStatus = opts.onStatus || (() => {});
    this.onStable = opts.onStable || (() => {});

    this.process = null;
    this.generation = 0;
    this.status = 'disconnected';
    this.backoff = 2000;
    this.restartTimer = null;
    this.stableTimer = null;
    this.reconfigureTimer = null;
    // The delayed start inside restart(). Tracked, not fire-and-forget: an
    // untracked timer survives stop(), so a shutdown landing in its window
    // spawns a fresh ssh child as the process exits — orphaning exactly the
    // child this class stops in order to avoid "stuck in Stopping".
    this.reconfigureStartTimer = null;
    this.upSince = null;
  }

  start() {
    const cfg = this.getConfig();
    if (!cfg || !cfg.host || !cfg.privateKey) {
      console.log(`[${this.name}] Not configured, skipping start`);
      return;
    }
    if (this.process) {
      console.log(`[${this.name}] Already running`);
      return;
    }

    try {
      fs.writeFileSync(this.keyFile, cfg.privateKey, { mode: 0o600 });
    } catch (err) {
      console.error(`[${this.name}] Failed to write key file: ${err.message}`);
      this._setStatus('error', 'Failed to write SSH key file');
      this._scheduleRestart();
      return;
    }

    this.generation++;
    const gen = this.generation;

    this._setStatus('connecting', null);

    // IPv6 addresses require bracket notation in SSH user@host form
    const sshHost = cfg.host.includes(':') ? `[${cfg.host}]` : cfg.host;

    const args = [
      '-N',
      // -v is load-bearing: it is what makes ssh announce "remote forward
      // success", which is our only trustworthy signal that the tunnel is
      // actually carrying traffic. Debug lines are filtered out of the log and
      // out of the error message below.
      '-v',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${this.knownHostsFile}`,
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_S}`,
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'BatchMode=yes',
      '-i', this.keyFile,
    ];
    for (const spec of cfg.forwards) args.push('-R', spec);
    args.push('-p', String(cfg.port || 22), `${cfg.user || 'hashgg'}@${sshHost}`);

    console.log(`[${this.name}] Connecting to ${cfg.user || 'hashgg'}@${cfg.host}:${cfg.port || 22} (forwards: ${cfg.forwards.join(', ')})`);

    const proc = spawn(SSH_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = proc;

    let lastStderr = '';
    let forwardsUp = 0;
    const forwardsWanted = cfg.forwards.length;

    proc.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.log(`[${this.name}:out] ${line}`);
    });

    // A single 'data' event can carry several lines, so split before matching —
    // otherwise the success line hides inside a chunk and is never seen.
    proc.stderr.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        const l = line.trim();
        if (!l) continue;

        const isDebug = l.startsWith('debug');

        if (l.includes('remote forward success for:')) {
          forwardsUp++;
          console.log(`[${this.name}] forward up (${forwardsUp}/${forwardsWanted}): ${l.replace(/^debug\d*:\s*/, '')}`);
          // Every forward is bound on the remote side — this, not elapsed time,
          // is what "connected" means. ExitOnForwardFailure=yes guarantees the
          // process dies if any later forward fails, so we cannot be early.
          if (forwardsUp >= forwardsWanted && this.generation === gen
              && this.process && this.status === 'connecting') {
            this._clearStable();
            this.backoff = 2000;
            this.upSince = Date.now();
            this.onStable();
            this._setStatus('connected', null);
          }
          continue;
        }

        // Keep the log readable: ~90 debug lines per connect would bury the
        // messages that matter.
        if (!isDebug) {
          console.log(`[${this.name}:err] ${l}`);
          // Only non-debug lines make sensible user-facing errors: "Permission
          // denied (publickey).", "ssh: connect to host … Connection timed
          // out", "Error: remote port forwarding failed for listen port 8333".
          lastStderr = l;
        }
      }
    });

    proc.on('error', (err) => {
      if (this.generation !== gen) return;
      console.error(`[${this.name}] Spawn error: ${err.message}`);
      this._clearStable();
      this.process = null;
      this._setStatus('error', err.message);
      this._scheduleRestart();
    });

    proc.on('close', (code) => {
      if (this.generation !== gen) {
        console.log(`[${this.name}] Stale process (gen ${gen}) exited, ignoring`);
        return;
      }
      console.log(`[${this.name}] SSH exited with code ${code}`);
      this._clearStable();
      this.process = null;
      if (this.status !== 'disconnected') {
        this._setStatus('error', lastStderr || `SSH exited (code ${code})`);
        this._scheduleRestart();
      }
    });

    // Backstop. If ssh never announces the forwards — a version that words the
    // message differently, or a wedged connection that neither succeeds nor
    // times out — kill it rather than sit in 'connecting' forever. Killing lets
    // the existing close handler report the error and schedule the retry, so
    // there is one path for "it didn't work" instead of two.
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      if (this.generation === gen && this.process && this.status === 'connecting') {
        console.error(`[${this.name}] No forward confirmation after ${FORWARD_TIMEOUT_MS / 1000}s — restarting`);
        if (!lastStderr) lastStderr = 'Timed out waiting for the tunnel to come up';
        try { this.process.kill('SIGTERM'); } catch (_) {}
      }
    }, FORWARD_TIMEOUT_MS);
  }

  stop() {
    this._clearRestart();
    this._clearStable();
    // A direct stop (disconnect/reset/shutdown) cancels any pending debounced
    // reconfigure so we don't silently reconnect afterwards — BOTH halves of it,
    // the debounce and the delayed start it schedules.
    if (this.reconfigureTimer) { clearTimeout(this.reconfigureTimer); this.reconfigureTimer = null; }
    if (this.reconfigureStartTimer) { clearTimeout(this.reconfigureStartTimer); this.reconfigureStartTimer = null; }
    if (this.process) {
      this._setStatus('disconnected', null);
      const proc = this.process;
      this.process = null;
      this.generation++;
      let exited = false;
      proc.once('exit', () => { exited = true; });
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!exited) { try { proc.kill('SIGKILL'); } catch (_) {} }
      }, KILL_GRACE_MS).unref();
    } else {
      this._setStatus('disconnected', null);
    }
    this.upSince = null;
  }

  restart() {
    if (this.reconfigureTimer) clearTimeout(this.reconfigureTimer);
    this.reconfigureTimer = setTimeout(() => {
      this.reconfigureTimer = null;
      this.stop();
      // stop() clears this field, so assign AFTER it — otherwise the timer we
      // are about to create is the one thing stop() cannot cancel.
      this.reconfigureStartTimer = setTimeout(() => {
        this.reconfigureStartTimer = null;
        this.start();
      }, RESTART_DELAY_MS);
    }, RECONFIGURE_DEBOUNCE_MS);
  }

  getUptime() {
    if (!this.upSince) return 0;
    return Math.floor((Date.now() - this.upSince) / 1000);
  }

  _setStatus(status, errorMsg) {
    this.status = status;
    this.onStatus(status, errorMsg === undefined ? null : errorMsg);
    this.emit('status', status);
  }

  _scheduleRestart() {
    this._clearRestart();
    console.log(`[${this.name}] Restarting in ${this.backoff}ms...`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  _clearRestart() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  _clearStable() {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }
}

module.exports = { SshTunnel, SSH_BIN, MAX_BACKOFF, FORWARD_TIMEOUT_MS };
