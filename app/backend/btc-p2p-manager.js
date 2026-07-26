'use strict';

// Bitcoin P2P clearnet inbound — the second SSH tunnel.
//
// Forwards <vps>:<remote_port> straight to the Bitcoin node's plain P2P port, so
// other nodes on the internet can reach it. Deliberately a SEPARATE ssh process
// from the stratum tunnel:
//
//   * mining must not degrade — stratum is latency-critical, Bitcoin P2P is bulk
//     traffic, and sharing one SSH transport means head-of-line blocking;
//   * ExitOnForwardFailure=yes is fatal by design, so a port conflict here would
//     otherwise take the stratum tunnel down with it;
//   * the two have independent lifecycles — adding an extra miner bounces the
//     stratum tunnel, and this must not ride along.
//
// No socat: `ssh -R bind:port:host:port` resolves the destination in the ssh
// client, so it dials the node directly. socat with `fork` would spawn a process
// per inbound peer, which for a well-connected node is 100+ processes.
//
// BLAST RADIUS: nothing here may touch vps_* state or call vpsManager. A failure
// in this file must never be visible on the mining path.

const state = require('./state');
const bitcoinP2p = require('./bitcoin-p2p');
const { SshTunnel } = require('./ssh-tunnel');

// Its own key file and known_hosts, even though the private key is shared with
// the stratum record. Two tunnels writing one path could interleave, and more
// importantly `/api/vps/reset` deletes the stratum known_hosts — sharing it
// would let a stratum-side reset disturb this tunnel, which the decoupling
// design explicitly forbids.
const KEY_FILE = '/root/data/btc_p2p_ssh_key';
const KNOWN_HOSTS_FILE = '/root/data/btc_p2p_known_hosts';

class BtcP2pManager {
  constructor() {
    // Where the node lives. Resolved by detection when the tunnel is enabled and
    // re-checked periodically, because getConfig() must stay synchronous.
    this.target = null;
    this.monitor = null;
    // The config the live ssh process was spawned with — see _signature().
    this.spawnedSignature = null;

    this.tunnel = new SshTunnel({
      name: 'btc-p2p',
      keyFile: KEY_FILE,
      knownHostsFile: KNOWN_HOSTS_FILE,
      getConfig: () => {
        const s = state.get();
        if (!s.btc_p2p_enabled) return null;
        const privateKey = s.btc_p2p_vps_private_key || s.vps_ssh_private_key;
        if (!s.btc_p2p_vps_host || !privateKey) return null;
        if (!this.target) return null;

        const remote = s.btc_p2p_remote_port || 8333;
        return {
          host: s.btc_p2p_vps_host,
          port: s.btc_p2p_vps_ssh_port || 22,
          user: s.btc_p2p_vps_ssh_user || 'hashgg',
          privateKey,
          // Straight to the node's plain bind port — never the whitebind port.
          forwards: [`0.0.0.0:${remote}:${this.target.host}:${this.target.port}`],
        };
      },
      onStatus: (status, errorMsg) => {
        const patch = { btc_p2p_tunnel_status: status };
        if (errorMsg) patch.btc_p2p_last_error = friendlyError(errorMsg, state.get());
        if (status === 'connected') patch.btc_p2p_last_error = null;
        state.update(patch);
      },
    });
  }

  get status() { return this.tunnel.status; }
  getUptime() { return this.tunnel.getUptime(); }

  // Resolve where the node is. Returns the target or throws with a message the
  // UI can show directly.
  async resolveTarget() {
    const s = state.get();
    const override = s.btc_p2p_target_host
      ? { host: s.btc_p2p_target_host, port: s.btc_p2p_target_port }
      : null;
    const r = await bitcoinP2p.detectLocalNode({ override, force: true });
    if (!r.ok) throw new Error(r.error || 'Could not find a Bitcoin node');
    this.target = { host: r.host, port: r.port };
    return this.target;
  }

  // Everything the ssh command line is built from. `start()` is a no-op when a
  // process is already running, so any of these changing while the tunnel is up
  // has to force a rebuild — otherwise the UI reports the new port while traffic
  // still arrives on the old one, which stays invisible until Verify fails.
  //
  // This CANNOT be compared against freshly-read state on both sides: the API
  // handler writes the new values before calling enable(), so both reads would
  // see the new config and nothing would ever look changed. The comparison has
  // to be against what the live ssh process was actually spawned with, which is
  // what `spawnedSignature` records.
  _signature() {
    const s = state.get();
    return [
      s.btc_p2p_vps_host, s.btc_p2p_vps_ssh_port, s.btc_p2p_vps_ssh_user,
      s.btc_p2p_remote_port,
      this.target && this.target.host, this.target && this.target.port,
    ].join('|');
  }

  async enable() {
    const running = this.status === 'connected' || this.status === 'connecting';
    const before = this.spawnedSignature;
    await this.resolveTarget();          // throws if we can't find the node
    state.update({ btc_p2p_enabled: true });
    const now = this._signature();
    if (running && before && now !== before) {
      console.log(`[btc-p2p] Configuration changed (${before} -> ${now}) — rebuilding the tunnel`);
      this.tunnel.restart();             // debounced stop + start
    } else {
      this.tunnel.start();               // no-op if already running
    }
    this.spawnedSignature = now;
    this.startMonitor();
  }

  // The node can move under us — Umbrel re-assigning a container address, a
  // user changing their node's port. The forward is baked into the ssh command
  // at spawn time, so without this the tunnel would keep pointing at an address
  // nothing answers on, looking connected the whole time.
  startMonitor() {
    if (this.monitor) return;
    this.monitor = setInterval(() => {
      this.checkTarget().catch(() => {});
    }, 60000);
    if (this.monitor.unref) this.monitor.unref();
  }

  stopMonitor() {
    if (this.monitor) { clearInterval(this.monitor); this.monitor = null; }
  }

  async checkTarget() {
    if (!state.get().btc_p2p_enabled) return;
    const before = this.target;
    let now;
    try { now = await this.resolveTarget(); }
    catch (_) { return; }   // node briefly unreachable: keep the forward as-is
    if (before && (before.host !== now.host || before.port !== now.port)) {
      console.log(`[btc-p2p] Node moved ${before.host}:${before.port} -> ${now.host}:${now.port} — rebuilding the tunnel`);
      this.tunnel.restart();   // debounced
      this.spawnedSignature = this._signature();
    }
  }

  disable() {
    this.stopMonitor();
    // Stop first, then clear the flag: getConfig() returns null once the flag is
    // down, and stop() must still know what it is stopping.
    this.tunnel.stop();
    this.spawnedSignature = null;
    state.update({ btc_p2p_enabled: false, btc_p2p_tunnel_status: 'disconnected' });
  }

  // Called on boot and after a reconfigure. Safe to call when disabled.
  async resumeIfEnabled() {
    const s = state.get();
    if (!s.btc_p2p_enabled || !s.btc_p2p_vps_host) return;
    try {
      await this.resolveTarget();
      this.tunnel.start();
      this.spawnedSignature = this._signature();
      this.startMonitor();
    } catch (err) {
      console.error(`[btc-p2p] Cannot resume: ${err.message}`);
      state.update({ btc_p2p_tunnel_status: 'error', btc_p2p_last_error: err.message });
    }
  }

  stop() { this.stopMonitor(); this.tunnel.stop(); this.spawnedSignature = null; }

  /**
   * Dial our own public endpoint from here — out to the internet and back
   * through the VPS — and complete a Bitcoin handshake. This is the only
   * credential-free proof that the whole chain works.
   */
  async verify() {
    const s = state.get();
    if (!s.btc_p2p_vps_host) return { ok: false, error: 'No VPS configured yet' };
    const port = s.btc_p2p_remote_port || 8333;

    // Compare against the node we found locally, so we can tell "reachable" from
    // "reachable, but something else answered".
    let expect = null;
    try {
      const local = await bitcoinP2p.detectLocalNode({
        override: s.btc_p2p_target_host
          ? { host: s.btc_p2p_target_host, port: s.btc_p2p_target_port } : null,
      });
      if (local.ok) expect = local;
    } catch (_) {}

    const r = await bitcoinP2p.verifyPublic(s.btc_p2p_vps_host, port, expect);
    if (r.ok) {
      state.update({
        btc_p2p_verified_at: new Date().toISOString(),
        btc_p2p_verified_agent: r.user_agent || null,
      });
    }
    return r;
  }
}

// ssh's own words are precise but unhelpful to a non-technical user. Translate
// the ones that actually happen; pass anything else through unchanged rather
// than inventing a guess.
function friendlyError(raw, s) {
  const port = (s && s.btc_p2p_remote_port) || 8333;
  if (/remote port forwarding failed/i.test(raw)) {
    return `Port ${port} is already in use on your VPS. Free it up, or pick a different port under Advanced.`;
  }
  if (/permission denied/i.test(raw)) {
    return 'The VPS rejected our key. Re-run the setup script on your VPS.';
  }
  if (/connection timed out|no route to host|network is unreachable/i.test(raw)) {
    return 'Could not reach your VPS. Check it is running and its address is correct.';
  }
  if (/connection refused/i.test(raw)) {
    return 'Your VPS refused the SSH connection. Check the SSH port under Advanced.';
  }
  if (/host key verification failed/i.test(raw)) {
    return 'The VPS host key changed. If you rebuilt the VPS, reset this connection and set it up again.';
  }
  return raw;
}

module.exports = new BtcP2pManager();
module.exports.friendlyError = friendlyError;
