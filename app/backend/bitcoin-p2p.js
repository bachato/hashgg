'use strict';

// Minimal Bitcoin P2P client — enough to complete a `version`/`verack` handshake
// and read back who answered. Used for two things:
//
//   * detectLocalNode()  — is there a Bitcoin node on this machine, and where?
//   * verifyPublic()     — does our public endpoint actually reach that node,
//                          dialled from here, out to the internet and back?
//
// Deliberately dependency-free (net + crypto only): this parses bytes from a
// socket we do not control, so the smaller and more boring it is, the better.
//
// SECURITY — the peer on the other end is untrusted. On the verify path the
// address is one the user typed, and this runs on a timer, so a leak here
// accumulates. Every read is bounded: a declared message length above
// MAX_MESSAGE_BYTES is rejected outright, total buffering is capped at
// MAX_BUFFER_BYTES, and the timeout is on *total elapsed time* rather than
// per-chunk (otherwise a peer dribbling one byte at a time keeps us alive
// forever). Any violation destroys the socket immediately.

const net = require('net');
const crypto = require('crypto');
const variant = require('./variant');

const MAINNET_MAGIC = Buffer.from('f9beb4d9', 'hex');
const PROTOCOL_VERSION = 70016;
const DEFAULT_TIMEOUT_MS = 5000;

// A `version` message is a few hundred bytes. These are generous ceilings whose
// only job is to make "hostile or broken peer" a bounded event.
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_BUFFER_BYTES = 64 * 1024;

const DETECT_CACHE_MS = 60000;

// --- whitebind protection (see assertAllowedTarget) --------------------------
//
// Both managed platforms run a SECOND inbound P2P listener that grants
// whitelisted permissions — noban, download, mempool, forcerelay — intended for
// trusted apps on the local network (Electrs and friends). Forwarding clearnet
// traffic there would hand every anonymous peer on the internet those
// permissions on the user's node. It is the worst thing this feature could do.
//
// The real protection is positive: we take the plain-bind port from the value
// the platform declares (BITCOIN_P2P_PORT) rather than discovering it by
// scanning. This list is defence-in-depth for the manual-override path, not the
// mechanism — do not remove the positive selection and rely on it.
const WHITEBIND_PORTS = new Set([
  9335,   // Umbrel  (APP_BITCOIN_KNOTS_P2P_WHITEBIND_PORT)
  58334,  // StartOS 0.4.0 (peerPortLocal)
]);
// Every whitebind port this build's own node targets use. Without this the
// companion's nodes would not be on the list at all: it was written when only
// `bitcoind` could be targeted, and knots-blake2b whitebinds on 18445, which
// appears nowhere above.
for (const p of variant.whitebindPorts()) WHITEBIND_PORTS.add(p);
// Prefer the platform's own declared value when we have it.
if (process.env.BITCOIN_P2P_WHITEBIND_PORT) {
  const p = parseInt(process.env.BITCOIN_P2P_WHITEBIND_PORT, 10);
  if (p > 0 && p < 65536) WHITEBIND_PORTS.add(p);
}

// Addresses that are never a legitimate Bitcoin node and exist only to make a
// scanner useful. RFC1918 is deliberately NOT blocked — the real targets
// (10.21.21.7 on Umbrel, bitcoind.startos) live there.
function isForbiddenAddress(host) {
  const h = String(host || '');
  return /^169\.254\./.test(h)                 // link-local
      || /^(22[4-9]|23[0-9])\./.test(h)         // multicast
      || /^0\./.test(h)
      || h === '255.255.255.255'
      || /^\[?(fe80|ff0)/i.test(h);             // IPv6 link-local / multicast
}

function assertAllowedTarget(host, port) {
  if (isForbiddenAddress(host)) {
    throw new Error(`${host} is not a valid address for a Bitcoin node.`);
  }
  if (WHITEBIND_PORTS.has(Number(port))) {
    throw new Error(
      `Port ${port} is your node's whitelisted-peer port. Forwarding it to the ` +
      `internet would give strangers privileged access to your node. Use your ` +
      `node's normal P2P port instead.`
    );
  }
}

// --- wire format -------------------------------------------------------------

function sha256d(buf) {
  return crypto.createHash('sha256').update(
    crypto.createHash('sha256').update(buf).digest()
  ).digest();
}

function encodeMessage(command, payload) {
  const cmd = Buffer.alloc(12);
  cmd.write(command, 0, 'ascii');
  const header = Buffer.alloc(24);
  MAINNET_MAGIC.copy(header, 0);
  cmd.copy(header, 4);
  header.writeUInt32LE(payload.length, 16);
  sha256d(payload).copy(header, 20, 0, 4);
  return Buffer.concat([header, payload]);
}

// A dummy net_addr — peers ignore what we claim, and volunteering nothing is
// the right default for a probe.
function emptyNetAddr() {
  const b = Buffer.alloc(26);
  b.writeUInt8(0xff, 18); b.writeUInt8(0xff, 19); // ::ffff:0.0.0.0
  return b;
}

function buildVersionPayload(userAgent) {
  const ua = Buffer.from(userAgent, 'ascii');
  if (ua.length > 252) throw new Error('user agent too long');
  const p = Buffer.alloc(4 + 8 + 8 + 26 + 26 + 8 + 1 + ua.length + 4 + 1);
  let o = 0;
  p.writeInt32LE(PROTOCOL_VERSION, o); o += 4;
  p.writeBigUInt64LE(0n, o); o += 8;                                  // services
  p.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), o); o += 8; // timestamp
  emptyNetAddr().copy(p, o); o += 26;                                  // addr_recv
  emptyNetAddr().copy(p, o); o += 26;                                  // addr_from
  crypto.randomBytes(8).copy(p, o); o += 8;                            // nonce
  p.writeUInt8(ua.length, o); o += 1;
  ua.copy(p, o); o += ua.length;
  p.writeInt32LE(0, o); o += 4;                                        // start_height
  p.writeUInt8(0, o);                                                  // relay=false
  return p;
}

function parseVersionPayload(p) {
  // Fixed prefix is 4+8+8+26+26+8 = 80 bytes, then a CompactSize user agent.
  if (p.length < 81) throw new Error('short version payload');
  const protocol_version = p.readInt32LE(0);
  const services = Number(p.readBigUInt64LE(4));

  let o = 80;
  let uaLen = p.readUInt8(o); o += 1;
  if (uaLen === 0xfd) { uaLen = p.readUInt16LE(o); o += 2; }
  else if (uaLen === 0xfe) { uaLen = p.readUInt32LE(o); o += 4; }
  else if (uaLen === 0xff) { throw new Error('absurd user agent length'); }
  if (uaLen > 256 || o + uaLen + 4 > p.length) throw new Error('malformed version payload');

  const user_agent = p.slice(o, o + uaLen).toString('ascii'); o += uaLen;
  const start_height = p.readInt32LE(o);
  return { protocol_version, services, user_agent, start_height };
}

// --- handshake ---------------------------------------------------------------

/**
 * Complete a version/verack handshake and report what answered.
 * Resolves (never rejects) with { ok, ... } or { ok: false, error }.
 */
function handshake(host, port, opts = {}) {
  const timeoutMs = opts.timeout || DEFAULT_TIMEOUT_MS;
  const userAgent = opts.userAgent || '/HashGG:0.7.0/';

  return new Promise((resolve) => {
    let settled = false;
    let buf = Buffer.alloc(0);
    let sock;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch (_) {}
      resolve(result);
    };
    const fail = (msg) => finish({ ok: false, error: msg });

    // One timer for the whole exchange. A per-chunk timeout would let a peer
    // trickle bytes indefinitely.
    const timer = setTimeout(() => fail(`timed out after ${timeoutMs}ms`), timeoutMs);

    try {
      assertAllowedTarget(host, port);
      sock = net.createConnection({ host, port });
    } catch (err) {
      clearTimeout(timer);
      return resolve({ ok: false, error: err.message });
    }

    sock.on('connect', () => {
      try {
        sock.write(encodeMessage('version', buildVersionPayload(userAgent)));
      } catch (err) { fail(err.message); }
    });

    sock.on('error', (err) => fail(err.message));
    sock.on('close', () => fail('connection closed before handshake completed'));

    sock.on('data', (chunk) => {
      if (settled) return;
      if (buf.length + chunk.length > MAX_BUFFER_BYTES) {
        return fail('peer sent too much data');
      }
      buf = Buffer.concat([buf, chunk]);

      // Drain whole messages; ignore anything that isn't the version we want.
      while (buf.length >= 24) {
        if (!buf.slice(0, 4).equals(MAINNET_MAGIC)) {
          return fail('not a Bitcoin mainnet node (bad magic)');
        }
        const len = buf.readUInt32LE(16);
        if (len > MAX_MESSAGE_BYTES) return fail('peer declared an absurd message length');
        if (buf.length < 24 + len) break;

        const command = buf.slice(4, 16).toString('ascii').replace(/\0+$/, '');
        const payload = buf.slice(24, 24 + len);
        buf = buf.slice(24 + len);

        if (command === 'version') {
          let parsed;
          try { parsed = parseVersionPayload(payload); }
          catch (err) { return fail(err.message); }
          // Be a well-behaved peer: ack before disappearing, so the node does
          // not log our probe as a broken connection.
          try { sock.write(encodeMessage('verack', Buffer.alloc(0))); } catch (_) {}
          return finish({ ok: true, host, port, ...parsed });
        }
      }
    });
  });
}

// --- detection ---------------------------------------------------------------

function candidateTargets(override) {
  const out = [];
  const push = (host, port, why) => {
    if (host && port) out.push({ host, port: Number(port), why });
  };

  // 1. A host:port the user supplied explicitly always wins.
  if (override && override.host) push(override.host, override.port, 'manual override');

  // 2. The platform's declared plain-bind port. This is the positive selection
  //    that keeps us off the whitebind port — see the note above.
  push(process.env.BITCOIN_P2P_HOST, process.env.BITCOIN_P2P_PORT, 'platform env');

  // 3. Documented fallbacks, used only when the env vars are absent. These are
  //    guesses, not declarations — see authoritative() for why that matters to
  //    the error we report.
  push('10.21.21.7', 9333, 'umbrel default');       // Umbrel bitcoin-knots
  push('bitcoind.embassy', 8333, 'startos 0.3.5.1');
  push('bitcoind.startos', 58333, 'startos 0.4.0'); // plain bind, NOT 58334
  // The companion build's nodes. Empty for the flagship, so this costs nothing
  // there. Both are PLAIN bind ports: knots-blake2b whitebinds on 18445 and
  // knots-prerdts on 58334, and forwarding either to the internet would grant
  // anonymous peers the noban and download permissions those listeners exist to
  // give trusted local services.
  for (const n of variant.NODE_TARGETS) {
    if (n.id === 'bitcoind') continue; // already covered above
    push(`${n.id}.startos`, n.peerInternalPort, `startos 0.4.0 (${n.id})`);
  }
  // A node on the Docker host, which is the ordinary plain-Docker arrangement
  // (Bitcoin on the desktop, HashGG in a container). Resolves only when the
  // container was started with host-gateway mapped, so it costs nothing
  // elsewhere — and without it a hand-started container finds nothing at all.
  push('host.docker.internal', 8333, 'docker host');
  return out;
}

// Did the caller TELL us where the node is, or are we guessing? An explicit
// override or the platform's env var is a declaration, and its failure is worth
// reporting verbatim — that is where the "your host firewall is dropping this"
// hint belongs. The fallbacks are guesses, and naming one of them reports an
// Umbrel container address to somebody who has never run Umbrel.
function authoritative(why) {
  return why === 'manual override' || why === 'platform env';
}

let detectCache = { at: 0, result: null };
let detectInFlight = null;

/**
 * Find the local Bitcoin node.
 *
 * Non-blocking by default. A sweep costs one timeout per candidate — around 6 s
 * when nothing answers — and this is called from a 3 s UI poll, so awaiting it
 * would stall the dashboard every time the cache expired. Instead: serve the
 * cached answer, refresh in the background, and report `pending` on the very
 * first call so the UI can say "checking…" and fill in a moment later.
 *
 * Pass { force: true } when a real answer is required before acting — enabling
 * the tunnel, for instance, must not proceed on a stale target.
 */
async function detectLocalNode(opts = {}) {
  const now = Date.now();
  const fresh = detectCache.result && now - detectCache.at < DETECT_CACHE_MS;

  if (fresh && !opts.force) return detectCache.result;
  if (opts.force) return sweep(opts);

  if (!detectInFlight) {
    detectInFlight = sweep(opts)
      .catch(() => null)
      .finally(() => { detectInFlight = null; });
  }
  // Stale is better than slow — the topology rarely changes, and a caller that
  // needs certainty passes force.
  if (detectCache.result) return detectCache.result;
  return { ok: false, pending: true, error: 'checking for a Bitcoin node…' };
}

async function sweep(opts = {}) {
  const now = Date.now();
  // Report the FIRST candidate's failure, not the last. The list is ordered by
  // authority — an explicit override, then the port the platform declares, then
  // generic fallbacks — so the first entry is the one that was supposed to work
  // and its error is the one worth showing. Reporting the last instead produces
  // things like "bitcoind.startos not found" on an Umbrel box, which sends the
  // user somewhere irrelevant.
  let firstError = null;
  let guessedOnly = true;
  for (const c of candidateTargets(opts.override)) {
    let err = null;
    try {
      assertAllowedTarget(c.host, c.port);
      const r = await handshake(c.host, c.port, { timeout: opts.timeout || 3000 });
      if (r.ok) {
        const result = { ...r, source: c.why };
        detectCache = { at: now, result };
        return result;
      }
      err = r.error;
    } catch (e) {
      err = e.message;
    }
    if (!firstError) {
      firstError = { ok: false, error: `${c.host}:${c.port} — ${err}`, tried: c.why };
      guessedOnly = !authoritative(c.why);
    }
  }

  const result = (firstError && !guessedOnly)
    ? firstError
    : {
        ok: false,
        tried: firstError && firstError.tried,
        error: 'No Bitcoin node found on this machine. If your node runs '
             + 'somewhere else, enter its address under Advanced.',
      };
  detectCache = { at: now, result };
  return result;
}

function clearDetectCache() {
  detectCache = { at: 0, result: null };
}

/**
 * Confirm our public endpoint reaches the node, dialled from here out to the
 * internet and back. `expect` (a previous local detection) lets the caller
 * confirm it is the *same* node rather than merely *a* node.
 */
async function verifyPublic(host, port, expect) {
  const r = await handshake(host, port, { timeout: 10000 });
  if (!r.ok) return r;
  if (expect && expect.user_agent && expect.user_agent !== r.user_agent) {
    return {
      ...r,
      ok: true,
      warning: `answered by a different node (${r.user_agent}) than the one found locally (${expect.user_agent})`,
    };
  }
  return r;
}

module.exports = {
  handshake,
  isForbiddenAddress,
  detectLocalNode,
  clearDetectCache,
  verifyPublic,
  assertAllowedTarget,
  WHITEBIND_PORTS,
};
