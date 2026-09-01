'use strict';

// Additional miners (advanced). Lets the user expose extra stratum servers — each
// a user-provided IP:port — through their own public tunnel, alongside the primary
// Datum tunnel, in whichever mode is active.
//
// Each extra connection gets its own local socat bridge — exactly like the primary
// Datum path — listening on 127.0.0.1:<listen_port> and forwarding to the user's
// stratum (IP or hostname). The public tunnel then points at that loopback port:
//   playit: a tunnel under the SAME agent with local_ip 127.0.0.1, local_port=listen_port.
//           (playit self-managed agents only forward to their own loopback, so a
//           non-loopback local_ip is rejected — hence the bridge.)
//   vps:    an `-R 0.0.0.0:<remote_port>:127.0.0.1:<listen_port>` on the SSH tunnel.
//
// Status of each connection is maintained by a light polling loop that resolves the
// public endpoint (playit) and probes the target stratum for reachability.

const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const state = require('./state');
const tunnelStatus = require('./tunnel-status');
const vpsManager = require('./vps-manager');
const variant = require('./variant');

const EXTRA_TUNNEL_NAME = variant.TUNNEL_NAMES.extra;
const POLL_INTERVAL = 15000;
const PROBE_TIMEOUT = 5000;
const SOCAT_BASE_PORT = 24000; // local loopback ports for extra-connection bridges

let pollTimer = null;
let pollInFlight = false;
let pollRerun = false;
const socats = new Map(); // connection id → socat child process

function genId() {
  return 'conn-' + crypto.randomBytes(4).toString('hex');
}

// --- socat bridge management (one per extra connection) ---

function spawnSocat(conn) {
  killSocat(conn.id);
  if (!conn.listen_port || !conn.local_ip || !conn.local_port) return;
  const args = [
    `TCP-LISTEN:${conn.listen_port},bind=127.0.0.1,fork,reuseaddr`,
    `TCP:${conn.local_ip}:${conn.local_port}`,
  ];
  try {
    const proc = spawn('socat', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line) console.log(`[connections:socat ${conn.id}] ${line}`);
    });
    proc.on('exit', (code) => {
      if (socats.get(conn.id) === proc) socats.delete(conn.id);
      console.log(`[connections] socat for ${conn.id} (127.0.0.1:${conn.listen_port} → ${conn.local_ip}:${conn.local_port}) exited code ${code}`);
    });
    socats.set(conn.id, proc);
    console.log(`[connections] socat up: 127.0.0.1:${conn.listen_port} → ${conn.local_ip}:${conn.local_port}`);
  } catch (err) {
    console.error(`[connections] failed to start socat for ${conn.id}: ${err.message}`);
  }
}

function killSocat(id) {
  const p = socats.get(id);
  if (p) {
    socats.delete(id);
    try { p.kill('SIGTERM'); } catch (_) {}
    const pid = p.pid;
    setTimeout(() => { try { process.kill(pid, 'SIGKILL'); } catch (_) {} }, 5000).unref();
  }
}

// Reconcile running socats with the current connection set: start any missing,
// kill any whose connection is gone.
function syncSocats() {
  const conns = getConnections();
  const want = new Set(conns.filter((c) => c.listen_port && c.local_ip && c.local_port).map((c) => c.id));
  for (const id of [...socats.keys()]) if (!want.has(id)) killSocat(id);
  for (const c of conns) if (want.has(c.id) && !socats.has(c.id)) spawnSocat(c);
}

function killAllSocats() {
  for (const id of [...socats.keys()]) killSocat(id);
}

// Next free local loopback port for a bridge: above SOCAT_BASE_PORT and any in use.
function nextListenPort() {
  let max = SOCAT_BASE_PORT - 1;
  for (const c of getConnections()) {
    if (c.listen_port && c.listen_port > max) max = c.listen_port;
  }
  return max + 1;
}

function getConnections() {
  return state.get().extra_connections || [];
}

function saveConnections(list) {
  state.update({ extra_connections: list });
}

// Public port on the VPS for a new connection: one past the highest in use
// (primary + existing extras) so we never collide with an already-bound port.
function nextRemotePort() {
  const s = state.get();
  let max = s.vps_remote_port || 23335;
  for (const c of getConnections()) {
    if (c.remote_port && c.remote_port > max) max = c.remote_port;
  }
  return max + 1;
}

// The public endpoint a miner connects to for this connection.
function computeEndpoint(c, s) {
  if (s.tunnel_mode === 'vps') {
    return s.vps_host && c.remote_port ? `${s.vps_host}:${c.remote_port}` : null;
  }
  return c.public_endpoint || null; // playit (resolved by the poll loop)
}

// TCP-connect to the target stratum and confirm it speaks stratum (mining.subscribe).
// Returns true if reachable and responsive. Mirrors the /api/diag local check.
function probeTarget(ip, port) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; try { sock.destroy(); } catch (_) {} resolve(ok); } };
    const sock = net.createConnection({ host: ip, port }, () => {
      try {
        sock.write(JSON.stringify({ id: 1, method: 'mining.subscribe', params: ['hashgg-probe/1.0'] }) + '\n');
      } catch (_) { return finish(false); }
    });
    sock.setTimeout(PROBE_TIMEOUT);
    sock.on('data', () => finish(true));      // any response → it's listening and speaks stratum
    sock.on('timeout', () => finish(false));
    sock.on('error', () => finish(false));
  });
}

function publicView(c, s) {
  return {
    id: c.id,
    name: c.name,
    local_ip: c.local_ip,
    local_port: c.local_port,
    remote_port: c.remote_port || null,
    public_endpoint: computeEndpoint(c, s),
    status: c.status || 'pending',
    last_error: c.last_error || null,
  };
}

function list() {
  const s = state.get();
  return getConnections().map((c) => publicView(c, s));
}

// Add a new extra connection. Returns { connection, firewall_cmd? }.
async function add({ name, local_ip, local_port }) {
  const s = state.get();
  const mode = s.tunnel_mode;
  if (mode !== 'playit' && mode !== 'vps') {
    throw new Error('No tunnel is configured yet');
  }

  const conn = {
    id: genId(),
    name: name,
    local_ip: local_ip,
    local_port: local_port,
    tunnel_id: null,
    public_endpoint: null,
    remote_port: null,
    listen_port: nextListenPort(), // local loopback port for this connection's bridge
    status: 'pending',
    last_error: null,
  };

  // Start the local socat bridge first so the tunnel has something to forward to.
  spawnSocat(conn);

  let firewallCmd = null;

  if (mode === 'playit') {
    const agentId = await tunnelStatus.fetchAgentId();
    if (!agentId) { killSocat(conn.id); throw new Error('playit.gg agent not ready yet — try again in a moment'); }
    // Point the tunnel at our loopback bridge (127.0.0.1:listen_port), NOT the user's
    // IP — playit self-managed agents only forward to their own loopback.
    const created = await tunnelStatus.createTunnel(conn.listen_port, agentId, {
      name: EXTRA_TUNNEL_NAME,
      localIp: '127.0.0.1',
      isExtra: true,
    });
    const tunnelId = created?.data?.id;
    if (!tunnelId) {
      killSocat(conn.id);
      throw new Error('Could not create the tunnel (playit.gg Premium may be required)');
    }
    conn.tunnel_id = tunnelId;
  } else {
    // vps
    conn.remote_port = nextRemotePort();
    // Fixed comment — never interpolate the user-provided name into a shell string
    // the operator will paste into a root shell.
    firewallCmd = `ufw allow ${conn.remote_port}/tcp comment "HashGG additional miner"  # or: firewall-cmd --permanent --add-port=${conn.remote_port}/tcp && firewall-cmd --reload`;
  }

  const next = getConnections().slice();
  next.push(conn);
  saveConnections(next);

  // VPS: rebuild the SSH tunnel so the new -R takes effect.
  if (mode === 'vps') vpsManager.restart();

  // Kick a poll so status/endpoint refresh promptly.
  pollOnce().catch(() => {});

  return { connection: publicView(conn, state.get()), firewall_cmd: firewallCmd };
}

async function remove(id) {
  const s = state.get();
  const list = getConnections();
  const conn = list.find((c) => c.id === id);
  if (!conn) return false;

  if (s.tunnel_mode === 'playit' && conn.tunnel_id) {
    try { await tunnelStatus.deleteTunnel(conn.tunnel_id); }
    catch (err) { console.error(`[connections] delete tunnel error: ${err.message}`); }
  }

  saveConnections(list.filter((c) => c.id !== id));
  killSocat(id); // tear down this connection's bridge

  if (s.tunnel_mode === 'vps') vpsManager.restart();
  return true;
}

// Refresh endpoint (playit) + reachability for every connection.
//
// We snapshot first, do the async work (allocation lookups + probes) without
// holding a live reference, then re-read the current connections and merge the
// results by id. This avoids clobbering a connection that add()/remove() may have
// changed while our awaits were in flight.
// Coordinator: never let two passes overlap (they'd race their status writes),
// but never drop a requested refresh either. If a pass is asked for while one is
// running (e.g. add() kicks a poll mid-cycle), run exactly one more pass after.
async function pollOnce() {
  if (pollInFlight) { pollRerun = true; return; }
  pollInFlight = true;
  try {
    do {
      pollRerun = false;
      await pollPass();
    } while (pollRerun);
  } finally {
    pollInFlight = false;
  }
}

async function pollPass() {
  const s = state.get();
  const snapshot = getConnections().map((c) => ({
    id: c.id,
    tunnel_id: c.tunnel_id,
    local_ip: c.local_ip,
    local_port: c.local_port,
    public_endpoint: c.public_endpoint,
  }));
  if (!snapshot.length) return;

  // Process all connections concurrently — one slow/unreachable target must not
  // delay status updates for the others (probes can each take PROBE_TIMEOUT).
  const updates = {};
  await Promise.all(snapshot.map(async (c) => {
    // Resolve/refresh the playit public endpoint. Re-fetch every cycle (not just
    // when unset) so a reallocated address doesn't leave a stale endpoint cached;
    // a transient null is ignored below and keeps the previous value.
    let endpoint = c.public_endpoint;
    if (s.tunnel_mode === 'playit' && c.tunnel_id) {
      const alloc = await tunnelStatus.fetchTunnelAllocation(c.tunnel_id);
      if (alloc && alloc.port && (alloc.domain || alloc.ip)) {
        endpoint = `${alloc.domain || alloc.ip}:${alloc.port}`;
      }
    }

    let status, lastError = null;
    if (s.tunnel_mode === 'vps' && s.vps_tunnel_status === 'error') {
      // The shared SSH tunnel is down — every connection is affected.
      status = 'error';
      lastError = s.vps_last_error || 'SSH tunnel error';
    } else {
      const tunnelUp = s.tunnel_mode === 'vps'
        ? s.vps_tunnel_status === 'connected'
        : !!endpoint;
      if (!tunnelUp) {
        status = 'pending';
      } else {
        const ok = await probeTarget(c.local_ip, c.local_port);
        if (ok) {
          status = 'active';
        } else {
          status = 'unreachable';
          lastError = `Can't reach stratum at ${c.local_ip}:${c.local_port}`;
        }
      }
    }

    updates[c.id] = { endpoint, status, lastError };
  }));

  // Merge results into the CURRENT array (which may differ from the snapshot).
  const cur = getConnections();
  let changed = false;
  for (const c of cur) {
    const u = updates[c.id];
    if (!u) continue; // added after we snapshotted — leave for next round
    if (u.endpoint && c.public_endpoint !== u.endpoint) { c.public_endpoint = u.endpoint; changed = true; }
    if (c.status !== u.status) { c.status = u.status; changed = true; }
    if (c.last_error !== u.lastError) { c.last_error = u.lastError; changed = true; }
  }
  if (changed) saveConnections(cur);
}

function startPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  // (Re)establish the socat bridges for any connections restored from state on boot.
  syncSocats();
  const loop = async () => {
    try { await pollOnce(); }
    catch (err) { console.error(`[connections] poll error: ${err.message}`); }
    pollTimer = setTimeout(loop, POLL_INTERVAL);
  };
  loop();
}

// Stop polling and tear down all bridges (shutdown / reset). On reset the
// connection list is already cleared, so nothing respawns.
function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  killAllSocats();
}

module.exports = { list, add, remove, startPolling, stopPolling };
