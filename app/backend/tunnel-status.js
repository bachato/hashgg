'use strict';

const https = require('https');
const state = require('./state');

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

    const t = tunnels[0];
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
    const tunnels = body.tunnels || [];
    if (tunnels.length > 0) {
      const tunnel = tunnels[0];

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

      state.update({
        tunnel_id: tunnelId,
        public_endpoint: endpoint,
      });

      return { endpoint, tunnelId, tunnel };
    }

    // No tunnels — may need to create one
    return { endpoint: null, tunnelId: null, tunnels: [], agentId };
  } catch (err) {
    console.error(`[tunnel] Status check error: ${err.message}`);
    return null;
  }
}

async function createTunnel(localPort, agentId) {
  const s = state.get();
  if (!s.playit_secret) return null;
  if (!agentId) {
    console.log('[tunnel] Cannot create tunnel: no agent_id available');
    return null;
  }

  // V1 API schema (as of 2025): uses "protocol" + "endpoint" (not "ports" + "alloc").
  // For raw TCP: protocol.type = "raw-ports" with details {port_type, port_count, software_description}.
  // Endpoint is required — use region "global" for automatic allocation.
  const body = {
    name: 'hashgg-stratum',
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
      console.log('[tunnel] Tunnel created successfully');
      createSucceeded = true;

      // Set local_port so playitd forwards to socat (port 23335), not the auto-assigned port.
      const tunnelId = parsed.data?.id;
      if (tunnelId) {
        try {
          const updateRes = await apiRequest('POST', '/tunnels/update', s.playit_secret, {
            tunnel_id: tunnelId,
            local_ip: '127.0.0.1',
            local_port: localPort,
            enabled: true,
          });
          console.log(`[tunnel] Updated local_port to ${localPort}: ${JSON.stringify(updateRes.body)}`);
        } catch (err) {
          console.error(`[tunnel] Failed to update local_port: ${err.message}`);
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
      createAttempted = MAX_CREATE_ATTEMPTS;
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
const MAX_CREATE_ATTEMPTS = 3;

function startPolling(localPort) {
  stopPolling();
  poll(localPort);
}

async function poll(localPort) {
  const result = await fetchTunnelStatus();

  let interval = POLL_INTERVAL_HEALTHY;

  if (!result || !result.endpoint) {
    interval = POLL_INTERVAL_RECOVERING;

    // If we have a secret but no tunnels, try to create one (limited retries)
    if (result && result.tunnels && result.tunnels.length === 0 && !createSucceeded && createAttempted < MAX_CREATE_ATTEMPTS) {
      createAttempted++;
      console.log(`[tunnel] No tunnels found, creating one (attempt ${createAttempted}/${MAX_CREATE_ATTEMPTS})...`);
      await createTunnel(localPort, result.agentId);
    }
  }

  pollTimer = setTimeout(() => poll(localPort), interval);
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

module.exports = { fetchTunnelStatus, createTunnel, startPolling, stopPolling };
