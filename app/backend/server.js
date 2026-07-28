'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const state = require('./state');
const playitManager = require('./playit-manager');
const claimFlow = require('./claim-flow');
const tunnelStatus = require('./tunnel-status');
const playitCleanup = require('./playit-cleanup');
const connections = require('./connections');
const vpsManager = require('./vps-manager');
const sshKeygenHelper = require('./ssh-keygen-helper');
const bitcoinP2p = require('./bitcoin-p2p');
const btcP2pManager = require('./btc-p2p-manager');
const bitcoinRpc = require('./bitcoin-rpc');
const startosBlocks = require('./startos-blocks');
const startunnelPayload = require('./starttunnel-payload');
const starttunnelRemote = require('./starttunnel-remote');

const PORT = 3000;
const FRONTEND_DIR = '/usr/local/lib/hashgg/frontend';
const CONFIG_FILE = '/root/start9/config.yaml';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Read config for the stratum port. Precedence: DATUM_STRATUM_PORT env var
// (plain Docker use), then StartOS config.yaml, then default 23335.
function getStratumPort() {
  if (process.env.DATUM_STRATUM_PORT) {
    const p = parseInt(process.env.DATUM_STRATUM_PORT, 10);
    if (p) return p;
  }
  try {
    const { execSync } = require('child_process');
    const port = execSync(`yq e '.advanced.datum_stratum_port // 23335' ${CONFIG_FILE}`, { encoding: 'utf8', timeout: 5000 }).trim();
    return parseInt(port, 10) || 23335;
  } catch {
    return 23335;
  }
}

// The LOCAL port the tunnel (playit/ssh) must forward to — i.e. where socat is
// listening (set by the entrypoint's LISTEN_PORT). This is NOT the Datum stratum
// port: on StartOS 0.4.0 they differ (socat 23335 → Datum 23334). Mirrors the VPS
// manager's LOCAL_STRATUM_PORT so both tunnel paths target the same local port.
function getListenPort() {
  const p = parseInt(process.env.LISTEN_PORT || process.env.DATUM_STRATUM_PORT, 10);
  if (p) return p;
  return getStratumPort();
}

// Which platform are we on, and what can the clearnet-inbound feature do here?
//
//   full        — HashGG runs the tunnel and the user can set externalip
//                 (Umbrel's Bitcoin app has a free-form config field; plain
//                 Docker users own bitcoin.conf outright)
//   guided      — StartOS 0.4.0. externalip is derived from addresses published
//                 on the Peer interface, which must belong to a registered
//                 gateway, so an arbitrary tunnel address cannot be advertised.
//                 StartOS does this natively via StartTunnel; we guide, not tunnel.
//   unavailable — StartOS 0.3.5.1. bitcoin.conf is regenerated from a template on
//                 every start and -externalip is hard-wired to the onion address,
//                 so nothing we build could ever be advertised.
function detectPlatform() {
  const explicit = (process.env.HASHGG_PLATFORM || '').trim();
  if (explicit) return explicit;
  // Inference fallback for installs that predate the env var.
  const datumHost = process.env.DATUM_HOST || '';
  // `.startos` is only ever set explicitly by the 0.4.0 package, so it is proof.
  if (datumHost.endsWith('.startos')) return 'startos-0.4';
  // `.embassy` is NOT proof: `datum.embassy` is the entrypoint's default, so it
  // is what a plain `docker run` with no DATUM_HOST gets. Keying off it would
  // classify every such install as 0.3.5.1 and withdraw the feature from a
  // platform that fully supports it. The StartOS config file is the real
  // marker — verified present on a live 0.3.5.1 install.
  if (fs.existsSync(CONFIG_FILE)) return 'startos-0.3';
  return 'docker';
}

// Host validation, in one place. These values reach an `ssh` argv AND are
// rendered into text the user copies into their node's configuration, so a
// newline here would let extra directives ride along. Both uses need it, which
// is why it is not phrased as "because it reaches a shell".
//
// EVERY point that accepts a host must go through this rather than re-spelling
// the charset test inline. Hand-rolled copies drifted once already: they caught
// the charset but not link-local/multicast, so an address this function rejects
// at render time could still be stored and dialled.
function isValidHost(h) {
  return typeof h === 'string' && h.length > 0 && h.length <= 255
      && h[0] !== '-' && /^[a-zA-Z0-9.\-:]+$/.test(h)
      && !bitcoinP2p.isForbiddenAddress(h);
}

// Crude per-endpoint throttle. These endpoints dial arbitrary hosts on behalf of
// the caller, and the dashboard has no authentication — it is safe only because
// StartOS, Umbrel's app_proxy and the loopback-only Docker binding keep it off
// the network. If that ever changes, these need real auth, not just a throttle.
const rateBuckets = Object.create(null);
function rateLimited(key, maxPerMinute) {
  const now = Date.now();
  const b = rateBuckets[key] || (rateBuckets[key] = []);
  while (b.length && now - b[0] > 60000) b.shift();
  if (b.length >= maxPerMinute) return true;
  b.push(now);
  return false;
}

function platformCapability(platform) {
  switch (platform) {
    case 'startos-0.4': return 'guided';
    case 'startos-0.3': return 'unavailable';
    default: return 'full';   // umbrel, docker
  }
}

// Serve static files
function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  // Prevent directory traversal
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(FRONTEND_DIR, filePath);

  // Verify the resolved path is within FRONTEND_DIR
  if (!fullPath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// Parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 10) { // 10KB limit
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      if (!body) { resolve({}); return; }
      try {
        const parsed = JSON.parse(body);
        // Guard against non-object JSON (e.g. `null`, `123`, `"x"`) so handlers
        // that read body.foo get a 400, not a TypeError → opaque 500.
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// API route handlers
async function handleApi(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  // GET /api/status
  if (pathname === '/api/status' && req.method === 'GET') {
    const s = state.get();
    sendJson(res, 200, {
      agent_status: s.agent_status,
      public_endpoint: s.public_endpoint,
      tunnel_id: s.tunnel_id,
      claim_status: s.claim_status,
      has_secret: !!s.playit_secret,
      uptime: playitManager.getUptime(),
    });
    return;
  }

  // POST /api/claim/start
  if (pathname === '/api/claim/start' && req.method === 'POST') {
    const result = await claimFlow.startClaim();
    sendJson(res, 200, result);
    return;
  }

  // GET /api/claim/status
  if (pathname === '/api/claim/status' && req.method === 'GET') {
    sendJson(res, 200, claimFlow.getClaimStatus());
    return;
  }

  // POST /api/secret
  if (pathname === '/api/secret' && req.method === 'POST') {
    const body = await parseBody(req);
    const key = body.secret_key;

    if (!key || typeof key !== 'string') {
      sendJson(res, 400, { error: 'secret_key is required' });
      return;
    }

    // Validate hex string
    if (!/^[0-9a-fA-F]+$/.test(key)) {
      sendJson(res, 400, { error: 'secret_key must be a hex string' });
      return;
    }

    state.update({
      playit_secret: key,
      claim_status: 'completed',
      claim_code: null,
    });

    // Start the agent with the new key. The tunnel must forward to socat's local
    // port (LISTEN_PORT), not the Datum port — these differ on StartOS 0.4.0.
    playitManager.restart();
    tunnelStatus.startPolling(getListenPort());

    sendJson(res, 200, { ok: true });
    return;
  }

  // POST /api/restart
  if (pathname === '/api/restart' && req.method === 'POST') {
    playitManager.restart();
    sendJson(res, 200, { ok: true });
    return;
  }

  // POST /api/reset
  if (pathname === '/api/reset' && req.method === 'POST') {
    playitManager.stop();
    vpsManager.stop(); // defensive — in case state had leftover VPS data
    // Capture the cleanup reminder before state.reset() destroys the fields that
    // describe it — the user still has to remove the line from their node.
    const sBefore = state.get();
    const btcCleanup = sBefore.btc_p2p_acked && sBefore.btc_p2p_advertised_for_host
      ? { externalip_line: `externalip=${sBefore.btc_p2p_advertised_for_host}:${sBefore.btc_p2p_advertised_port || 8333}` }
      : null;
    btcP2pManager.stop();
    tunnelStatus.stopPolling();
    connections.stopPolling();
    // Delete additional-miner tunnels from the playit account so they don't leak
    // quota (we still hold the secret here; after reset we won't).
    for (const c of (state.get().extra_connections || [])) {
      if (c.tunnel_id) { try { await tunnelStatus.deleteTunnel(c.tunnel_id); } catch (_) {} }
    }
    // Clean up any VPS artifacts too (defensive — in case state had leftover VPS data)
    try { require('fs').unlinkSync('/root/data/vps_ssh_key'); } catch (_) {}
    try { require('fs').unlinkSync('/root/data/vps_known_hosts'); } catch (_) {}
    try { require('fs').unlinkSync('/root/data/btc_p2p_ssh_key'); } catch (_) {}
    try { require('fs').unlinkSync('/root/data/btc_p2p_known_hosts'); } catch (_) {}
    state.reset();
    sendJson(res, 200, { ok: true, btc_cleanup: btcCleanup });
    return;
  }

  // --- Bitcoin P2P clearnet inbound ---

  // GET /api/btc/status — platform capability + what node we can see.
  // Detection is cached in bitcoin-p2p.js, so this is cheap enough for the
  // dashboard's 3 s poll.
  if (pathname === '/api/btc/status' && req.method === 'GET') {
    const s = state.get();
    const platform = detectPlatform();
    const override = s.btc_p2p_target_host
      ? { host: s.btc_p2p_target_host, port: s.btc_p2p_target_port }
      : null;

    let detected = null;
    let detectError = null;
    let detecting = false;
    try {
      const r = await bitcoinP2p.detectLocalNode({ override });
      if (r.ok) {
        detected = { host: r.host, port: r.port, user_agent: r.user_agent,
                     protocol_version: r.protocol_version, start_height: r.start_height,
                     source: r.source };
      } else {
        // Distinguish "nothing there" from "something is there but we can't
        // reach it". A timeout means packets are being dropped — on a Linux
        // host running Docker that is almost always the host firewall, which
        // only has a rule for the stratum port. "No node found" would send the
        // user looking in entirely the wrong place.
        // Still sweeping — a transient state, not a failure. Reported separately
        // so the UI can say "checking…" instead of showing an error.
        if (r.pending) {
          detectError = null;
          detecting = true;
        } else detectError = /timed out/.test(r.error || '')
          ? `${r.error} — if your node is running, the host firewall is probably ` +
            `blocking the Docker bridge. It needs a rule for the Bitcoin P2P port, ` +
            `the same way the stratum port has one.`
          : r.error;
      }
    } catch (err) {
      console.error(`[btc] detection error: ${err.message}`);
      detectError = err.message;
    }

    // The advertisement half — the only thing that tells the user their config
    // line actually took effect. Umbrel-only, and strictly best-effort: any
    // failure leaves these null and the feature falls back to the
    // handshake-only story rather than reporting a problem.
    let advertising = null;
    let inboundPeers = null;
    if (s.btc_p2p_enabled && s.btc_p2p_vps_host && bitcoinRpc.isAvailable()) {
      try {
        advertising = await bitcoinRpc.isAdvertising(
          s.btc_p2p_vps_host, s.btc_p2p_remote_port || 8333);
      } catch (err) {
        console.log(`[btc] advertisement check unavailable: ${err.message}`);
      }
      try {
        inboundPeers = await bitcoinRpc.getInboundPeerCount();
      } catch (_) { /* best-effort */ }
    }

    sendJson(res, 200, {
      platform,
      capability: platformCapability(platform),
      detected,
      detect_error: detectError,
      detecting,
      enabled: !!s.btc_p2p_enabled,
      remote_port: s.btc_p2p_remote_port || 8333,
      tunnel_status: s.btc_p2p_tunnel_status || 'disconnected',
      last_error: s.btc_p2p_last_error || null,
      port_suggestion: s.btc_p2p_port_suggestion || null,
      vps_host: s.btc_p2p_vps_host || null,
      vps_source: s.btc_p2p_vps_source || null,
      // The stratum VPS, offered as a one-click shortcut. Only the address —
      // enough to label the button, nothing the UI does not need.
      stratum_vps_host: s.vps_host || null,
      // Where the node's configuration file is, when whatever started HashGG
      // knew. Turns "add this to your bitcoin.conf" into a specific file.
      bitcoin_conf: process.env.BITCOIN_CONF || null,
      // Re-validated at render: this string is copied into the user's node
      // configuration, and a stored value could predate a validation change.
      public_endpoint: (s.btc_p2p_vps_host && s.btc_p2p_enabled && isValidHost(s.btc_p2p_vps_host))
        ? `${s.btc_p2p_vps_host}:${s.btc_p2p_remote_port || 8333}` : null,
      acked: !!s.btc_p2p_acked,
      // True once the user has acked a config line that no longer matches what
      // we'd advertise — i.e. the line sitting in their node is now stale. The
      // PORT counts as much as the host: changing the public port under
      // Advanced invalidates the pasted line just as completely.
      advertised_stale: !!(s.btc_p2p_acked && s.btc_p2p_advertised_for_host
        && (s.btc_p2p_advertised_for_host !== s.btc_p2p_vps_host
            || (s.btc_p2p_advertised_port || 8333) !== (s.btc_p2p_remote_port || 8333))),
      verified_at: s.btc_p2p_verified_at || null,
      verified_agent: s.btc_p2p_verified_agent || null,
      // Not gated on `enabled`: on the StartOS guided path HashGG owns no
      // tunnel, so `enabled` stays false and this is the only record that the
      // flow completed. Without it a returning user sees no sign of success.
      verified_endpoint: (s.btc_p2p_verified_at && s.btc_p2p_vps_host
        && isValidHost(s.btc_p2p_vps_host))
        ? `${s.btc_p2p_vps_host}:${s.btc_p2p_remote_port || 8333}` : null,
      // RPC-derived. null means "unknown" — the UI must never render it as
      // "no", because on every platform but Umbrel we simply cannot see this.
      advertising,
      inbound_peers: inboundPeers,
    });
    return;
  }

  // POST /api/btc/enable — { remote_port?, target_host?, target_port?, vps_host? }
  if (pathname === '/api/btc/enable' && req.method === 'POST') {
    // This dials an arbitrary host (detection) and spawns ssh at one. Same
    // reasoning as verify/test-connection: the UI is unauthenticated, and is
    // safe only because the platforms keep it off the network.
    if (rateLimited('btc-enable', 6)) {
      sendJson(res, 429, { error: 'Too many attempts — wait a moment.' });
      return;
    }
    const body = await parseBody(req);
    const s = state.get();
    const patch = {};

    if (platformCapability(detectPlatform()) !== 'full') {
      sendJson(res, 400, { error: 'This platform uses a different path — see the dashboard for guidance.' });
      return;
    }

    if (body.remote_port !== undefined) {
      const p = Number(body.remote_port);
      if (isNaN(p) || p < 1024 || p > 65535) {
        sendJson(res, 400, { error: 'Port must be 1024–65535' });
        return;
      }
      patch.btc_p2p_remote_port = p;
    }

    // Manual override — "my Bitcoin node is somewhere else".
    if (body.target_host !== undefined) {
      const h = (body.target_host || '').toString().trim();
      if (h) {
        // Same idiom as /api/vps/configure: these values reach an ssh argv, and
        // the host is also rendered into copyable config text, so a newline here
        // would let extra bitcoin.conf directives ride along.
        if (!isValidHost(h)) {
          sendJson(res, 400, { error: 'Please enter a valid node address' });
          return;
        }
        const tp = Number(body.target_port);
        if (isNaN(tp) || tp < 1 || tp > 65535) {
          sendJson(res, 400, { error: 'Node port must be 1–65535' });
          return;
        }
        try { bitcoinP2p.assertAllowedTarget(h, tp); }
        catch (err) { sendJson(res, 400, { error: err.message }); return; }
        patch.btc_p2p_target_host = h;
        patch.btc_p2p_target_port = tp;
      } else {
        patch.btc_p2p_target_host = null;
        patch.btc_p2p_target_port = null;
      }
    }

    // Which VPS carries this. Defaults to the stratum VPS when there is one —
    // the "use my existing HashGG VPS" shortcut. A dedicated P2P VPS gets its
    // own onboarding; until then an explicit vps_host is accepted.
    let vpsHost = body.vps_host !== undefined ? (body.vps_host || '').toString().trim() : null;
    if (vpsHost) {
      if (!isValidHost(vpsHost)) {
        sendJson(res, 400, { error: 'Please enter a valid VPS address' });
        return;
      }
      patch.btc_p2p_vps_host = vpsHost;
      patch.btc_p2p_vps_source = 'own';
    } else if (!s.btc_p2p_vps_host) {
      if (!s.vps_host) {
        sendJson(res, 400, { error: 'No VPS available yet. Set one up first.' });
        return;
      }
      // Resolve and STORE it, rather than reading vps_host later — a stratum
      // reset or a mode switch must not be able to orphan this tunnel.
      patch.btc_p2p_vps_host = s.vps_host;
      patch.btc_p2p_vps_ssh_port = s.vps_ssh_port || 22;
      patch.btc_p2p_vps_ssh_user = s.vps_ssh_user || 'hashgg';
      patch.btc_p2p_vps_source = 'shared';
    }

    // Take our own copy of the key. One keypair is minted for the machine, but
    // this record must not depend on the stratum record's copy — /api/vps/reset
    // nulls that, which would leave this tunnel unable to reconnect.
    const merged = { ...s, ...patch };
    if (!merged.btc_p2p_vps_private_key) {
      let key = merged.vps_ssh_private_key;
      let pub = merged.vps_ssh_public_key;
      if (!key) {
        // playit-mode install that has never set up a VPS — mint the keypair now.
        const kp = sshKeygenHelper.generateKeyPair();
        state.update({ vps_ssh_private_key: kp.privateKeyPem, vps_ssh_public_key: kp.publicKeyOpenSSH });
        key = kp.privateKeyPem;
        pub = kp.publicKeyOpenSSH;
      }
      patch.btc_p2p_vps_private_key = key;
      patch.btc_p2p_vps_public_key = pub || null;
    }

    // A past verification proves a specific host:port answered. Change either
    // and it proves nothing, so drop it rather than leave a ✓ next to an
    // endpoint that was never tested.
    const merged2 = { ...s, ...patch };
    if (s.btc_p2p_verified_at
        && (merged2.btc_p2p_vps_host !== s.btc_p2p_vps_host
            || merged2.btc_p2p_remote_port !== s.btc_p2p_remote_port)) {
      patch.btc_p2p_verified_at = null;
      patch.btc_p2p_verified_agent = null;
    }

    // Snapshot exactly what this request is about to change, so a failure can
    // put it back. This endpoint doubles as "apply new settings", and applying a
    // bad setting to a LIVE tunnel must not leave the two out of step: the ssh
    // process keeps running with the old config regardless (resolveTarget throws
    // before anything is torn down), so forcing enabled=false here would show
    // "off" in the UI while the VPS is still forwarding to the node.
    const wasEnabled = !!s.btc_p2p_enabled;
    const rollback = {};
    for (const k of Object.keys(patch)) rollback[k] = s[k];

    if (Object.keys(patch).length) state.update(patch);

    try {
      await btcP2pManager.enable();
      sendJson(res, 200, { ok: true });
    } catch (err) {
      if (wasEnabled) {
        // Was running and still is. Put the settings back so what we display
        // matches what the tunnel is actually doing.
        state.update({ ...rollback, btc_p2p_enabled: true });
      } else {
        state.update({ btc_p2p_enabled: false });
      }
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // GET /api/datum/status — is Datum answering?
  //
  // The dashboard used to assert this was true without checking, which is
  // harmless while mining is configured (a broken Datum shows up elsewhere) but
  // not for a reachability-only user, for whom this row is the only thing on
  // screen saying the mining half is healthy. Actually look.
  if (pathname === '/api/datum/status' && req.method === 'GET') {
    const net = require('net');
    const host = process.env.DATUM_HOST || 'datum.embassy';
    const port = parseInt(process.env.DATUM_REMOTE_PORT, 10) || 23335;
    const reachable = await new Promise((resolve) => {
      const sock = net.createConnection({ host, port });
      const done = (v) => { try { sock.destroy(); } catch (_) {} resolve(v); };
      sock.setTimeout(3000);
      sock.on('connect', () => done(true));
      sock.on('timeout', () => done(false));
      sock.on('error', () => done(false));
    });
    sendJson(res, 200, { reachable, host, port });
    return;
  }

  // POST /api/vps/use-suggested-port — one click out of a port collision.
  //
  // The alternative was telling the user to "pick a different port", which is
  // not an instruction someone can follow without knowing which ports are free.
  if (pathname === '/api/vps/use-suggested-port' && req.method === 'POST') {
    const s = state.get();
    const port = s.vps_port_suggestion;
    if (!port) { sendJson(res, 400, { error: 'No suggestion available.' }); return; }
    state.update({ vps_remote_port: port, vps_port_suggestion: null, vps_last_error: null });
    vpsManager.restart();
    sendJson(res, 200, { ok: true, port });
    return;
  }

  // POST /api/btc/use-suggested-port — the same, for the node tunnel.
  if (pathname === '/api/btc/use-suggested-port' && req.method === 'POST') {
    const s = state.get();
    const port = s.btc_p2p_port_suggestion;
    if (!port) { sendJson(res, 400, { error: 'No suggestion available.' }); return; }
    state.update({ btc_p2p_remote_port: port, btc_p2p_port_suggestion: null, btc_p2p_last_error: null });
    btcP2pManager.enable().catch((err) =>
      console.error(`[btc-p2p] retry on new port failed: ${err.message}`));
    sendJson(res, 200, { ok: true, port });
    return;
  }

  // POST /api/btc/disable
  if (pathname === '/api/btc/disable' && req.method === 'POST') {
    btcP2pManager.disable();
    const s = state.get();
    sendJson(res, 200, {
      ok: true,
      // The user has to undo the half we cannot: the line in their node's config.
      cleanup: {
        // The line as PASTED, not as currently configured — the user has to
        // find and delete that exact text, and it may predate a port change.
        externalip_line: s.btc_p2p_advertised_for_host
          ? `externalip=${s.btc_p2p_advertised_for_host}:${s.btc_p2p_advertised_port || 8333}`
          : null,
        remote_port: s.btc_p2p_remote_port || 8333,
      },
    });
    return;
  }

  // POST /api/btc/ack — the user says they've pasted the config line
  if (pathname === '/api/btc/ack' && req.method === 'POST') {
    const s = state.get();
    state.update({
      btc_p2p_acked: true,
      btc_p2p_advertised_for_host: s.btc_p2p_vps_host || null,
      btc_p2p_advertised_port: s.btc_p2p_remote_port || 8333,
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  // POST /api/btc/verify — dial our own public endpoint from the internet side
  if (pathname === '/api/btc/verify' && req.method === 'POST') {
    if (rateLimited('verify', 6)) { sendJson(res, 429, { error: 'Too many checks — wait a moment.' }); return; }
    const r = await btcP2pManager.verify();
    sendJson(res, 200, r);
    return;
  }

  // --- StartOS 0.4.0 guided setup ---
  //
  // HashGG generates; the user pastes. It never touches either machine, which
  // keeps the privilege story the same as the stratum onboarding.

  // GET /api/btc/startos/block-a — the block that gives HashGG a way in
  if (pathname === '/api/btc/startos/block-a' && req.method === 'GET') {
    let s = state.get();
    if (!s.vps_ssh_public_key || !s.vps_ssh_private_key) {
      const kp = sshKeygenHelper.generateKeyPair();
      state.update({ vps_ssh_private_key: kp.privateKeyPem, vps_ssh_public_key: kp.publicKeyOpenSSH });
      s = state.get();
    }
    try {
      sendJson(res, 200, { script: startunnelPayload.buildBlockA(s.vps_ssh_public_key) });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // GET /api/btc/startos/block-replace — disconnect a previously-set-up VPS
  if (pathname === '/api/btc/startos/block-replace' && req.method === 'GET') {
    sendJson(res, 200, { script: startosBlocks.buildReplaceBlock() });
    return;
  }

  // POST /api/btc/startos/setup — HashGG runs the setup on the VPS itself
  if (pathname === '/api/btc/startos/setup' && req.method === 'POST') {
    if (rateLimited('btc-setup', 6)) {
      sendJson(res, 429, { error: 'Too many attempts — wait a moment.' });
      return;
    }
    const body = await parseBody(req);
    const host = (body.host || '').toString().trim();
    if (!isValidHost(host)) {
      sendJson(res, 400, { error: 'Please enter a valid VPS address' });
      return;
    }
    let s = state.get();
    if (!s.vps_ssh_private_key) {
      const kp = sshKeygenHelper.generateKeyPair();
      state.update({ vps_ssh_private_key: kp.privateKeyPem, vps_ssh_public_key: kp.publicKeyOpenSSH });
      s = state.get();
    }
    // Remember it now: cleanup and verification both need it, and the user
    // should not have to type it twice if they come back later.
    state.update({ btc_p2p_vps_host: host, btc_p2p_vps_source: 'startos' });
    const r = starttunnelRemote.start(host, s.vps_ssh_private_key);
    sendJson(res, r.ok ? 200 : 409, r);
    return;
  }

  // GET /api/btc/startos/setup-status — progress for the run above
  if (pathname === '/api/btc/startos/setup-status' && req.method === 'GET') {
    const st = starttunnelRemote.state();
    let script = null;
    if (st.state === 'done' && st.config) {
      const v = startosBlocks.validateWireGuardConfig(st.config);
      if (v.ok && (!v.vpsHost || isValidHost(v.vpsHost))) {
        script = startosBlocks.buildBlockB(v.config, v.vpsHost || st.host);
      }
    }
    sendJson(res, 200, { ...st, config: undefined, script });
    return;
  }

  // POST /api/btc/startos/cleanup — take HashGG's access back off the VPS
  if (pathname === '/api/btc/startos/cleanup' && req.method === 'POST') {
    const s = state.get();
    if (!s.btc_p2p_vps_host || !s.vps_ssh_private_key) {
      sendJson(res, 400, { error: 'Nothing to clean up.' });
      return;
    }
    const r = await starttunnelRemote.cleanup(s.btc_p2p_vps_host, s.vps_ssh_private_key);
    if (r.ok) starttunnelRemote.reset();
    sendJson(res, 200, r);
    return;
  }

  // POST /api/btc/startos/block-b — { wg_config } -> the StartOS commands
  if (pathname === '/api/btc/startos/block-b' && req.method === 'POST') {
    const body = await parseBody(req);
    const v = startosBlocks.validateWireGuardConfig(body.wg_config);
    if (!v.ok) { sendJson(res, 400, { error: v.error }); return; }
    // Remember the VPS address so the verify step can pre-fill it.
    // The endpoint host comes out of user-pasted text, so it goes through the
    // same validator as any other host rather than being trusted because the
    // surrounding config parsed.
    if (v.vpsHost && !isValidHost(v.vpsHost)) {
      sendJson(res, 400, { error: 'The Endpoint address in that configuration is not valid.' });
      return;
    }
    if (v.vpsHost) state.update({ btc_p2p_vps_host: v.vpsHost, btc_p2p_vps_source: 'startos' });
    sendJson(res, 200, { script: startosBlocks.buildBlockB(v.config, v.vpsHost), vps_host: v.vpsHost });
    return;
  }

  // POST /api/btc/startos/verify — { line } from the block's output
  if (pathname === '/api/btc/startos/verify' && req.method === 'POST') {
    if (rateLimited('verify', 6)) { sendJson(res, 429, { error: 'Too many checks — wait a moment.' }); return; }
    const body = await parseBody(req);
    const p = startosBlocks.parseVerifyLine(body.line);
    if (!p.ok) { sendJson(res, 400, { error: p.error }); return; }
    // Compare against the node we can see locally, the same as the Umbrel path.
    // Detection works on 0.4.0 (bitcoind.startos), and the risk is identical:
    // the pasted line could name an address something else is answering on.
    let expect = null;
    try {
      const local = await bitcoinP2p.detectLocalNode({});
      if (local.ok) expect = local;
    } catch (_) { /* best-effort — never block verification on it */ }

    const r = await bitcoinP2p.verifyPublic(p.host, p.port, expect);
    if (r.ok && !r.warning) {
      state.update({
        btc_p2p_vps_host: p.host,
        btc_p2p_remote_port: p.port,
        btc_p2p_verified_at: new Date().toISOString(),
        btc_p2p_verified_agent: r.user_agent || null,
      });
    }
    sendJson(res, 200, { ...r, host: p.host, port: p.port });
    return;
  }

  // --- The P2P tunnel's own VPS record ---
  //
  // Separate routes rather than a `scope` parameter on /api/vps/*: putting the
  // mining path one bad branch away from breakage is not worth the saved lines.

  // POST /api/btc/vps/configure — { host, ssh_port?, ssh_user?, source }
  if (pathname === '/api/btc/vps/configure' && req.method === 'POST') {
    const body = await parseBody(req);
    const s = state.get();
    const patch = {};

    if (body.source === 'shared') {
      if (!s.vps_host) {
        sendJson(res, 400, { error: 'You do not have a HashGG VPS set up yet.' });
        return;
      }
      // Copy, never reference: a later stratum reset must not orphan this.
      patch.btc_p2p_vps_host = s.vps_host;
      patch.btc_p2p_vps_ssh_port = s.vps_ssh_port || 22;
      patch.btc_p2p_vps_ssh_user = s.vps_ssh_user || 'hashgg';
      patch.btc_p2p_vps_source = 'shared';
    } else {
      const host = (body.host || '').toString().trim();
      if (!isValidHost(host)) {
        sendJson(res, 400, { error: 'Please enter a valid VPS address' });
        return;
      }
      const sshPort = body.ssh_port !== undefined ? Number(body.ssh_port) : 22;
      if (isNaN(sshPort) || sshPort < 1 || sshPort > 65535) {
        sendJson(res, 400, { error: 'SSH port must be 1–65535' });
        return;
      }
      const sshUser = body.ssh_user !== undefined ? String(body.ssh_user) : 'hashgg';
      if (!/^[a-z_][a-z0-9_\-]{0,31}$/.test(sshUser)) {
        sendJson(res, 400, { error: 'Invalid SSH user' });
        return;
      }
      patch.btc_p2p_vps_host = host;
      patch.btc_p2p_vps_ssh_port = sshPort;
      patch.btc_p2p_vps_ssh_user = sshUser;
      patch.btc_p2p_vps_source = 'own';
    }

    // Make sure a keypair exists and this record owns a copy of it. Prefer the
    // copy we already hold: after /api/vps/reset the stratum key is null, and
    // minting a fresh one here would replace a key the P2P VPS's authorized_keys
    // already trusts — breaking a tunnel the user did not ask us to touch.
    let key = s.btc_p2p_vps_private_key || s.vps_ssh_private_key;
    let pub = (s.btc_p2p_vps_private_key ? s.btc_p2p_vps_public_key : s.vps_ssh_public_key);
    if (!key) {
      const kp = sshKeygenHelper.generateKeyPair();
      state.update({ vps_ssh_private_key: kp.privateKeyPem, vps_ssh_public_key: kp.publicKeyOpenSSH });
      key = kp.privateKeyPem;
      pub = kp.publicKeyOpenSSH;
    }
    patch.btc_p2p_vps_private_key = key;
    patch.btc_p2p_vps_public_key = pub || null;

    // Pointing at a different machine invalidates any past verification.
    if (s.btc_p2p_verified_at && patch.btc_p2p_vps_host !== s.btc_p2p_vps_host) {
      patch.btc_p2p_verified_at = null;
      patch.btc_p2p_verified_agent = null;
    }

    state.update(patch);

    // Rebuild if this moved a live tunnel to a different host — otherwise it
    // keeps forwarding from the old VPS while the UI shows the new one.
    if (s.btc_p2p_enabled && patch.btc_p2p_vps_host !== s.btc_p2p_vps_host) {
      btcP2pManager.enable().catch((err) =>
        console.error(`[btc-p2p] reconfigure failed: ${err.message}`));
    }

    sendJson(res, 200, { ok: true, host: patch.btc_p2p_vps_host, source: patch.btc_p2p_vps_source });
    return;
  }

  // GET /api/btc/vps/setup-script — for the P2P VPS specifically
  if (pathname === '/api/btc/vps/setup-script' && req.method === 'GET') {
    let s = state.get();
    // The script must install the key THIS tunnel authenticates with. After
    // /api/vps/reset the stratum keypair is gone, so falling back to it would
    // mint a fresh one and hand the user a script that installs a key the P2P
    // tunnel does not hold — re-running it could then never fix the
    // "Permission denied (publickey)" it was meant to fix.
    if (!s.btc_p2p_vps_public_key && !s.vps_ssh_public_key) {
      const kp = sshKeygenHelper.generateKeyPair();
      state.update({
        vps_ssh_private_key: kp.privateKeyPem, vps_ssh_public_key: kp.publicKeyOpenSSH,
        btc_p2p_vps_private_key: kp.privateKeyPem, btc_p2p_vps_public_key: kp.publicKeyOpenSSH,
      });
      s = state.get();
    }
    const btcPorts = [s.btc_p2p_remote_port || 8333];
    if (s.vps_host && s.vps_host === s.btc_p2p_vps_host) {
      const sp = s.vps_remote_port || 23335;
      if (!btcPorts.includes(sp)) btcPorts.push(sp);
      for (const c of (s.extra_connections || [])) {
        if (c.remote_port && !btcPorts.includes(c.remote_port)) btcPorts.push(c.remote_port);
      }
    }
    const script = buildSetupScript(
      s.btc_p2p_vps_public_key || s.vps_ssh_public_key,
      btcPorts,
      s.btc_p2p_vps_host
    );
    sendJson(res, 200, { script, host: s.btc_p2p_vps_host || null });
    return;
  }

  // GET /api/btc/vps/teardown-script
  if (pathname === '/api/btc/vps/teardown-script' && req.method === 'GET') {
    const s = state.get();
    // Compare the resolved hosts rather than trusting `source`: someone can
    // reach the same machine by typing its address under "a different VPS".
    const shared = !!(s.btc_p2p_vps_host && s.vps_host && s.btc_p2p_vps_host === s.vps_host);
    sendJson(res, 200, {
      script: buildTeardownScript([s.btc_p2p_remote_port || 8333], s.btc_p2p_vps_host, shared,
        s.btc_p2p_vps_public_key || s.vps_ssh_public_key),
      host: s.btc_p2p_vps_host || null,
      shared_with_stratum: shared,
    });
    return;
  }

  // POST /api/btc/vps/test-connection
  if (pathname === '/api/btc/vps/test-connection' && req.method === 'POST') {
    if (rateLimited('btc-test', 6)) { sendJson(res, 429, { error: 'Too many attempts — wait a moment.' }); return; }
    const s = state.get();
    if (!s.btc_p2p_vps_host) {
      sendJson(res, 400, { error: 'No VPS configured yet' });
      return;
    }
    // Reuse the stratum SSH auth probe against this record's values.
    const result = await testVpsSshAuth({
      vps_host: s.btc_p2p_vps_host,
      vps_ssh_port: s.btc_p2p_vps_ssh_port || 22,
      vps_ssh_user: s.btc_p2p_vps_ssh_user || 'hashgg',
      vps_ssh_private_key: s.btc_p2p_vps_private_key || s.vps_ssh_private_key,
    });
    sendJson(res, 200, result);
    return;
  }

  // POST /api/btc/vps/reset — clears THIS record only, never the stratum one
  if (pathname === '/api/btc/vps/reset' && req.method === 'POST') {
    btcP2pManager.stop();
    try { require('fs').unlinkSync('/root/data/btc_p2p_ssh_key'); } catch (_) {}
    try { require('fs').unlinkSync('/root/data/btc_p2p_known_hosts'); } catch (_) {}
    const s = state.get();
    const cleanup = s.btc_p2p_acked && s.btc_p2p_advertised_for_host
      ? { externalip_line: `externalip=${s.btc_p2p_advertised_for_host}:${s.btc_p2p_advertised_port || 8333}` }
      : null;
    state.update({
      btc_p2p_enabled: false,
      btc_p2p_vps_host: null,
      btc_p2p_vps_ssh_port: 22,
      btc_p2p_vps_ssh_user: 'hashgg',
      btc_p2p_vps_private_key: null,
      btc_p2p_vps_public_key: null,
      btc_p2p_vps_source: null,
      btc_p2p_tunnel_status: 'disconnected',
      btc_p2p_last_error: null,
      btc_p2p_acked: false,
      btc_p2p_advertised_for_host: null,
      btc_p2p_advertised_port: null,
      btc_p2p_verified_at: null,
      btc_p2p_verified_agent: null,
    });
    sendJson(res, 200, { ok: true, cleanup });
    return;
  }

  // --- Playit.gg account cleanup ---

  // GET /api/playit/cleanup/scan — find orphan HashGG tunnels from old installs
  if (pathname === '/api/playit/cleanup/scan' && req.method === 'GET') {
    try {
      const result = await playitCleanup.scanAccount();
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // POST /api/playit/cleanup/delete — delete the given orphan tunnel ids
  if (pathname === '/api/playit/cleanup/delete' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!Array.isArray(body.tunnel_ids)) {
      sendJson(res, 400, { error: 'tunnel_ids must be an array' });
      return;
    }
    try {
      const result = await playitCleanup.deleteOrphans(body.tunnel_ids);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // --- Additional miners (extra connections) ---

  // GET /api/connections — list extra connections with live status
  if (pathname === '/api/connections' && req.method === 'GET') {
    sendJson(res, 200, { connections: connections.list() });
    return;
  }

  // POST /api/connections — add an extra stratum connection
  if (pathname === '/api/connections' && req.method === 'POST') {
    const body = await parseBody(req);
    const name = (body.name || '').toString().trim();
    const localIp = (body.local_ip || '').toString().trim();
    const localPort = body.local_port !== undefined ? Number(body.local_port) : NaN;

    if (!name || name.length > 40 || !/^[A-Za-z0-9 _.\-]+$/.test(name)) {
      sendJson(res, 400, { error: 'Name may use letters, numbers, spaces, _ . - (40 chars max)' });
      return;
    }
    // Reject a leading '-' so the value can never be parsed as an ssh/curl option,
    // and forbid the regex's own metachar-free but tool-confusing forms.
    if (!localIp || localIp[0] === '-' || !/^[a-zA-Z0-9.\-:]+$/.test(localIp) || localIp.length > 255) {
      sendJson(res, 400, { error: 'Please enter a valid stratum IP or hostname' });
      return;
    }
    if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
      sendJson(res, 400, { error: 'Stratum port must be 1–65535' });
      return;
    }
    if (localIp === '0.0.0.0') {
      sendJson(res, 400, { error: '0.0.0.0 is not a valid stratum address' });
      return;
    }
    if (connections.list().some((c) => c.local_ip === localIp && c.local_port === localPort)) {
      sendJson(res, 400, { error: 'That stratum address:port is already added' });
      return;
    }
    try {
      const result = await connections.add({ name, local_ip: localIp, local_port: localPort });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // POST /api/connections/delete — remove an extra connection
  if (pathname === '/api/connections/delete' && req.method === 'POST') {
    const body = await parseBody(req);
    const id = (body.id || '').toString();
    if (!id) {
      sendJson(res, 400, { error: 'id is required' });
      return;
    }
    try {
      const ok = await connections.remove(id);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Connection not found' });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // --- VPS Tunnel API ---

  // GET /api/tunnel/mode
  if (pathname === '/api/tunnel/mode' && req.method === 'GET') {
    sendJson(res, 200, { mode: state.get().tunnel_mode });
    return;
  }

  // POST /api/tunnel/mode
  if (pathname === '/api/tunnel/mode' && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.mode !== 'playit' && body.mode !== 'vps') {
      sendJson(res, 400, { error: 'mode must be playit or vps' });
      return;
    }
    const patch = { tunnel_mode: body.mode };
    // Additional-miner connections are mode-specific (playit tunnel_id vs VPS
    // remote_port); if the mode actually changes, drop any carried over so they
    // can't be misinterpreted.
    if (state.get().tunnel_mode && state.get().tunnel_mode !== body.mode) {
      patch.extra_connections = [];
    }
    state.update(patch);
    sendJson(res, 200, { ok: true });
    return;
  }

  // GET /api/vps/key — return (or generate) the SSH public key
  if (pathname === '/api/vps/key' && req.method === 'GET') {
    let s = state.get();
    if (!s.vps_ssh_public_key || !s.vps_ssh_private_key) {
      const { privateKeyPem, publicKeyOpenSSH } = sshKeygenHelper.generateKeyPair();
      state.update({ vps_ssh_private_key: privateKeyPem, vps_ssh_public_key: publicKeyOpenSSH });
      s = state.get();
    }
    sendJson(res, 200, { public_key: s.vps_ssh_public_key });
    return;
  }

  // GET /api/vps/setup-script — return bash script with public key embedded
  if (pathname === '/api/vps/setup-script' && req.method === 'GET') {
    let s = state.get();
    if (!s.vps_ssh_public_key || !s.vps_ssh_private_key) {
      const { privateKeyPem, publicKeyOpenSSH } = sshKeygenHelper.generateKeyPair();
      state.update({ vps_ssh_private_key: privateKeyPem, vps_ssh_public_key: publicKeyOpenSSH });
      s = state.get();
    }
    // Every port HashGG needs on THIS machine: stratum, each additional miner,
    // and the Bitcoin P2P port when that tunnel shares this VPS. Re-running the
    // script should leave the box fully configured, not just for stratum.
    const ports = [s.vps_remote_port || 23335];
    for (const c of (s.extra_connections || [])) {
      if (c.remote_port && !ports.includes(c.remote_port)) ports.push(c.remote_port);
    }
    if (s.btc_p2p_enabled && s.btc_p2p_vps_host && s.btc_p2p_vps_host === s.vps_host) {
      const p = s.btc_p2p_remote_port || 8333;
      if (!ports.includes(p)) ports.push(p);
    }
    const script = buildSetupScript(s.vps_ssh_public_key, ports, s.vps_host);
    sendJson(res, 200, { script });
    return;
  }

  // GET /api/vps/teardown-script — return bash script that removes HashGG from the VPS
  if (pathname === '/api/vps/teardown-script' && req.method === 'GET') {
    const s = state.get();
    // Close every port HashGG opened: the primary plus each additional miner's.
    const ports = [s.vps_remote_port || 23335];
    for (const c of (s.extra_connections || [])) {
      if (c.remote_port && !ports.includes(c.remote_port)) ports.push(c.remote_port);
    }
    if (s.btc_p2p_enabled && s.btc_p2p_vps_host === s.vps_host) {
      const p = s.btc_p2p_remote_port || 8333;
      if (!ports.includes(p)) ports.push(p);
    }
    const script = buildTeardownScript(ports, s.vps_host, false, s.vps_ssh_public_key);
    sendJson(res, 200, { script });
    return;
  }

  // POST /api/vps/configure
  if (pathname === '/api/vps/configure' && req.method === 'POST') {
    const body = await parseBody(req);

    if (body.source === 'shared') {
      const s0 = state.get();
      if (!s0.btc_p2p_vps_host) {
        sendJson(res, 400, { error: 'You do not have a server set up for reachability yet.' });
        return;
      }
      const patch0 = {
        vps_host: s0.btc_p2p_vps_host,
        vps_ssh_port: s0.btc_p2p_vps_ssh_port || 22,
        vps_ssh_user: s0.btc_p2p_vps_ssh_user || 'hashgg',
      };
      // One key covering both purposes, so the server carries a single grant and
      // the user runs a single script. An existing stratum key wins: it may
      // already be trusted somewhere we cannot see, and replacing it would break
      // a tunnel nobody asked us to touch.
      if (!s0.vps_ssh_private_key && s0.btc_p2p_vps_private_key) {
        patch0.vps_ssh_private_key = s0.btc_p2p_vps_private_key;
        patch0.vps_ssh_public_key = s0.btc_p2p_vps_public_key || null;
      }
      state.update(patch0);
      sendJson(res, 200, { ok: true, host: patch0.vps_host, source: 'shared' });
      return;
    }

    const host = body.host;
    const sshPort = body.ssh_port !== undefined ? Number(body.ssh_port) : undefined;
    const sshUser = body.ssh_user;
    const remotePort = body.remote_port !== undefined ? Number(body.remote_port) : undefined;

    if (!host || typeof host !== 'string') {
      sendJson(res, 400, { error: 'host is required' });
      return;
    }
    if (host[0] === '-' || !/^[a-zA-Z0-9.\-:]+$/.test(host) || host.length > 255) {
      sendJson(res, 400, { error: 'invalid host' });
      return;
    }
    if (sshPort !== undefined && (isNaN(sshPort) || sshPort < 1 || sshPort > 65535)) {
      sendJson(res, 400, { error: 'ssh_port must be 1–65535' });
      return;
    }
    if (sshUser !== undefined && !/^[a-z_][a-z0-9_\-]{0,31}$/.test(sshUser)) {
      sendJson(res, 400, { error: 'invalid ssh_user' });
      return;
    }
    if (remotePort !== undefined && (isNaN(remotePort) || remotePort < 1024 || remotePort > 65535)) {
      sendJson(res, 400, { error: 'remote_port must be 1024–65535' });
      return;
    }

    const patch = { vps_host: host };
    if (sshPort !== undefined) patch.vps_ssh_port = sshPort;
    if (sshUser !== undefined) patch.vps_ssh_user = sshUser;
    if (remotePort !== undefined) patch.vps_remote_port = remotePort;
    state.update(patch);
    sendJson(res, 200, { ok: true });
    return;
  }

  // POST /api/vps/connect
  if (pathname === '/api/vps/connect' && req.method === 'POST') {
    const s = state.get();
    if (!s.vps_host || !s.vps_ssh_private_key) {
      sendJson(res, 400, { error: 'VPS not configured' });
      return;
    }
    vpsManager.start();
    sendJson(res, 200, { ok: true });
    return;
  }

  // POST /api/vps/disconnect
  if (pathname === '/api/vps/disconnect' && req.method === 'POST') {
    vpsManager.stop();
    sendJson(res, 200, { ok: true });
    return;
  }

  // GET /api/vps/status
  if (pathname === '/api/vps/status' && req.method === 'GET') {
    const s = state.get();
    sendJson(res, 200, {
      configured: !!(s.vps_host && s.vps_ssh_private_key),
      host: s.vps_host,
      remote_port: s.vps_remote_port || 23335,
      tunnel_status: s.vps_tunnel_status || 'disconnected',
      last_error: s.vps_last_error || null,
      port_suggestion: s.vps_port_suggestion || null,
      public_endpoint: s.public_endpoint,
      uptime: vpsManager.getUptime(),
    });
    return;
  }

  // POST /api/vps/reset
  if (pathname === '/api/vps/reset' && req.method === 'POST') {
    vpsManager.stop();
    connections.stopPolling();
    // Clear known_hosts so next connect re-verifies host key
    try { require('fs').unlinkSync('/root/data/vps_known_hosts'); } catch (_) {}
    try { require('fs').unlinkSync('/root/data/vps_ssh_key'); } catch (_) {}
    state.update({
      vps_host: null,
      vps_ssh_port: 22,
      vps_ssh_user: 'hashgg',
      vps_remote_port: 23335,
      vps_ssh_private_key: null,
      vps_ssh_public_key: null,
      vps_tunnel_status: 'disconnected',
      vps_last_error: null,
      tunnel_mode: null,
      public_endpoint: null,
      extra_connections: [],
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  // POST /api/vps/test-connection
  if (pathname === '/api/vps/test-connection' && req.method === 'POST') {
    const s = state.get();
    if (!s.vps_host || !s.vps_ssh_private_key) {
      sendJson(res, 400, { error: 'VPS not configured' });
      return;
    }
    const result = await testVpsSshAuth(s);
    sendJson(res, 200, result);
    return;
  }

  // GET /api/diag — test internal stratum connectivity
  if (pathname === '/api/diag' && req.method === 'GET') {
    const net = require('net');
    const stratumPort = getStratumPort();
    const listenPort = getListenPort();
    const results = {};

    // Test 1: Can we connect to 127.0.0.1:listenPort (socat)? This is the port the
    // tunnel forwards to — distinct from the Datum port on StartOS 0.4.0.
    const testLocal = () => new Promise((resolve) => {
      const sock = net.createConnection({ host: '127.0.0.1', port: listenPort }, () => {
        results.local_connect = 'ok';
        // Test 2: Send mining.subscribe and check response
        const msg = JSON.stringify({id:1,method:'mining.subscribe',params:['diag/1.0']}) + '\n';
        sock.write(msg);
        sock.setTimeout(5000);
        sock.on('data', (data) => {
          results.local_response = data.toString().trim();
          sock.destroy();
          resolve();
        });
        sock.on('timeout', () => {
          results.local_response = 'timeout (5s)';
          sock.destroy();
          resolve();
        });
        sock.on('error', (err) => {
          results.local_response = 'error: ' + err.message;
          resolve();
        });
      });
      sock.on('error', (err) => {
        results.local_connect = 'error: ' + err.message;
        resolve();
      });
      sock.setTimeout(5000);
    });

    // Test 3: Can we connect to Datum directly at its configured host:port?
    // Matches the entrypoint's DATUM_HOST default so plain-Docker users don't
    // see a bogus failure here; StartOS inherits 'datum.embassy'.
    const datumHost = process.env.DATUM_HOST || 'datum.embassy';
    const testDatum = () => new Promise((resolve) => {
      const sock = net.createConnection({ host: datumHost, port: stratumPort }, () => {
        results.datum_connect = 'ok';
        const msg = JSON.stringify({id:1,method:'mining.subscribe',params:['diag/1.0']}) + '\n';
        sock.write(msg);
        sock.setTimeout(5000);
        sock.on('data', (data) => {
          results.datum_response = data.toString().trim();
          sock.destroy();
          resolve();
        });
        sock.on('timeout', () => {
          results.datum_response = 'timeout (5s)';
          sock.destroy();
          resolve();
        });
        sock.on('error', (err) => {
          results.datum_response = 'error: ' + err.message;
          resolve();
        });
      });
      sock.on('error', (err) => {
        results.datum_connect = 'error: ' + err.message;
        resolve();
      });
      sock.setTimeout(5000);
    });

    await testLocal();
    await testDatum();
    results.listen_port = listenPort;
    results.stratum_port = stratumPort;
    results.datum_host = datumHost;

    // Test 3: Check V1 rundata (what playitd daemon uses for OriginLookup)
    const s2 = state.get();
    if (s2.playit_secret) {
      try {
        const v1Res = await new Promise((resolve, reject) => {
          const payload = JSON.stringify({});
          const reqOpts = {
            hostname: 'api.playit.gg',
            port: 443,
            path: '/v1/agents/rundata',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `agent-key ${s2.playit_secret}`,
              'Content-Length': Buffer.byteLength(payload),
            },
          };
          const apiReq = require('https').request(reqOpts, (apiRes) => {
            let d = '';
            apiRes.on('data', (c) => { d += c; });
            apiRes.on('end', () => {
              try { resolve({ status: apiRes.statusCode, body: JSON.parse(d) }); }
              catch (_) { resolve({ status: apiRes.statusCode, body: d }); }
            });
          });
          apiReq.on('error', reject);
          apiReq.setTimeout(8000, () => apiReq.destroy(new Error('timeout')));
          apiReq.write(payload);
          apiReq.end();
        });

        if (v1Res.status === 200) {
          const v1Data = v1Res.body?.data || v1Res.body || {};
          const tunnels = v1Data.tunnels || [];
          results.v1_tunnel_count = tunnels.length;
          if (tunnels.length > 0) {
            const t = tunnels[0];
            results.v1_tunnel = {
              id: t.id,
              internal_id: t.internal_id,
              name: t.name,
              display_address: t.display_address,
              tunnel_type: t.tunnel_type,
              agent_config_fields: (t.agent_config?.fields || []).map(f => `${f.name}=${f.value}`),
              disabled_reason: t.disabled_reason || null,
            };
          }
        } else {
          results.v1_error = `HTTP ${v1Res.status}: ${JSON.stringify(v1Res.body)}`;
        }
      } catch (err) {
        results.v1_error = err.message;
      }
    }

    // Test 4: Count running playitd processes
    try {
      const { execSync } = require('child_process');
      const ps = execSync('ps aux | grep playitd | grep -v grep', { encoding: 'utf8', timeout: 5000 }).trim();
      const lines = ps.split('\n').filter(Boolean);
      results.playitd_process_count = lines.length;
      results.playitd_processes = lines.map(l => l.replace(/\s+/g, ' ').substring(0, 120));
    } catch (_) {
      results.playitd_process_count = 0;
    }

    console.log('[diag] Results: ' + JSON.stringify(results));
    sendJson(res, 200, results);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

// Main request handler
async function handleRequest(req, res) {
  try {
    if (req.url.startsWith('/api/')) {
      await handleApi(req, res);
    } else {
      serveStatic(req, res);
    }
  } catch (err) {
    console.error(`[server] Error handling ${req.method} ${req.url}: ${err.message}`);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

// Generate the VPS setup script. `ports` is every port HashGG needs opened on
// this machine; `targetHost` is the address it is meant for, which the script
// echoes and sanity-checks — with two VPSes in play, pasting the wrong script
// into the wrong shell would reconfigure a machine that is still in use.
function buildSetupScript(publicKey, ports, targetHost) {
  const portList = (Array.isArray(ports) ? ports : [ports]).filter(Boolean).join(' ');
  return `#!/bin/bash
set -euo pipefail

HASHGG_PUBKEY="${publicKey}"
STRATUM_PORTS="${portList}"
EXPECTED_HOST="${targetHost || ''}"

echo "=== This script is for: \${EXPECTED_HOST:-(unspecified)} ==="
# Warn, never block: plenty of providers NAT the public address, so a mismatch
# is suspicious rather than proof of a mistake.
if [ -n "$EXPECTED_HOST" ] && command -v ip >/dev/null 2>&1; then
  if ! ip -4 addr 2>/dev/null | grep -qF " $EXPECTED_HOST/"; then
    echo ""
    echo "  !! WARNING: $EXPECTED_HOST is not an address on this machine."
    echo "  !! If you have more than one VPS, check you are on the right one."
    echo "  !! (Harmless if your provider NATs the public IP.)"
    echo ""
    sleep 3
  fi
fi
SSH_USER="hashgg"
SSH_HOME="/home/hashgg"
SSHD_CONF_DIR="/etc/ssh/sshd_config.d"

echo "=== HashGG VPS Setup ==="

# --- OS Detection ---
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_FAMILY="\${ID_LIKE:-} \${ID:-}"
else
  echo "Cannot detect OS"; exit 1
fi

is_debian() { echo "$OS_FAMILY" | grep -qiE 'debian|ubuntu'; }
is_rhel()   { echo "$OS_FAMILY" | grep -qiE 'rhel|fedora|centos|rocky|alma'; }

# --- Ensure openssh-server is present ---
if ! command -v sshd &>/dev/null; then
  echo "Installing openssh-server..."
  if is_debian; then
    apt-get update -qq && apt-get install -y -qq openssh-server
  elif is_rhel; then
    dnf install -y -q openssh-server 2>/dev/null || yum install -y -q openssh-server
    systemctl enable --now sshd
  else
    echo "Unsupported OS. Please install openssh-server manually."; exit 1
  fi
fi

# --- Create / fix hashgg user ---
if ! id "$SSH_USER" &>/dev/null; then
  echo "Creating user: $SSH_USER"
  useradd -r -m -d "$SSH_HOME" -s /usr/sbin/nologin "$SSH_USER"
else
  echo "User $SSH_USER already exists — repairing if needed"
fi
# Force home dir to be correct in /etc/passwd (fixes older scripts that used -M)
usermod -d "$SSH_HOME" "$SSH_USER" 2>/dev/null || true
usermod -s /usr/sbin/nologin "$SSH_USER" 2>/dev/null || true

# --- Set up home dir and SSH authorized_keys ---
#
# APPEND, never overwrite. Every HashGG installation mints its own keypair, so a
# second machine pointed at this same VPS used to replace the first machine's
# key. The already-authenticated tunnel kept working and then failed at its next
# reconnect, which puts the cause on one machine and the effect on another, hours
# apart. Each installation therefore owns exactly one line, identified by a tag
# derived from its own key.
mkdir -p "$SSH_HOME/.ssh"
AUTH_KEYS="$SSH_HOME/.ssh/authorized_keys"
touch "$AUTH_KEYS"

# The tag is a hash of the key itself: stable, unique per installation, and
# needing nothing stored anywhere to stay in step.
HASHGG_TAG="hashgg-$(printf '%s' "$HASHGG_PUBKEY" | awk '{printf "%s", $2}' | sha256sum | cut -c1-8)"
TAGGED_LINE="$HASHGG_PUBKEY $HASHGG_TAG"
KEY_BODY="$(printf '%s' "$HASHGG_PUBKEY" | awk '{print $2}')"

# Upgrade path. Installations that predate tagging have an untagged line here.
# If it is OURS, adopt it in place. If it is someone else's, leave it strictly
# alone -- removing it is the exact harm this change exists to prevent.
NEW_KEYS="$(mktemp)"
ADOPTED=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  case "$line" in '#'*) echo "$line" >> "$NEW_KEYS"; continue ;; esac
  line_body="$(printf '%s' "$line" | awk '{print $2}')"
  line_last="$(printf '%s' "$line" | awk '{print $NF}')"
  line_tag=""
  case "$line_last" in hashgg-*) line_tag="$line_last" ;; esac
  if [ "$line_body" = "$KEY_BODY" ]; then
    # Ours, tagged or not. Drop it here and re-add the tagged form below.
    [ -z "$line_tag" ] && ADOPTED="yes"
    continue
  fi
  if [ "$line_tag" = "$HASHGG_TAG" ]; then continue; fi
  echo "$line" >> "$NEW_KEYS"
done < "$AUTH_KEYS"
echo "$TAGGED_LINE" >> "$NEW_KEYS"
OTHERS=$(( $(grep -c . "$NEW_KEYS") - 1 ))
cat "$NEW_KEYS" > "$AUTH_KEYS"
rm -f "$NEW_KEYS"

[ -n "$ADOPTED" ] && echo "Adopted this machine's existing key"

if [ "$OTHERS" -gt 0 ]; then
  echo ""
  echo "  Note: $OTHERS other HashGG installation(s) already use this VPS."
  echo "  Their access has been left alone."
  # Ports already answering here will refuse a second forward, and the failure
  # arrives later as an unexplained tunnel error. Name them now instead.
  BUSY="$(ss -lntH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -un \
          | grep -vx 22 | tr '\n' ' ')"
  if [ -n "$BUSY" ]; then
    echo ""
    echo "  Ports already in use here: $BUSY"
    for p in $STRATUM_PORTS; do
      case " $BUSY " in
        *" $p "*)
          echo "  !! Port $p is one of them. Choose a different port in HashGG,"
          echo "     or this tunnel will not be able to start." ;;
      esac
    done
  fi
fi
# Critical: sshd StrictModes requires these exact ownerships and permissions
chown -R "$SSH_USER:$SSH_USER" "$SSH_HOME" 2>/dev/null || chown -R "$SSH_USER" "$SSH_HOME"
chmod 755 "$SSH_HOME"
chmod 700 "$SSH_HOME/.ssh"
chmod 600 "$SSH_HOME/.ssh/authorized_keys"

# --- Ensure sshd reads drop-in configs ---
MAIN_CONF="/etc/ssh/sshd_config"
if [ -d "$SSHD_CONF_DIR" ]; then
  if ! grep -qE "^\\s*Include\\s+$SSHD_CONF_DIR/\\*\\.conf" "$MAIN_CONF" 2>/dev/null; then
    echo "Adding Include directive to $MAIN_CONF"
    # Include must be at the top, before any Match blocks
    sed -i "1i Include $SSHD_CONF_DIR/*.conf" "$MAIN_CONF"
  fi
  CONF_FILE="$SSHD_CONF_DIR/hashgg.conf"
else
  mkdir -p "$SSHD_CONF_DIR"
  CONF_FILE="$SSHD_CONF_DIR/hashgg.conf"
  if ! grep -qE "^\\s*Include\\s+$SSHD_CONF_DIR/\\*\\.conf" "$MAIN_CONF" 2>/dev/null; then
    sed -i "1i Include $SSHD_CONF_DIR/*.conf" "$MAIN_CONF"
  fi
fi

# --- Configure sshd for remote port forwarding (always overwrite our file) ---
cat > "$CONF_FILE" << 'SSHEOF'
# HashGG tunnel config — managed by HashGG, do not edit manually
Match User hashgg
    AllowTcpForwarding remote
    GatewayPorts clientspecified
    X11Forwarding no
    PermitTTY no
    ForceCommand /bin/false
    PubkeyAuthentication yes
    PasswordAuthentication no
    AuthorizedKeysFile /home/hashgg/.ssh/authorized_keys
SSHEOF
chmod 644 "$CONF_FILE"
echo "Wrote $CONF_FILE"

# --- Validate sshd config before reloading ---
if ! sshd -t 2>/tmp/sshd-test.log; then
  echo "ERROR: sshd config test failed:"
  cat /tmp/sshd-test.log
  exit 1
fi

# --- Open firewall ports ---
for PORT in $STRATUM_PORTS; do
  echo "Opening port $PORT/tcp in firewall..."
  if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$PORT/tcp" comment "HashGG" || true
  elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port="$PORT/tcp" --quiet 2>/dev/null || true
  else
    echo "(No active firewall detected — ensure port $PORT is open in your VPS provider firewall.)"
  fi
done
command -v firewall-cmd &>/dev/null && firewall-cmd --reload --quiet 2>/dev/null || true

# --- Restart sshd (reload may not pick up Match blocks correctly on all distros) ---
echo "Restarting sshd..."
if systemctl list-units --type=service --all 2>/dev/null | grep -q "ssh\\.service"; then
  systemctl restart ssh
elif systemctl list-units --type=service --all 2>/dev/null | grep -q "sshd\\.service"; then
  systemctl restart sshd
else
  service ssh restart 2>/dev/null || service sshd restart 2>/dev/null || true
fi

# --- Self-test: show what sshd will actually apply for the hashgg user ---
echo ""
echo "=== Verification ==="
echo "User entry:      $(getent passwd $SSH_USER)"
echo "Home dir exists: $([ -d "$SSH_HOME" ] && echo yes || echo no)"
echo "authorized_keys: $(wc -l < "$SSH_HOME/.ssh/authorized_keys" 2>/dev/null || echo MISSING) line(s), $(stat -c '%a %U:%G' "$SSH_HOME/.ssh/authorized_keys" 2>/dev/null || echo '?')"
EFFECTIVE_AUTH=$(sshd -T -C user=$SSH_USER 2>/dev/null | grep -i authorizedkeysfile || echo "(not set)")
echo "sshd effective:  $EFFECTIVE_AUTH"
EFFECTIVE_PUBKEY=$(sshd -T -C user=$SSH_USER 2>/dev/null | grep -i pubkeyauthentication || echo "(not set)")
echo "sshd pubkeyauth: $EFFECTIVE_PUBKEY"

echo ""
echo "=== Setup complete! ==="
echo "Return to HashGG and click Test Connection."
`;
}

// Generate the VPS teardown script — removes everything buildSetupScript created:
// the hashgg user (+ home and its authorized_keys), the sshd drop-in config, and
// the firewall rules for every port HashGG opened (primary + additional miners).
// Best-effort and idempotent (safe to re-run; safe if some pieces are already
// gone). Mirror of buildSetupScript.
// `portsOnly` generates a teardown that closes the listed ports and NOTHING
// else. It exists for one case: the Bitcoin P2P endpoint sharing a VPS with the
// mining tunnel. The full teardown deletes the `hashgg` user and the sshd
// drop-in, which on a shared machine takes the mining tunnel down with it — and
// the wrong-host guard cannot catch that, because it IS the right host.
function buildTeardownScript(ports, targetHost, portsOnly = false, publicKey = '') {
  const portList = (Array.isArray(ports) ? ports : [ports]).filter(Boolean).join(' ');
  // Identifies our own key line, so teardown removes that and nothing else.
  const keyBody = String(publicKey || '').trim().split(/\s+/)[1] || '';
  const tag = keyBody
    ? 'hashgg-' + require('crypto').createHash('sha256').update(keyBody).digest('hex').slice(0, 8)
    : '';
  if (portsOnly) {
    return `#!/bin/bash
# Best-effort cleanup — keep going even if individual steps fail.
set -uo pipefail

STRATUM_PORTS="${portList}"

echo "=== HashGG — closing the Bitcoin port on ${targetHost || 'this VPS'} ==="
echo ""
echo "This VPS also carries your mining tunnel, so this script closes the"
echo "Bitcoin port and nothing else. Your mining access is left untouched."
echo ""

for PORT in $STRATUM_PORTS; do
  echo "Closing port $PORT/tcp in firewall..."
  if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw delete allow "$PORT/tcp" 2>/dev/null || true
  elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --remove-port="$PORT/tcp" --quiet 2>/dev/null || true
  else
    echo "(No managed firewall detected — if you opened port $PORT in your VPS provider firewall, remove it there.)"
  fi
done
command -v firewall-cmd &>/dev/null && firewall-cmd --reload --quiet 2>/dev/null || true

echo ""
echo "=== Done. Port(s) closed; mining access left in place. ==="
`;
  }
  return `#!/bin/bash
# Best-effort cleanup — keep going even if individual steps fail.
set -uo pipefail

SSH_USER="hashgg"
SSH_HOME="/home/hashgg"
SSHD_CONF_DIR="/etc/ssh/sshd_config.d"
CONF_FILE="$SSHD_CONF_DIR/hashgg.conf"
HASHGG_TAG="${tag}"
STRATUM_PORTS="${portList}"
EXPECTED_HOST="${targetHost || ''}"

echo "=== HashGG VPS Teardown ==="
echo "=== This script is for: \${EXPECTED_HOST:-(unspecified)} ==="
# Removing the hashgg user from the WRONG machine silently kills a tunnel that
# is still in use, so say loudly which host this was generated for.
if [ -n "$EXPECTED_HOST" ] && command -v ip >/dev/null 2>&1; then
  if ! ip -4 addr 2>/dev/null | grep -qF " $EXPECTED_HOST/"; then
    echo ""
    echo "  !! WARNING: $EXPECTED_HOST is not an address on this machine."
    echo "  !! Running this here will remove HashGG access from the WRONG VPS."
    echo "  !! Press Ctrl-C now if you are not sure."
    echo ""
    sleep 5
  fi
fi

# --- Remove this installation's key, and the user only if nobody else is using it ---
#
# A VPS can carry more than one HashGG installation, and sharing one is a
# configuration we actively suggest. Removing the account outright would revoke
# every other machine's access at the same time, which is the same failure the
# setup script's append behaviour exists to prevent.
AUTH_KEYS="$SSH_HOME/.ssh/authorized_keys"
REMAINING=0
if [ -f "$AUTH_KEYS" ] && [ -n "$HASHGG_TAG" ]; then
  KEPT="$(mktemp)"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    line_last="$(printf '%s' "$line" | awk '{print $NF}')"
    [ "$line_last" = "$HASHGG_TAG" ] && continue
    echo "$line" >> "$KEPT"
  done < "$AUTH_KEYS"
  REMAINING=$(grep -c . "$KEPT" 2>/dev/null || echo 0)
  cat "$KEPT" > "$AUTH_KEYS"
  rm -f "$KEPT"
  echo "Removed this installation's key"
fi

if [ "$REMAINING" -gt 0 ]; then
  echo ""
  echo "$REMAINING other HashGG installation(s) still use this VPS."
  echo "Its access has been left in place for them."
else
  # The sshd drop-in is shared, so it goes only when the account does.
  if [ -f "$CONF_FILE" ]; then rm -f "$CONF_FILE"; echo "Removed $CONF_FILE"; fi
  if id "$SSH_USER" &>/dev/null; then
    pkill -KILL -u "$SSH_USER" 2>/dev/null || true
    userdel -r "$SSH_USER" 2>/dev/null || userdel "$SSH_USER" 2>/dev/null || true
    echo "Removed user $SSH_USER"
  else
    echo "User $SSH_USER not present (already removed)"
  fi
  rm -rf "$SSH_HOME" 2>/dev/null || true
fi

# --- Validate sshd config, then restart so the change takes effect ---
if sshd -t 2>/tmp/sshd-test.log; then
  echo "Restarting sshd..."
  if systemctl list-units --type=service --all 2>/dev/null | grep -q "ssh\\.service"; then
    systemctl restart ssh
  elif systemctl list-units --type=service --all 2>/dev/null | grep -q "sshd\\.service"; then
    systemctl restart sshd
  else
    service ssh restart 2>/dev/null || service sshd restart 2>/dev/null || true
  fi
else
  echo "WARNING: sshd config test failed after removing HashGG config — NOT restarting sshd:"
  cat /tmp/sshd-test.log
fi

# --- Close the firewall port(s) ---
for PORT in $STRATUM_PORTS; do
  echo "Closing port $PORT/tcp in firewall..."
  if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw delete allow "$PORT/tcp" 2>/dev/null || true
  elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --remove-port="$PORT/tcp" --quiet 2>/dev/null || true
  else
    echo "(No managed firewall detected — if you opened port $PORT in your VPS provider firewall, remove it there.)"
  fi
done
command -v firewall-cmd &>/dev/null && firewall-cmd --reload --quiet 2>/dev/null || true

echo ""
echo "=== Teardown complete! ==="
echo "HashGG's access and configuration have been removed from this VPS."
`;
}

// Test SSH authentication (non-forwarding) — returns { success, error }
function testVpsSshAuth(s) {
  return new Promise((resolve) => {
    const { spawn: spawnProc } = require('child_process');
    const KEY_FILE = '/root/data/vps_ssh_key';
    const KNOWN_HOSTS_FILE = '/root/data/vps_known_hosts';
    try { require('fs').writeFileSync(KEY_FILE, s.vps_ssh_private_key, { mode: 0o600 }); }
    catch (e) { return resolve({ success: false, error: 'Failed to write key file' }); }

    // IPv6 addresses require bracket notation in SSH user@host form
    const sshHost = s.vps_host.includes(':') ? `[${s.vps_host}]` : s.vps_host;
    const args = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${KNOWN_HOSTS_FILE}`,
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
      '-i', KEY_FILE,
      '-p', String(s.vps_ssh_port || 22),
      `${s.vps_ssh_user || 'hashgg'}@${sshHost}`,
    ];

    let stderr = '';
    const proc = spawnProc('/usr/bin/ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => resolve({ success: false, error: e.message }));
    proc.on('close', (code) => {
      // code 255 = SSH error (connection refused, auth failed, etc.)
      // code 0 or 1 = SSH connected (ForceCommand /bin/false exits 1)
      if (code === 255) {
        const msg = stderr.trim().split('\n').pop() || 'Connection failed';
        resolve({ success: false, error: msg });
      } else {
        resolve({ success: true, error: null });
      }
    });
    // Safety timeout
    setTimeout(() => { try { proc.kill(); } catch (_) {} resolve({ success: false, error: 'Timed out' }); }, 15000);
  });
}

// Startup
function main() {
  // Last-resort guards: this process supervises the tunnel children, so a stray
  // rejection/exception must NOT take it down (that would orphan the tunnels and
  // bounce the container). Log and keep running.
  process.on('unhandledRejection', (err) => {
    console.error(`[server] Unhandled rejection: ${err && err.stack ? err.stack : err}`);
  });
  process.on('uncaughtException', (err) => {
    console.error(`[server] Uncaught exception: ${err && err.stack ? err.stack : err}`);
  });

  // Load state (applies migration for pre-VPS installs)
  state.load();

  // Check if secret was set via StartOS config
  const s = state.get();
  try {
    const { execSync } = require('child_process');
    const configSecret = execSync(`yq e '.playit.secret_key // ""' ${CONFIG_FILE}`, { encoding: 'utf8', timeout: 5000 }).trim();
    if (configSecret && configSecret !== 'null' && configSecret !== s.playit_secret) {
      console.log('[server] Secret key provided via StartOS config');
      state.update({ playit_secret: configSecret, claim_status: 'completed', tunnel_mode: 'playit' });
    }
  } catch (err) {
    console.log('[server] Could not read StartOS config, using stored state');
  }

  const mode = state.get().tunnel_mode;
  console.log(`[server] Tunnel mode: ${mode || 'not set'}`);

  const listenPort = getListenPort();

  if (mode === 'playit' && state.get().playit_secret) {
    playitManager.start();
    tunnelStatus.startPolling(listenPort);
  } else if (mode === 'vps') {
    if (state.get().vps_host && state.get().vps_ssh_private_key) {
      vpsManager.start();
    }
  }

  // Poll status/health of any additional miners (no-op until some exist).
  if (mode === 'playit' || mode === 'vps') {
    connections.startPolling();
  }

  // Bitcoin P2P tunnel — deliberately NOT gated on tunnel_mode. It owns its own
  // VPS record, so a playit-mode install can still be running it.
  btcP2pManager.resumeIfEnabled().catch((err) =>
    console.error(`[btc-p2p] resume failed: ${err.message}`));

  // Watch for mode/claim changes driven from the UI:
  //  - fresh install picks 'playit' → completes claim → start playitd
  //  - existing install switches mode → start the right manager
  // The watcher runs unconditionally because `tunnel_mode` can become 'playit'
  // after boot on a fresh install.
  setInterval(() => {
    const current = state.get();
    if (current.tunnel_mode === 'playit'
        && current.claim_status === 'completed'
        && current.playit_secret
        && playitManager.status === 'stopped') {
      console.log('[server] Claim completed — starting playit agent');
      playitManager.start();
      tunnelStatus.startPolling(listenPort);
      connections.startPolling();
    }
  }, 1000);

  // Start HTTP server
  const server = http.createServer(handleRequest);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] HashGG backend listening on port ${PORT}`);
  });

  // Graceful shutdown: stop child tunnel processes so the container can exit.
  // Without this, SIGTERM exits node immediately but playitd/ssh children are
  // orphaned and the container hits the 30s SIGKILL timeout ("stuck in Stopping").
  const shutdown = (signal) => {
    console.log(`[server] Received ${signal}, shutting down...`);
    try { playitManager.stop(); } catch (_) {}
    try { vpsManager.stop(); } catch (_) {}
    try { btcP2pManager.stop(); } catch (_) {}
    try { tunnelStatus.stopPolling(); } catch (_) {}
    try { connections.stopPolling(); } catch (_) {}
    server.close(() => process.exit(0));
    // Failsafe: exit after 5s even if server.close hangs
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
