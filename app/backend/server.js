'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const state = require('./state');
const playitManager = require('./playit-manager');
const claimFlow = require('./claim-flow');
const tunnelStatus = require('./tunnel-status');

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

// Read config for the stratum port
function getStratumPort() {
  try {
    const { execSync } = require('child_process');
    const port = execSync(`yq e '.advanced.datum_stratum_port // 23335' ${CONFIG_FILE}`, { encoding: 'utf8' }).trim();
    return parseInt(port, 10) || 23335;
  } catch {
    return 23335;
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
        resolve(JSON.parse(body));
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

    // Start the agent with the new key
    playitManager.restart();
    const stratumPort = getStratumPort();
    tunnelStatus.startPolling(stratumPort);

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
    tunnelStatus.stopPolling();
    state.reset();
    sendJson(res, 200, { ok: true });
    return;
  }

  // GET /api/diag — test internal stratum connectivity
  if (pathname === '/api/diag' && req.method === 'GET') {
    const net = require('net');
    const stratumPort = getStratumPort();
    const results = {};

    // Test 1: Can we connect to 127.0.0.1:stratumPort (socat)?
    const testLocal = () => new Promise((resolve) => {
      const sock = net.createConnection({ host: '127.0.0.1', port: stratumPort }, () => {
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

    // Test 3: Can we connect to datum.embassy:stratumPort directly?
    const testDatum = () => new Promise((resolve) => {
      const sock = net.createConnection({ host: 'datum.embassy', port: stratumPort }, () => {
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
    results.stratum_port = stratumPort;

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
      const ps = execSync('ps aux | grep playitd | grep -v grep', { encoding: 'utf8' }).trim();
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

// Startup
function main() {
  // Load state
  state.load();

  // Check if secret was set via StartOS config
  const s = state.get();
  try {
    const { execSync } = require('child_process');
    const configSecret = execSync(`yq e '.playit.secret_key // ""' ${CONFIG_FILE}`, { encoding: 'utf8' }).trim();
    if (configSecret && configSecret !== 'null' && configSecret !== s.playit_secret) {
      console.log('[server] Secret key provided via StartOS config');
      state.update({ playit_secret: configSecret, claim_status: 'completed' });
    }
  } catch (err) {
    console.log('[server] Could not read StartOS config, using stored state');
  }

  const stratumPort = getStratumPort();

  // Start playit agent if we have a secret
  if (state.get().playit_secret) {
    playitManager.start();
    tunnelStatus.startPolling(stratumPort);
  }

  // When claim completes, start the agent
  const checkClaimCompletion = setInterval(() => {
    const current = state.get();
    if (current.claim_status === 'completed' && current.playit_secret && playitManager.status === 'stopped') {
      playitManager.start();
      tunnelStatus.startPolling(stratumPort);
      clearInterval(checkClaimCompletion);
    }
  }, 1000);

  // Start HTTP server
  const server = http.createServer(handleRequest);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] HashGG backend listening on port ${PORT}`);
  });
}

main();
