'use strict';

// ssh's own words, translated for the person who has to act on them.
//
// Shared by both tunnels. It used to live only in the Bitcoin one, so the same
// failure — a port already forwarded on the VPS — read as a plain sentence
// there and as raw ssh stderr on the mining side. Sharing it is also the point:
// a VPS carrying two installations produces these collisions routinely, and the
// text has to name the port and the way out, not describe the mechanism.
//
// Anything unrecognised passes through unchanged. A wrong guess is worse than
// ssh's own wording, which at least a search engine can resolve.

/**
 * @param {string} raw     the last non-debug line ssh printed
 * @param {object} opts    { port, portLabel } — the remote port this tunnel
 *                         asked for, and where the user changes it
 */
function isPortCollision(raw) {
  return /remote port forwarding failed/i.test(String(raw || ''));
}

/**
 * The next port to try after a collision.
 *
 * Deliberately just "the next one up". We cannot see what is free — the VPS
 * account is command-less by design — so any suggestion is a guess. Guessing
 * adjacent means a second collision suggests the one after that, and the user
 * converges on a free port by clicking, without ever being asked to know
 * anything about ports.
 */
function suggestNextPort(port) {
  const p = Number(port) || 0;
  if (p < 1024 || p >= 65535) return 23336;
  return p + 1;
}

function friendlySshError(raw, opts = {}) {
  const port = opts.port;

  if (isPortCollision(raw)) {
    // The common cause on a shared VPS: another HashGG installation, or another
    // service, already holds that port. Name it, and let the UI offer the way out
    // rather than asking the user to invent a number.
    return `Port ${port} is already in use on your VPS — something else is already `
         + `listening there, often another HashGG setup.`;
  }
  if (/permission denied|publickey/i.test(raw)) {
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
  if (/name or service not known|could not resolve/i.test(raw)) {
    return 'That VPS address could not be found. Check it for typos.';
  }
  return raw;
}

module.exports = { friendlySshError, isPortCollision, suggestNextPort };
