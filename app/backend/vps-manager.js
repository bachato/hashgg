'use strict';

// VPS mode: the stratum tunnel. A thin consumer of SshTunnel — this module owns
// the state coupling (what to forward, what to publish), the tunnel class owns
// process supervision.

const EventEmitter = require('events');
const state = require('./state');
const { SshTunnel } = require('./ssh-tunnel');
const { friendlySshError, isPortCollision, suggestNextPort } = require('./ssh-errors');

const KEY_FILE = '/root/data/vps_ssh_key';
const KNOWN_HOSTS_FILE = '/root/data/vps_known_hosts';
// Port that socat listens on inside the container — where the SSH reverse tunnel
// forwards miner traffic. Must match the entrypoint's LISTEN_PORT, which defaults
// to DATUM_STRATUM_PORT. Hardcoding 23335 here was fine when that was always the
// default, but since v0.4.0.0 we honor DATUM_STRATUM_PORT from env (Umbrel sets
// 23334, for example) — so re-read it.
const LOCAL_STRATUM_PORT = parseInt(process.env.LISTEN_PORT || process.env.DATUM_STRATUM_PORT, 10) || 23335;

class VpsManager extends EventEmitter {
  constructor() {
    super();

    this.tunnel = new SshTunnel({
      name: 'vps',
      keyFile: KEY_FILE,
      knownHostsFile: KNOWN_HOSTS_FILE,
      getConfig: () => {
        const s = state.get();
        if (!s.vps_host || !s.vps_ssh_private_key) return null;

        // Primary forward: VPS public port → our socat (which fronts Datum).
        const forwards = [
          `0.0.0.0:${s.vps_remote_port || 23335}:127.0.0.1:${LOCAL_STRATUM_PORT}`,
        ];
        // Additional miners: one reverse forward each, to that connection's local
        // socat bridge (127.0.0.1:listen_port) — same pattern as the primary.
        // socat handles the hop to the user's actual stratum (IP or hostname).
        for (const c of (s.extra_connections || [])) {
          if (c.remote_port && c.listen_port) {
            forwards.push(`0.0.0.0:${c.remote_port}:127.0.0.1:${c.listen_port}`);
          }
        }

        return {
          host: s.vps_host,
          port: s.vps_ssh_port || 22,
          user: s.vps_ssh_user || 'hashgg',
          privateKey: s.vps_ssh_private_key,
          forwards,
        };
      },
      onStable: () => {
        // Publish the public endpoint and mark the host key as verified.
        const s = state.get();
        state.update({
          public_endpoint: `${s.vps_host}:${s.vps_remote_port || 23335}`,
          vps_host_key_verified: true,
        });
      },
      onStatus: (status, errorMsg) => {
        const patch = { vps_tunnel_status: status };
        // Was raw ssh stderr. A port collision on a shared VPS is a routine
        // outcome now that one server can carry several installations, and
        // "remote port forwarding failed for listen port 23335" is not something
        // to hand a miner.
        if (errorMsg) {
          const port = state.get().vps_remote_port || 23335;
          patch.vps_last_error = friendlySshError(errorMsg, { port });
          patch.vps_port_suggestion = isPortCollision(errorMsg) ? suggestNextPort(port) : null;
        }
        if (status === 'connected') {
          patch.vps_last_error = null;
          patch.vps_port_suggestion = null;
        }
        // Losing the tunnel means the advertised endpoint is no longer valid.
        if (status === 'error' || status === 'disconnected') patch.public_endpoint = null;
        state.update(patch);
        this.emit('status', status);
      },
    });
  }

  // `status` is read directly elsewhere (server.js, connections.js), so keep it
  // exposed as a plain property rather than making callers reach into .tunnel.
  get status() { return this.tunnel.status; }

  start() { this.tunnel.start(); }
  stop() { this.tunnel.stop(); }
  restart() { this.tunnel.restart(); }
  getUptime() { return this.tunnel.getUptime(); }
}

module.exports = new VpsManager();
