'use strict';

// Read-only Bitcoin RPC — Umbrel only.
//
// Exists for one reason: HashGG can prove the *door* works (a handshake against
// our public endpoint), but not that the user's `externalip` line took effect.
// There is no way to see that from the network side, and the third-party
// crawlers that used to answer this question are gone. The node's own RPC is
// what is left.
//
// CONSTRAINTS — these are what make using wallet-capable credentials acceptable
// at all, not stylistic preferences:
//
//   1. Credentials are read from the environment AT CALL TIME and never written
//      to state.json, which is persisted on every poll and included in backups.
//   2. An explicit method allowlist, not a pass-through. No caller — present or
//      future — can reach a wallet method through this file.
//   3. Credentials never appear in a URL. `http://user:pass@host` lands in stack
//      traces, error strings and logs; Basic auth in a header does not.
//   4. Every call is best-effort. Missing credentials or a failed request must
//      degrade to the handshake-only story, never block enable/disable/verify.
//   5. Responses are capped — a wedged or hostile node could otherwise stream
//      indefinitely.
//
// See also getInboundPeerCount: `getpeerinfo` returns the user's entire peer
// graph, and we want a number. The rest is discarded immediately.

const http = require('http');

const ALLOWED_METHODS = new Set(['getnetworkinfo', 'getpeerinfo']);
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 5000;

function credentials() {
  const host = process.env.BITCOIN_RPC_HOST;
  const port = parseInt(process.env.BITCOIN_RPC_PORT || '', 10);
  const user = process.env.BITCOIN_RPC_USER;
  const pass = process.env.BITCOIN_RPC_PASS;
  if (!host || !port || !user || !pass) return null;
  return { host, port, user, pass };
}

function isAvailable() {
  return credentials() !== null;
}

function call(method, params = []) {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_METHODS.has(method)) {
      // Deliberately a throw rather than a silent no-op: reaching this means a
      // caller tried to use this client for something it must not do.
      return reject(new Error(`RPC method not allowed: ${method}`));
    }
    const c = credentials();
    if (!c) return reject(new Error('RPC credentials not configured'));

    const body = JSON.stringify({ jsonrpc: '1.0', id: 'hashgg', method, params });
    const req = http.request({
      host: c.host,
      port: c.port,
      method: 'POST',
      path: '/',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        // Header, never in the URL — see constraint 3.
        Authorization: 'Basic ' + Buffer.from(`${c.user}:${c.pass}`).toString('base64'),
      },
    }, (res) => {
      let data = '';
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy();
          return reject(new Error('RPC response too large'));
        }
        data += chunk;
      });
      res.on('end', () => {
        // Check the status before parsing. bitcoind answers rejections with an
        // EMPTY body, so a naive JSON.parse reports "could not parse the
        // response" — which describes our failure to read a reply rather than
        // the node's refusal to give one, and hides the actual cause.
        if (res.statusCode === 401) {
          return reject(new Error('RPC rejected the credentials (401)'));
        }
        if (res.statusCode === 403) {
          return reject(new Error(
            'RPC refused this client (403) — the node\'s rpcallowip does not ' +
            'cover where HashGG is running'
          ));
        }
        if (res.statusCode >= 400) {
          return reject(new Error(`RPC returned HTTP ${res.statusCode}`));
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'RPC error'));
          resolve(parsed.result);
        } catch (err) {
          reject(new Error('Could not parse the RPC response'));
        }
      });
    });

    // Errors are reported without the host, so nothing derived from the
    // credentials can leak into a message that gets logged or displayed.
    req.on('error', (err) => reject(new Error(`RPC request failed: ${err.code || err.message}`)));
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('RPC timed out')));
    req.write(body);
    req.end();
  });
}

/**
 * The addresses the node believes are its own — i.e. what it advertises.
 * Returns [] when RPC is unavailable, so callers can treat "no RPC" and "no
 * addresses" distinctly only if they check isAvailable() first.
 */
async function getAdvertisedAddresses() {
  const info = await call('getnetworkinfo');
  return (info && Array.isArray(info.localaddresses)) ? info.localaddresses : [];
}

/**
 * Is the node advertising this exact address:port?
 */
async function isAdvertising(host, port) {
  const addrs = await getAdvertisedAddresses();
  return addrs.some((a) => a && a.address === host && Number(a.port) === Number(port));
}

/**
 * Count of inbound peers.
 *
 * getpeerinfo returns every peer's address, user agent and traffic stats — the
 * user's whole peer graph. We want a number, so the response is reduced here
 * and discarded. It is never persisted, rendered per-peer, or logged. If
 * something later wants peer detail, that is a separate decision with its own
 * consent conversation.
 */
async function getInboundPeerCount() {
  const peers = await call('getpeerinfo');
  if (!Array.isArray(peers)) return 0;
  return peers.reduce((n, p) => n + (p && p.inbound ? 1 : 0), 0);
}

module.exports = {
  isAvailable,
  getAdvertisedAddresses,
  isAdvertising,
  getInboundPeerCount,
  ALLOWED_METHODS,
};
