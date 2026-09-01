'use strict';

// Playit.gg account cleanup + agent identification.
//
// Background: every fresh HashGG install runs the claim flow, which mints a NEW
// self-managed agent (new secret) and creates a NEW "hashgg-stratum" tunnel.
// Uninstall/reinstall cycles therefore leave orphan agents + tunnels in the
// user's playit.gg account, which eventually exhaust the port/agent quota.
//
// The agent-key we hold is account-scoped for TUNNELS (POST /tunnels/list returns
// every tunnel in the account), so we can enumerate and delete orphan tunnels
// automatically. There is NO agent-delete endpoint for an agent-key, so agent
// removal stays a guided manual step on playit.gg/account/agents — we make it
// easier by renaming our own agent to something identifiable (renameAgentIfNeeded).

const https = require('https');
const os = require('os');
const state = require('./state');
const variant = require('./variant');

const API_BASE = 'https://api.playit.gg';
// Names HashGG gives its tunnels: the primary Datum tunnel and additional-miner
// tunnels. Orphans of either kind (from old installs) are cleanup candidates.
// This build's own tunnel names. Distinct per variant, because this list is
// exactly what separates "an orphan from an old install" from "the other
// installation's live tunnel". See app/backend/variant.js.
const HASHGG_TUNNEL_NAMES = variant.ownTunnelNames();
const ACCOUNT_AGENTS_URL = 'https://playit.gg/account/agents';

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

    const req = https.request(
      { hostname: url.hostname, port: 443, path: url.pathname, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
          catch (_) { resolve({ status: res.statusCode, body: data }); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

// Account-wide tunnel list (agent_id omitted → all tunnels in the account).
async function listAccountTunnels(secret) {
  const res = await apiRequest('POST', '/tunnels/list', secret, {});
  if (res.status !== 200) {
    throw new Error(`tunnels/list returned HTTP ${res.status}`);
  }
  const body = res.body?.data || res.body || {};
  return body.tunnels || [];
}

// Best-effort public endpoint string for display in the cleanup list.
function endpointOf(t) {
  const alloc = t.alloc;
  if (alloc && alloc.status === 'allocated' && alloc.data) {
    const port = alloc.data.port_start || null;
    const host = alloc.data.assigned_domain || alloc.data.static_ip4 || alloc.data.tunnel_ip || null;
    if (host && port) return `${host}:${port}`;
  }
  return null;
}

// Pull the owning agent out of a tunnel's origin (shape: {type:'agent',data:{agent_id,...}}).
function originAgentId(t) {
  const o = t.origin;
  if (o && o.data && o.data.agent_id) return o.data.agent_id;
  return null;
}
function originAgentName(t) {
  const o = t.origin;
  if (o && o.data && o.data.agent_name) return o.data.agent_name;
  return null;
}

// Scan the account for orphan HashGG tunnels (and the agents behind them).
// Returns the data the UI needs plus the canonical orphan set used to validate deletes.
async function scanAccount() {
  const s = state.get();
  if (!s.playit_secret) {
    throw new Error('Not connected to playit.gg');
  }

  // Our current agent_id — the tunnel bound to it must never be a candidate.
  // SAFETY: if we cannot determine the active agent, we must NOT classify any
  // tunnel as an orphan — otherwise a transient rundata failure could lead us to
  // offer the *live* tunnel for deletion. Fail safe by aborting the scan.
  let currentAgentId = null;
  try {
    const rd = await apiRequest('POST', '/agents/rundata', s.playit_secret);
    const rdBody = rd.body?.data || rd.body || {};
    currentAgentId = rdBody.agent_id || null;
  } catch (err) {
    console.error(`[cleanup] rundata error: ${err.message}`);
  }
  if (!currentAgentId) {
    throw new Error('Could not verify your active playit.gg agent — please try again in a moment.');
  }

  const tunnels = await listAccountTunnels(s.playit_secret);

  let activeTunnelId = null;
  const orphanTunnels = [];
  const orphanAgentIds = new Set();

  for (const t of tunnels) {
    if (!HASHGG_TUNNEL_NAMES.has(t.name)) continue; // only ever consider HashGG's own tunnels
    const agentId = originAgentId(t);
    if (agentId === currentAgentId) {
      activeTunnelId = t.id;
      continue; // never delete the tunnel for the running agent
    }
    orphanTunnels.push({
      id: t.id,
      name: t.name,
      created_at: t.created_at || null,
      agent_id: agentId,
      agent_name: originAgentName(t),
      endpoint: endpointOf(t),
    });
    if (agentId) orphanAgentIds.add(agentId);
  }

  return {
    current_agent_id: currentAgentId,
    active_tunnel_id: activeTunnelId,
    orphan_tunnels: orphanTunnels,
    orphan_agent_ids: Array.from(orphanAgentIds), // distinct agents behind orphan tunnels
    account_dashboard_url: ACCOUNT_AGENTS_URL,
  };
}

async function deleteTunnel(secret, tunnelId) {
  const res = await apiRequest('POST', '/tunnels/delete', secret, { tunnel_id: tunnelId });
  // success → {status:'success'}; already-gone → TunnelNotFound, which we treat as success.
  const ok = res.body?.status === 'success';
  const notFound = JSON.stringify(res.body || '').includes('TunnelNotFound');
  return { ok: ok || notFound, body: res.body };
}

// Delete the requested orphan tunnels. We re-scan server-side and only delete ids
// that are genuinely in the current orphan set (TOCTOU safety; never trust the client).
async function deleteOrphans(requestedIds) {
  const s = state.get();
  if (!s.playit_secret) throw new Error('Not connected to playit.gg');

  const scan = await scanAccount();
  const allowed = new Set(scan.orphan_tunnels.map((t) => t.id));
  const results = [];

  for (const id of requestedIds || []) {
    if (id === scan.active_tunnel_id) {
      results.push({ id, deleted: false, error: 'refused: active tunnel' });
      continue;
    }
    if (!allowed.has(id)) {
      results.push({ id, deleted: false, error: 'not an orphan HashGG tunnel' });
      continue;
    }
    try {
      const r = await deleteTunnel(s.playit_secret, id);
      results.push({ id, deleted: r.ok, error: r.ok ? null : 'delete failed' });
    } catch (err) {
      results.push({ id, deleted: false, error: err.message });
    }
  }

  const deleted = results.filter((r) => r.deleted).length;
  console.log(`[cleanup] Deleted ${deleted}/${results.length} orphan tunnels`);
  return { results, deleted };
}

// Friendly, identifiable agent name for the playit dashboard so users can tell
// which agents are HashGG's when manually deleting orphans. playit validates agent
// names (rejects with InvalidName) more strictly than tunnel names, and the exact
// rule is undocumented — so we try a ladder of candidates from most-specific to a
// plain, almost-certainly-valid "hashgg", and log each so we can see what sticks.
function candidateAgentNames() {
  let host = '';
  try { host = (os.hostname() || '').toLowerCase().split('.')[0]; } catch (_) {}
  host = host.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  const generic = !host || host === 'localhost' || /^[0-9a-f]{12}$/.test(host);
  const list = [];
  // playit caps agent names at ~15 chars (14 is confirmed-accepted, 24 is rejected
  // as InvalidName). Keep the host-suffixed name within that so it lands first try
  // — important on StartOS, where the hostname is a long random container id.
  if (!generic) list.push(`hashgg-${host}`.slice(0, 14).replace(/-+$/, ''));
  list.push('hashgg'); // fallback that satisfies any stricter rule
  return [...new Set(list)];
}

let renameDone = false;     // in-memory: succeeded this process lifetime
let renameCandidates = null;
let renameIdx = 0;

// Ensure our agent has an identifiable name. Gated in-memory (not on the persisted
// agent_renamed flag) so it self-heals: it re-applies once per backend start until
// it actually succeeds. Renaming to the same name is an idempotent no-op, so the
// steady-state cost is at most one API call per boot.
async function renameAgentIfNeeded(agentId) {
  const s = state.get();
  if (!agentId || renameDone || !s.playit_secret) return;
  if (!renameCandidates) renameCandidates = candidateAgentNames();

  // Walk the remaining candidates in this one pass — a rejected name advances to
  // the next immediately (so it resolves within a single poll), while a network
  // error stops the pass and retries the same candidate next time.
  while (renameIdx < renameCandidates.length) {
    const name = renameCandidates[renameIdx];
    let res;
    try {
      res = await apiRequest('POST', '/agents/rename', s.playit_secret, { agent_id: agentId, name });
    } catch (err) {
      console.error(`[cleanup] agents/rename "${name}" error: ${err.message}`);
      return; // network error — keep this candidate, retry next poll
    }
    // The playit API returns HTTP 200 even for {status:"error"} bodies, so only a
    // 'success' status means the rename actually applied — never gate on the 200.
    if (res.body?.status === 'success') {
      console.log(`[cleanup] Renamed agent to "${name}"`);
      renameDone = true;
      state.update({ agent_renamed: true }); // recorded for visibility/back-compat
      return;
    }
    console.log(`[cleanup] agents/rename "${name}" rejected (HTTP ${res.status}): ${JSON.stringify(res.body)} — trying next candidate`);
    renameIdx++;
  }
}

module.exports = { scanAccount, deleteOrphans, renameAgentIfNeeded };
