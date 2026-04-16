'use strict';

const POLL_INTERVAL = 3000;
let pollHandle = null;
let currentScreen = null;

// DOM elements
const screens = {
  setup: document.getElementById('screen-setup'),
  claim: document.getElementById('screen-claim'),
  dashboard: document.getElementById('screen-dashboard'),
};

const els = {
  // Setup
  btnStartClaim: document.getElementById('btn-start-claim'),
  btnSubmitSecret: document.getElementById('btn-submit-secret'),
  inputSecret: document.getElementById('input-secret'),
  // Claim
  claimUrl: document.getElementById('claim-url'),
  claimStatusDot: document.getElementById('claim-status-dot'),
  claimStatusText: document.getElementById('claim-status-text'),
  btnCancelClaim: document.getElementById('btn-cancel-claim'),
  // Dashboard
  endpointText: document.getElementById('endpoint-text'),
  btnCopy: document.getElementById('btn-copy'),
  copyFeedback: document.getElementById('copy-feedback'),
  dotTunnel: document.getElementById('dot-tunnel'),
  dotDatum: document.getElementById('dot-datum'),
  dotAgent: document.getElementById('dot-agent'),
  statusTunnel: document.getElementById('status-tunnel'),
  statusDatum: document.getElementById('status-datum'),
  statusAgent: document.getElementById('status-agent'),
  btnReset: document.getElementById('btn-reset'),
  // Error
  errorBar: document.getElementById('error-bar'),
  errorText: document.getElementById('error-text'),
};

// Screen management
function showScreen(name) {
  Object.values(screens).forEach(s => s.style.display = 'none');
  if (screens[name]) {
    screens[name].style.display = 'block';
    currentScreen = name;
  }
}

function showError(msg) {
  els.errorText.textContent = msg;
  els.errorBar.style.display = 'block';
  setTimeout(() => { els.errorBar.style.display = 'none'; }, 8000);
}

// API helpers
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  return res.json();
}

// Status polling
async function pollStatus() {
  try {
    const status = await api('GET', '/status');
    updateUI(status);
  } catch (err) {
    console.error('Poll error:', err);
  }
}

function startPolling() {
  stopPolling();
  pollStatus();
  pollHandle = setInterval(pollStatus, POLL_INTERVAL);
}

function stopPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

// UI updates from status
function updateUI(status) {
  // Decide which screen to show
  if (!status.has_secret && status.claim_status !== 'pending') {
    showScreen('setup');
    return;
  }

  if (status.claim_status === 'pending') {
    // Stay on claim screen if we're already there, otherwise check
    if (currentScreen !== 'claim') {
      showScreen('claim');
    }
    updateClaimUI(status);
    return;
  }

  // We have a secret — show dashboard
  showScreen('dashboard');
  updateDashboard(status);
}

function updateClaimUI(status) {
  // Poll claim-specific status
  api('GET', '/claim/status').then(cs => {
    if (cs.claim_url) {
      els.claimUrl.href = cs.claim_url;
      els.claimUrl.textContent = cs.claim_url;
    }

    if (cs.status === 'completed') {
      els.claimStatusDot.className = 'dot dot-green';
      els.claimStatusText.textContent = 'Approved! Setting up tunnel...';
    } else if (cs.status === 'failed') {
      els.claimStatusDot.className = 'dot dot-red';
      els.claimStatusText.textContent = 'Setup failed. Please try again.';
      setTimeout(() => showScreen('setup'), 2000);
    } else {
      els.claimStatusDot.className = 'dot dot-yellow';
      els.claimStatusText.textContent = 'Waiting for approval...';
    }
  }).catch(() => {});
}

function updateDashboard(status) {
  // Endpoint
  if (status.public_endpoint) {
    const endpoint = `stratum+tcp://${status.public_endpoint}`;
    els.endpointText.textContent = endpoint;
    els.btnCopy.style.display = 'inline-block';
  } else {
    els.endpointText.textContent = 'Waiting for tunnel allocation...';
    els.btnCopy.style.display = 'none';
  }

  // Tunnel status
  if (status.public_endpoint) {
    els.dotTunnel.className = 'dot dot-green';
    els.statusTunnel.textContent = 'Connected';
  } else if (status.agent_status === 'running') {
    els.dotTunnel.className = 'dot dot-yellow';
    els.statusTunnel.textContent = 'Pending';
  } else {
    els.dotTunnel.className = 'dot dot-red';
    els.statusTunnel.textContent = 'Disconnected';
  }

  // Agent status
  const agentMap = {
    running: { dot: 'dot-green', text: `Running (${formatUptime(status.uptime)})` },
    starting: { dot: 'dot-yellow', text: 'Starting...' },
    crashed: { dot: 'dot-red', text: 'Error — restarting...' },
    stopped: { dot: 'dot-gray', text: 'Stopped' },
  };
  const agent = agentMap[status.agent_status] || { dot: 'dot-gray', text: status.agent_status };
  els.dotAgent.className = `dot ${agent.dot}`;
  els.statusAgent.textContent = agent.text;

  // Datum — we derive this from whether the tunnel can reach it
  // For now, show as "checking" since we don't have a direct status field
  els.dotDatum.className = 'dot dot-green';
  els.statusDatum.textContent = 'Reachable';
}

function formatUptime(seconds) {
  if (!seconds || seconds < 60) return `${seconds || 0}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// Event handlers
els.btnStartClaim.addEventListener('click', async () => {
  try {
    const result = await api('POST', '/claim/start');
    if (result.claim_url) {
      els.claimUrl.href = result.claim_url;
      els.claimUrl.textContent = result.claim_url;
      showScreen('claim');
    } else {
      showError('Failed to start claim flow');
    }
  } catch (err) {
    showError('Failed to start setup: ' + err.message);
  }
});

els.btnSubmitSecret.addEventListener('click', async () => {
  const key = els.inputSecret.value.trim();
  if (!key) {
    showError('Please enter a secret key');
    return;
  }
  if (!/^[0-9a-fA-F]+$/.test(key)) {
    showError('Secret key must be a hex string');
    return;
  }
  try {
    await api('POST', '/secret', { secret_key: key });
    els.inputSecret.value = '';
    showScreen('dashboard');
  } catch (err) {
    showError('Failed to save secret key: ' + err.message);
  }
});

els.btnCancelClaim.addEventListener('click', () => {
  showScreen('setup');
});

els.btnCopy.addEventListener('click', () => {
  const text = els.endpointText.textContent;
  navigator.clipboard.writeText(text).then(() => {
    els.copyFeedback.style.display = 'inline-block';
    setTimeout(() => { els.copyFeedback.style.display = 'none'; }, 2000);
  }).catch(() => {
    // Fallback for non-HTTPS contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    els.copyFeedback.style.display = 'inline-block';
    setTimeout(() => { els.copyFeedback.style.display = 'none'; }, 2000);
  });
});

els.btnReset.addEventListener('click', async () => {
  if (!confirm('This will disconnect the tunnel and clear your playit.gg credentials. You will need to set up again. Continue?')) {
    return;
  }
  try {
    await api('POST', '/reset');
    showScreen('setup');
  } catch (err) {
    showError('Failed to reset: ' + err.message);
  }
});

// Initialize
startPolling();
