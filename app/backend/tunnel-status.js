'use strict';

const https = require('https');
const state = require('./state');
const variant = require('./variant');
const playitCleanup = require('./playit-cleanup');

const API_BASE = 'https://api.playit.gg';
const POLL_INTERVAL_HEALTHY = 30000;
const POLL_INTERVAL_RECOVERING = 5000;

let pollTimer = null;
let loggedRundata = false;

function apiRequest(method, path, secret, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `agent-key ${secret}`,
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// Point an existing tunnel at a local_ip:local_port (used to correct a primary
// tunnel whose local_port drifted — e.g. an install that pre-dates the LISTEN_PORT
// fix and still forwards to the Datum port instead of socat's port).
async function updateTunnelLocalPort(tunnelId, localPort) {
  const s = state.get();
  if (!s.playit_secret || !tunnelId) return false;
  try {
    const res = await apiRequest('POST', '/tunnels/update', s.playit_secret, {
      tunnel_id: tunnelId,
      local_ip: '127.0.0.1',
      local_port: localPort,
      enabled: true,
    });
    console.log(`[tunnel] Corrected local address → 127.0.0.1:${localPort}: ${JSON.stringify(res.body)}`);
    return res.body?.status === 'success';
  } catch (err) {
    console.error(`[tunnel] local_port correction error: ${err.message}`);
    return false;
  }
}

async function deleteTunnel(tunnelId) {
  const s = state.get();
  if (!s.playit_secret) return false;

  try {
    console.log(`[tunnel] Deleting tunnel ${tunnelId}`);
    const res = await apiRequest('POST', '/tunnels/delete', s.playit_secret, {
      tunnel_id: tunnelId,
    });
    console.log(`[tunnel] Delete response: ${JSON.stringify(res.body)}`);
    return res.body?.status === 'success';
  } catch (err) {
    console.error(`[tunnel] Delete error: ${err.message}`);
    return false;
  }
}

// Fetch full tunnel details via /tunnels/list to get the actual relay IP
async function fetchTunnelAllocation(tunnelId) {
  const s = state.get();
  if (!s.playit_secret || !tunnelId) return null;

  try {
    const res = await apiRequest('POST', '/tunnels/list', s.playit_secret, {
      tunnel_id: tunnelId,
    });

    if (res.status !== 200) {
      console.log(`[tunnel] /tunnels/list returned status ${res.status}: ${JSON.stringify(res.body)}`);
      return null;
    }

    const body = res.body?.data || res.body || {};
    const tunnels = body.tunnels || [];
    if (tunnels.length === 0) return null;

    // /tunnels/list may be account-wide; pick the tunnel we actually asked for by
    // id. Returning a different tunnel's allocation would mislabel an endpoint, so
    // we return null (caller treats as not-ready) rather than guess.
    const t = tunnels.find((x) => x.id === tunnelId);
    if (!t) {
      console.log(`[tunnel] /tunnels/list did not return tunnel ${tunnelId}`);
      return null;
    }
    // alloc is tagged: {status: "allocated", data: {static_ip4, port_start, ...}}
    const alloc = t.alloc;
    if (!alloc || alloc.status !== 'allocated' || !alloc.data) {
      console.log(`[tunnel] Allocation not ready: ${JSON.stringify(alloc)}`);
      return null;
    }

    console.log(`[tunnel] Allocation: ip4=${alloc.data.static_ip4}, tunnel_ip=${alloc.data.tunnel_ip}, port=${alloc.data.port_start}, domain=${alloc.data.assigned_domain}`);

    return {
      ip: alloc.data.static_ip4 || alloc.data.tunnel_ip || null,
      port: alloc.data.port_start || null,
      domain: alloc.data.assigned_domain || null,
      ip_hostname: alloc.data.ip_hostname || null,
    };
  } catch (err) {
    console.error(`[tunnel] Allocation fetch error: ${err.message}`);
    return null;
  }
}

// Fetch just our agent_id (used when creating extra tunnels under the same agent).
async function fetchAgentId() {
  const s = state.get();
  if (!s.playit_secret) return null;
  try {
    const res = await apiRequest('POST', '/agents/rundata', s.playit_secret);
    if (res.status !== 200) return null;
    const body = res.body?.data || res.body || {};
    return body.agent_id || null;
  } catch (err) {
    console.error(`[tunnel] fetchAgentId error: ${err.message}`);
    return null;
  }
}

async function fetchTunnelStatus() {
  const s = state.get();
  if (!s.playit_secret) return null;

  try {
    const res = await apiRequest('POST', '/agents/rundata', s.playit_secret);

    if (res.status !== 200) {
      console.log(`[tunnel] Rundata returned status ${res.status}`);
      return null;
    }

    // API wraps responses in {"status":"success","data":{...}}
    const body = res.body?.data || res.body || {};

    if (!loggedRundata) {
      console.log(`[tunnel] Rundata response: ${JSON.stringify(res.body)}`);
      loggedRundata = true;
    }

    const agentId = body.agent_id || null;

    // Once we know our agent_id, rename it to something identifiable in the playit
    // dashboard (runs once; helps users spot HashGG agents when cleaning up). Fire
    // and forget — never block status polling on it.
    if (agentId) playitCleanup.renameAgentIfNeeded(agentId);

    const allTunnels = body.tunnels || [];

    // The agent may serve several tunnels (primary + additional miners). Select the
    // PRIMARY one deliberately — never an extra — so the primary endpoint/health is
    // tracked correctly. Prefer the remembered id, then a non-extra primary by name,
    // then any non-extra tunnel.
    // Exclude additional-miner tunnels both by recorded id and by name — the name
    // backstop covers the brief window after an extra is created on the account but
    // before its id is saved to state.extra_connections.
    const extraIds = new Set((s.extra_connections || []).map((c) => c.tunnel_id).filter(Boolean));
    const nonExtra = allTunnels.filter((t) => !extraIds.has(t.id) && t.name !== variant.TUNNEL_NAMES.extra);
    const tunnel =
      nonExtra.find((t) => t.id === s.tunnel_id) ||
      nonExtra.find((t) => t.name === variant.TUNNEL_NAMES.primary) ||
      nonExtra[0] ||
      null;

    if (tunnel) {
      // Log full tunnel object once so we can see the structure
      if (!s.tunnel_id) {
        console.log(`[tunnel] Tunnel object: ${JSON.stringify(tunnel)}`);
      }

      // Migrate away from game-specific tunnel types — the relay does protocol
      // inspection on them and rejects non-game traffic (stratum gets RST).
      // Premium accounts can create tunnels without a type, which gives raw TCP.
      const gameTypes = ['minecraft-java', 'terraria'];
      if (gameTypes.includes(tunnel.tunnel_type)) {
        console.log(`[tunnel] Detected ${tunnel.tunnel_type} tunnel — incompatible with stratum protocol`);
        console.log('[tunnel] Deleting for migration to raw TCP (requires playit.gg Premium)...');
        await deleteTunnel(tunnel.id);
        state.update({ tunnel_id: null, public_endpoint: null });
        createAttempted = 0;
        createSucceeded = false;
        zeroTunnelsSince = 0;
        return { endpoint: null, tunnelId: null, tunnels: [], agentId };
      }

      // Get public endpoint — prefer the readable domain over raw IP.
      let endpoint = null;
      const alloc = await fetchTunnelAllocation(tunnel.id);
      const port = alloc?.port || tunnel.port?.from || null;
      if (tunnel.assigned_domain && port) {
        endpoint = `${tunnel.assigned_domain}:${port}`;
      } else if (alloc && alloc.ip && port) {
        endpoint = `${alloc.ip}:${port}`;
      }

      const tunnelId = tunnel.id || null;

      if (endpoint && endpoint !== s.public_endpoint) {
        console.log(`[tunnel] Endpoint updated: ${endpoint}`);
      }

      // Only persist when something actually changed — avoids rewriting the whole
      // state file (incl. secrets) on every poll in the steady state.
      if (tunnelId !== s.tunnel_id || endpoint !== s.public_endpoint) {
        state.update({ tunnel_id: tunnelId, public_endpoint: endpoint });
      }

      return { endpoint, tunnelId, tunnel };
    }

    // No tunnels — may need to create one
    return { endpoint: null, tunnelId: null, tunnels: [], agentId };
  } catch (err) {
    console.error(`[tunnel] Status check error: ${err.message}`);
    return null;
  }
}

// Create a playit tunnel. opts:
//   name    — tunnel name (defaults to this build's primary; see variant.js)
//   localIp — where playitd forwards (default '127.0.0.1' → our socat)
//   isExtra — true for additional-miner tunnels; keeps the primary create-retry
//             counters untouched so an extra never disturbs primary provisioning.
async function createTunnel(localPort, agentId, opts = {}) {
  const s = state.get();
  if (!s.playit_secret) return null;
  if (!agentId) {
    console.log('[tunnel] Cannot create tunnel: no agent_id available');
    return null;
  }

  const name = opts.name || variant.TUNNEL_NAMES.primary;
  const localIp = opts.localIp || '127.0.0.1';
  const isExtra = !!opts.isExtra;

  // V1 API schema (as of 2025): uses "protocol" + "endpoint" (not "ports" + "alloc").
  // For raw TCP: protocol.type = "raw-ports" with details {port_type, port_count, software_description}.
  // Endpoint is required — use region "global" for automatic allocation.
  const body = {
    name,
    protocol: {
      type: 'raw-ports',
      details: { port_type: 'tcp', port_count: 1, software_description: 'Bitcoin mining stratum proxy' },
    },
    origin: { type: 'agent', data: { agent_id: agentId, config: { fields: [] } } },
    endpoint: { type: 'region', details: { region: 'global' } },
    enabled: true,
  };

  const bodyJson = JSON.stringify(body);
  console.log(`[tunnel] Creating tunnel via curl: ${bodyJson}`);

  try {
    const { execFileSync } = require('child_process');
    const args = [
      '-s', '-w', '\n%{http_code}',
      '-X', 'POST', 'https://api.playit.gg/v1/tunnels/create',
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: agent-key ${s.playit_secret}`,
      '-d', bodyJson,
    ];
    console.log(`[tunnel] curl POST /v1/tunnels/create (body ${bodyJson.length} bytes)`);

    const output = execFileSync('curl', args, {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();

    // Last line is the HTTP status code
    const lines = output.split('\n');
    const httpStatus = lines.pop();
    const responseBody = lines.join('\n');

    console.log(`[tunnel] curl response [${httpStatus}]: ${responseBody}`);

    let parsed;
    try { parsed = JSON.parse(responseBody); } catch (e) { parsed = responseBody; }

    if (parsed?.status === 'success') {
      console.log(`[tunnel] Tunnel "${name}" created successfully`);
      if (!isExtra) createSucceeded = true;

      // Point playitd at the right backend: the primary forwards to our socat
      // (127.0.0.1:localPort); an extra forwards straight to the user's stratum.
      const tunnelId = parsed.data?.id;
      if (tunnelId) {
        try {
          const updateRes = await apiRequest('POST', '/tunnels/update', s.playit_secret, {
            tunnel_id: tunnelId,
            local_ip: localIp,
            local_port: localPort,
            enabled: true,
          });
          console.log(`[tunnel] Updated ${name} → ${localIp}:${localPort}: ${JSON.stringify(updateRes.body)}`);
        } catch (err) {
          console.error(`[tunnel] Failed to update local address: ${err.message}`);
        }
      }

      return parsed;
    }

    // Detect premium-related errors
    const errData = parsed?.data;
    const errStr = typeof errData === 'string' ? errData : JSON.stringify(errData);
    if (errStr && errStr.includes('RequiresPlayitPremium')) {
      console.error('[tunnel] *** playit.gg Premium required ***');
      console.error('[tunnel] Upgrade at https://playit.gg/account/premium');
      if (!isExtra) createAttempted = MAX_CREATE_ATTEMPTS;
      return null;
    }

    console.log(`[tunnel] Tunnel creation failed: ${JSON.stringify(parsed)}`);
    return null;
  } catch (err) {
    console.error(`[tunnel] curl error: ${err.message}`);
    return null;
  }
}

let createAttempted = 0;
let createSucceeded = false;
let lastBurstAt = 0;        // when the current create-attempt burst began (ms)
let zeroTunnelsSince = 0;   // when we first saw 0 tunnels after a success (ms)
const MAX_CREATE_ATTEMPTS = 3;
const CREATE_COOLDOWN_MS = 5 * 60 * 1000;   // a maxed-out burst retries after this
const PROPAGATION_MS = 90 * 1000;           // grace before treating 0-tunnels as "deleted"

function startPolling(localPort) {
  stopPolling();
  poll(localPort);
}

async function poll(localPort) {
  const result = await fetchTunnelStatus();

  let interval = POLL_INTERVAL_HEALTHY;

  // Self-correct an existing primary tunnel whose local_port doesn't match where
  // socat is actually listening (localPort). This fixes installs created before the
  // LISTEN_PORT fix, where the tunnel forwarded to the Datum port and miners got
  // "connection refused". createTunnel() already sets the right port on new tunnels.
  if (result && result.tunnelId && result.tunnel
      && result.tunnel.local_port && result.tunnel.local_port !== localPort) {
    console.log(`[tunnel] Primary tunnel local_port ${result.tunnel.local_port} != socat port ${localPort} — correcting`);
    await updateTunnelLocalPort(result.tunnelId, localPort);
  }

  if (!result || !result.endpoint) {
    interval = POLL_INTERVAL_RECOVERING;

    const noTunnels = result && Array.isArray(result.tunnels) && result.tunnels.length === 0;
    if (noTunnels) {
      const now = Date.now();

      // A tunnel we created earlier has vanished (deleted in the playit dashboard,
      // say). After a grace window — so we don't race API propagation right after
      // creating — clear the "succeeded" latch so we recreate it.
      if (createSucceeded) {
        if (!zeroTunnelsSince) {
          zeroTunnelsSince = now;
        } else if (now - zeroTunnelsSince > PROPAGATION_MS) {
          console.log('[tunnel] Previously-created tunnel is gone — allowing recreate');
          createSucceeded = false;
          createAttempted = 0;
        }
      }

      // A maxed-out attempt burst retries after a cooldown — recovers from a
      // transient API outage, or a Premium upgrade purchased after hitting the wall.
      if (createAttempted >= MAX_CREATE_ATTEMPTS && now - lastBurstAt > CREATE_COOLDOWN_MS) {
        console.log('[tunnel] Create cooldown elapsed — retrying tunnel creation');
        createAttempted = 0;
      }

      if (!createSucceeded && createAttempted < MAX_CREATE_ATTEMPTS) {
        if (createAttempted === 0) lastBurstAt = now;
        createAttempted++;
        console.log(`[tunnel] No tunnels found, creating one (attempt ${createAttempted}/${MAX_CREATE_ATTEMPTS})...`);
        await createTunnel(localPort, result.agentId);
      }
    } else {
      zeroTunnelsSince = 0; // tunnels present (or status unknown) — reset vanish timer
    }
  } else {
    zeroTunnelsSince = 0;
  }

  pollTimer = setTimeout(() => poll(localPort), interval);
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  fetchTunnelStatus,
  createTunnel,
  deleteTunnel,
  fetchTunnelAllocation,
  fetchAgentId,
  startPolling,
  stopPolling,
};
