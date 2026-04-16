'use strict';

const { spawn } = require('child_process');
const EventEmitter = require('events');
const state = require('./state');

const PLAYIT_BIN = '/usr/local/bin/playitd';
const MAX_BACKOFF = 60000;

class PlayitManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.generation = 0; // tracks which process instance is current
    this.status = 'stopped'; // stopped | starting | running | crashed
    this.backoff = 1000;
    this.restartTimer = null;
    this.upSince = null;
  }

  start() {
    const secret = state.get().playit_secret;
    if (!secret) {
      console.log('[playit] No secret key configured, skipping agent start');
      return;
    }

    if (this.process) {
      console.log('[playit] Agent already running');
      return;
    }

    this.generation++;
    const gen = this.generation;

    this._setStatus('starting');
    console.log('[playit] Starting agent...');

    // playitd daemon: --secret for inline key, logs go to stderr
    const proc = spawn(PLAYIT_BIN, ['--secret', secret], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.process = proc;

    proc.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        console.log(`[playit:out] ${line}`);
        this._parseOutput(line);
      }
    });

    // playitd v1.0 logs to stderr
    proc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        console.log(`[playit:out] ${line}`);
        this._parseOutput(line);
      }
    });

    proc.on('error', (err) => {
      // Ignore if this is a stale process from a previous generation
      if (this.generation !== gen) return;
      console.error(`[playit] Failed to start: ${err.message}`);
      this.process = null;
      this._setStatus('crashed');
      this._scheduleRestart();
    });

    proc.on('close', (code) => {
      // Ignore if this is a stale process from a previous generation
      if (this.generation !== gen) {
        console.log(`[playit] Stale process (gen ${gen}) exited with code ${code}, ignoring`);
        return;
      }
      console.log(`[playit] Agent exited with code ${code}`);
      this.process = null;
      if (this.status !== 'stopped') {
        this._setStatus('crashed');
        this._scheduleRestart();
      }
    });

    // Consider it running after a short delay if it hasn't crashed
    setTimeout(() => {
      if (this.generation === gen && this.process && this.status === 'starting') {
        this._setStatus('running');
        this.backoff = 1000;
        this.upSince = Date.now();
      }
    }, 2000);
  }

  stop() {
    this._clearRestart();
    if (this.process) {
      this._setStatus('stopped');
      const proc = this.process;
      this.process = null;
      // Bump generation so the old close handler is ignored
      this.generation++;
      proc.kill('SIGTERM');
      // Force kill after 5 seconds
      const pid = proc.pid;
      setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch (_) {}
      }, 5000);
    } else {
      this._setStatus('stopped');
    }
    this.upSince = null;
  }

  restart() {
    this.stop();
    setTimeout(() => this.start(), 1000);
  }

  getUptime() {
    if (!this.upSince) return 0;
    return Math.floor((Date.now() - this.upSince) / 1000);
  }

  _setStatus(status) {
    this.status = status;
    state.update({ agent_status: status });
    this.emit('status', status);
  }

  _scheduleRestart() {
    this._clearRestart();
    console.log(`[playit] Restarting in ${this.backoff}ms...`);
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

  _parseOutput(line) {
    // Playit agent stdout can contain status info.
    // We look for tunnel assignment messages.
    // Format varies by version, but typically includes the public address.
    if (line.includes('tunnel') || line.includes('ready') || line.includes('address')) {
      this.emit('tunnel-update', line);
    }
  }
}

module.exports = new PlayitManager();
