'use strict';

const https = require('https');
const crypto = require('crypto');
const state = require('./state');

const API_BASE = 'https://api.playit.gg';
const CLAIM_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL = 2000;

let claimTimer = null;
let pollTimer = null;

function generateClaimCode() {
  return crypto.randomBytes(5).toString('hex');
}

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
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

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function startClaim() {
  stopClaim();

  const code = generateClaimCode();
  const claimUrl = `https://playit.gg/claim/${code}`;

  state.update({
    claim_code: code,
    claim_status: 'pending',
  });

  console.log(`[claim] Claim started: ${claimUrl}`);

  // Set timeout
  claimTimer = setTimeout(() => {
    console.log('[claim] Claim timed out');
    state.update({ claim_status: 'failed', claim_code: null });
    stopClaim();
  }, CLAIM_TIMEOUT);

  // Start polling
  pollClaim(code);

  return { claim_url: claimUrl, code };
}

function pollClaim(code) {
  pollTimer = setInterval(async () => {
    try {
      const res = await apiRequest('POST', '/claim/setup', {
        code,
        agent_type: 'self-managed',
        version: 'hashgg 0.1.0',
      });

      if (res.status !== 200) {
        console.log(`[claim] Poll returned status ${res.status}: ${JSON.stringify(res.body)}`);
        return;
      }

      // API returns { status: "success", data: "WaitingForUserVisit" | "WaitingForUser" | "UserAccepted" | "UserRejected" }
      const statusType = res.body?.data || res.body;

      console.log(`[claim] Poll status: ${statusType}`);

      if (statusType === 'UserAccepted') {
        // Exchange for secret
        await exchangeClaim(code);
      } else if (statusType === 'UserRejected') {
        state.update({ claim_status: 'failed', claim_code: null });
        stopClaim();
      }
    } catch (err) {
      console.error(`[claim] Poll error: ${err.message}`);
    }
  }, POLL_INTERVAL);
}

async function exchangeClaim(code) {
  try {
    const res = await apiRequest('POST', '/claim/exchange', { code });

    if (res.status === 200 && (res.body?.data?.secret_key || res.body?.secret_key)) {
      const secret = res.body?.data?.secret_key || res.body?.secret_key;
      console.log('[claim] Secret key obtained successfully');
      state.update({
        playit_secret: secret,
        claim_status: 'completed',
        claim_code: null,
      });
      stopClaim();
      return true;
    } else {
      console.error(`[claim] Exchange failed: ${JSON.stringify(res.body)}`);
      state.update({ claim_status: 'failed', claim_code: null });
      stopClaim();
      return false;
    }
  } catch (err) {
    console.error(`[claim] Exchange error: ${err.message}`);
    state.update({ claim_status: 'failed', claim_code: null });
    stopClaim();
    return false;
  }
}

function stopClaim() {
  if (claimTimer) {
    clearTimeout(claimTimer);
    claimTimer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function getClaimStatus() {
  const s = state.get();
  return {
    status: s.claim_status,
    claim_url: s.claim_code ? `https://playit.gg/claim/${s.claim_code}` : null,
  };
}

module.exports = { startClaim, stopClaim, getClaimStatus };
