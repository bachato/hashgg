'use strict';

const POLL_INTERVAL = 3000;
let pollHandle = null;
let currentScreen = null;
let currentMode = null; // 'playit' | 'vps' | null

// DOM elements
const screens = {
  setup: document.getElementById('screen-setup'),
  claim: document.getElementById('screen-claim'),
  dashboard: document.getElementById('screen-dashboard'),
  'tunnel-choice': document.getElementById('screen-tunnel-choice'),
  'vps-instructions': document.getElementById('screen-vps-instructions'),
  'vps-key': document.getElementById('screen-vps-key'),
  'vps-configure': document.getElementById('screen-vps-configure'),
  'vps-connecting': document.getElementById('screen-vps-connecting'),
};

const els = {
  // Setup (playit)
  btnStartClaim: document.getElementById('btn-start-claim'),
  btnSubmitSecret: document.getElementById('btn-submit-secret'),
  inputSecret: document.getElementById('input-secret'),
  // Claim
  claimUrl: document.getElementById('claim-url'),
  claimStatusDot: document.getElementById('claim-status-dot'),
  claimStatusText: document.getElementById('claim-status-text'),
  btnCancelClaim: document.getElementById('btn-cancel-claim'),
  // Dashboard (shared)
  endpointText: document.getElementById('endpoint-text'),
  btnCopy: document.getElementById('btn-copy'),
  copyFeedback: document.getElementById('copy-feedback'),
  dotTunnel: document.getElementById('dot-tunnel'),
  dotDatum: document.getElementById('dot-datum'),
  dotAgent: document.getElementById('dot-agent'),
  statusTunnel: document.getElementById('status-tunnel'),
  statusDatum: document.getElementById('status-datum'),
  statusAgent: document.getElementById('status-agent'),
  btnRestartTunnel: document.getElementById('btn-restart-tunnel'),
  // Bitcoin clearnet inbound
  btcSection: document.getElementById('advanced-btc-p2p'),
  btcSummaryNote: document.getElementById('btc-summary-note'),
  btcIntro: document.getElementById('btc-intro'),
  btcChecklist: document.getElementById('btc-checklist'),
  btcGuidance: document.getElementById('btc-guidance'),
  btcVpsSetup: document.getElementById('btc-vps-setup'),
  btcVpsShare: document.getElementById('btc-vps-share'),
  btnBtcUseShared: document.getElementById('btn-btc-use-shared'),
  btcSharedHost: document.getElementById('btc-shared-host'),
  btcVpsConsolidate: document.getElementById('btc-vps-consolidate'),
  btcVpsHost: document.getElementById('btc-vps-host'),
  btnBtcVpsSave: document.getElementById('btn-btc-vps-save'),
  btcVpsSaveStatus: document.getElementById('btc-vps-save-status'),
  btcVpsScript: document.getElementById('btc-vps-script'),
  btcVpsTarget: document.getElementById('btc-vps-target'),
  btcVpsSetupScript: document.getElementById('btc-vps-setup-script'),
  btnBtcCopySetup: document.getElementById('btn-btc-copy-setup'),
  btcCopySetupFeedback: document.getElementById('btc-copy-setup-feedback'),
  btnBtcVpsTest: document.getElementById('btn-btc-vps-test'),
  btcVpsTestStatus: document.getElementById('btc-vps-test-status'),
  btnBtcVpsReset: document.getElementById('btn-btc-vps-reset'),
  btnBtcEnable: document.getElementById('btn-btc-enable'),
  btcEnableStatus: document.getElementById('btc-enable-status'),
  btcDotTunnel: document.getElementById('btc-dot-tunnel'),
  btcTunnelText: document.getElementById('btc-tunnel-text'),
  btcTunnelErr: document.getElementById('btc-tunnel-err'),
  btcFirewallCmd: document.getElementById('btc-firewall-cmd'),
  btnBtcCopyFirewall: document.getElementById('btn-btc-copy-firewall'),
  btcCopyFwFeedback: document.getElementById('btc-copy-fw-feedback'),
  btcWhereToPaste: document.getElementById('btc-where-to-paste'),
  btcExternalipLine: document.getElementById('btc-externalip-line'),
  btnBtcCopyLine: document.getElementById('btn-btc-copy-line'),
  btcCopyLineFeedback: document.getElementById('btc-copy-line-feedback'),
  btnBtcAck: document.getElementById('btn-btc-ack'),
  btcAckState: document.getElementById('btc-ack-state'),
  btnBtcVerify: document.getElementById('btn-btc-verify'),
  btcVerifyStatus: document.getElementById('btc-verify-status'),
  btcAdvertising: document.getElementById('btc-advertising'),
  btcStaleWarning: document.getElementById('btc-stale-warning'),
  btcRemotePort: document.getElementById('btc-remote-port'),
  btcTargetHost: document.getElementById('btc-target-host'),
  btcTargetPort: document.getElementById('btc-target-port'),
  btnBtcApplyAdvanced: document.getElementById('btn-btc-apply-advanced'),
  btcAdvancedStatus: document.getElementById('btc-advanced-status'),
  btnBtcDisable: document.getElementById('btn-btc-disable'),
  btcCleanupNote: document.getElementById('btc-cleanup-note'),
  // StartOS 0.4.0 guided flow
  btcStartos: document.getElementById('btc-startos'),
  btcBlockA: document.getElementById('btc-block-a'),
  btnBtcCopyA: document.getElementById('btn-btc-copy-a'),
  btcCopyAFeedback: document.getElementById('btc-copy-a-feedback'),
  btcWgConfig: document.getElementById('btc-wg-config'),
  btnBtcMakeB: document.getElementById('btn-btc-make-b'),
  btcBStatus: document.getElementById('btc-b-status'),
  btcStepB: document.getElementById('btc-step-b'),
  btcBlockB: document.getElementById('btc-block-b'),
  btnBtcCopyB: document.getElementById('btn-btc-copy-b'),
  btcCopyBFeedback: document.getElementById('btc-copy-b-feedback'),
  btcStepVerify: document.getElementById('btc-step-verify'),
  btcVerifyLine: document.getElementById('btc-verify-line'),
  btnBtcStartosVerify: document.getElementById('btn-btc-startos-verify'),
  btcStartosVerifyStatus: document.getElementById('btc-startos-verify-status'),
  btnReset: document.getElementById('btn-reset'),
  // Cleanup (playit orphan tunnels)
  dashboardCleanupLink: document.getElementById('dashboard-cleanup-link'),
  btnOpenCleanup: document.getElementById('btn-open-cleanup'),
  cleanupModal: document.getElementById('cleanup-modal'),
  cleanupLoading: document.getElementById('cleanup-loading'),
  cleanupNone: document.getElementById('cleanup-none'),
  cleanupFound: document.getElementById('cleanup-found'),
  cleanupDeleting: document.getElementById('cleanup-deleting'),
  cleanupResult: document.getElementById('cleanup-result'),
  cleanupList: document.getElementById('cleanup-list'),
  cleanupCount: document.getElementById('cleanup-count'),
  cleanupCountBtn: document.getElementById('cleanup-count-btn'),
  cleanupResultText: document.getElementById('cleanup-result-text'),
  cleanupAgentsNote: document.getElementById('cleanup-agents-note'),
  cleanupAgentCount: document.getElementById('cleanup-agent-count'),
  cleanupAgentsLink: document.getElementById('cleanup-agents-link'),
  btnCleanupConfirm: document.getElementById('btn-cleanup-confirm'),
  btnCleanupCancel: document.getElementById('btn-cleanup-cancel'),
  btnCleanupCloseNone: document.getElementById('btn-cleanup-close-none'),
  btnCleanupCloseResult: document.getElementById('btn-cleanup-close-result'),
  // Teardown (remove HashGG from VPS)
  dashboardTeardownLink: document.getElementById('dashboard-teardown-link'),
  btnOpenTeardown: document.getElementById('btn-open-teardown'),
  teardownModal: document.getElementById('teardown-modal'),
  teardownScriptText: document.getElementById('teardown-script-text'),
  btnCopyTeardown: document.getElementById('btn-copy-teardown'),
  copyTeardownFeedback: document.getElementById('copy-teardown-feedback'),
  btnTeardownClose: document.getElementById('btn-teardown-close'),
  // Additional miners (advanced)
  advancedMiners: document.getElementById('advanced-miners'),
  connectionsList: document.getElementById('connections-list'),
  connectionsEmpty: document.getElementById('connections-empty'),
  btnAddConnection: document.getElementById('btn-add-connection'),
  connectionForm: document.getElementById('connection-form'),
  connName: document.getElementById('conn-name'),
  connIp: document.getElementById('conn-ip'),
  connPort: document.getElementById('conn-port'),
  btnConnSave: document.getElementById('btn-conn-save'),
  btnConnCancel: document.getElementById('btn-conn-cancel'),
  connFormStatus: document.getElementById('conn-form-status'),
  connFirewallNote: document.getElementById('conn-firewall-note'),
  connFirewallCmd: document.getElementById('conn-firewall-cmd'),
  btnCopyFirewall: document.getElementById('btn-copy-firewall'),
  copyFirewallFeedback: document.getElementById('copy-firewall-feedback'),
  // Tunnel choice
  btnChoosePlayit: document.getElementById('btn-choose-playit'),
  btnChooseVps: document.getElementById('btn-choose-vps'),
  // VPS instructions
  btnVpsInstructionsContinue: document.getElementById('btn-vps-instructions-continue'),
  btnVpsInstructionsBack: document.getElementById('btn-vps-instructions-back'),
  // VPS configure (step 1: enter IP)
  inputVpsHost: document.getElementById('input-vps-host'),
  inputVpsSshPort: document.getElementById('input-vps-ssh-port'),
  inputVpsUser: document.getElementById('input-vps-user'),
  inputVpsRemotePort: document.getElementById('input-vps-remote-port'),
  btnVpsConfigureContinue: document.getElementById('btn-vps-configure-continue'),
  btnVpsConfigureBack: document.getElementById('btn-vps-configure-back'),
  // VPS key/script (step 2: run script)
  vpsSshCmd: document.getElementById('vps-ssh-cmd'),
  btnCopySshCmd: document.getElementById('btn-copy-ssh-cmd'),
  copySshCmdFeedback: document.getElementById('copy-ssh-cmd-feedback'),
  vpsScriptText: document.getElementById('vps-script-text'),
  btnCopyScript: document.getElementById('btn-copy-script'),
  copyScriptFeedback: document.getElementById('copy-script-feedback'),
  btnVpsTest: document.getElementById('btn-vps-test'),
  vpsTestStatus: document.getElementById('vps-test-status'),
  btnVpsConnect: document.getElementById('btn-vps-connect'),
  btnVpsKeyBack: document.getElementById('btn-vps-key-back'),
  // VPS connecting
  vpsConnectingDot: document.getElementById('vps-connecting-dot'),
  vpsConnectingText: document.getElementById('vps-connecting-text'),
  btnVpsConnectingCancel: document.getElementById('btn-vps-connecting-cancel'),
  // Error
  errorBar: document.getElementById('error-bar'),
  errorText: document.getElementById('error-text'),
};

// Screen management
function showScreen(name) {
  Object.values(screens).forEach(s => { if (s) s.style.display = 'none'; });
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

// Copy helper. Three paths:
//   1. navigator.clipboard.writeText (modern, requires secure context + iframe clipboard-write permission)
//   2. document.execCommand('copy') via a hidden textarea (legacy fallback)
//   3. If both fail (e.g. embedded in Umbrel's iframe with no clipboard permission),
//      visually select the source element so the user can Ctrl-C manually with one
//      keystroke. The feedback text changes to make that clear.
function copyText(text, feedbackEl, sourceEl) {
  const flashFeedback = (msg) => {
    const originalText = feedbackEl.textContent;
    if (msg) feedbackEl.textContent = msg;
    feedbackEl.style.display = 'inline-block';
    setTimeout(() => {
      feedbackEl.style.display = 'none';
      if (msg) feedbackEl.textContent = originalText;
    }, 3000);
  };

  const tryExec = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  };

  const selectSource = () => {
    if (!sourceEl) return;
    const range = document.createRange();
    range.selectNodeContents(sourceEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => flashFeedback())
      .catch(() => {
        if (tryExec()) flashFeedback();
        else { selectSource(); flashFeedback('Select & Ctrl-C'); }
      });
  } else if (tryExec()) {
    flashFeedback();
  } else {
    selectSource();
    flashFeedback('Select & Ctrl-C');
  }
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

// ─── Status polling ────────────────────────────────────────────────────────────

async function pollStatus() {
  try {
    // Fetch tunnel mode first (cheap)
    const modeRes = await api('GET', '/tunnel/mode');
    const mode = modeRes.mode;
    currentMode = mode;

    if (!mode) {
      // Fresh install — show mode selection
      if (currentScreen !== 'tunnel-choice') showScreen('tunnel-choice');
      return;
    }

    if (mode === 'playit') {
      const status = await api('GET', '/status');
      updatePlayitUI(status);
    } else if (mode === 'vps') {
      const status = await api('GET', '/vps/status');
      // Only drive routing from poll if not in the setup flow
      if (!['vps-instructions', 'vps-key', 'vps-configure'].includes(currentScreen)) {
        updateVpsUI(status);
      }
    }

    // Refresh additional-miner statuses while the dashboard is visible.
    if (currentScreen === 'dashboard') { refreshConnections(); refreshBtcStatus(); }
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

// ─── Playit.gg UI logic ────────────────────────────────────────────────────────

function updatePlayitUI(status) {
  if (!status.has_secret && status.claim_status !== 'pending') {
    showScreen('setup');
    return;
  }
  if (status.claim_status === 'pending') {
    if (currentScreen !== 'claim') showScreen('claim');
    updateClaimUI(status);
    return;
  }
  showScreen('dashboard');
  updateDashboard(status, 'playit');
}

function updateClaimUI(status) {
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

// ─── VPS UI logic ──────────────────────────────────────────────────────────────

function updateVpsUI(status) {
  if (!status.configured) {
    // Not yet configured — start VPS flow from configure (IP entry)
    if (!['vps-configure', 'vps-instructions'].includes(currentScreen)) {
      showScreen('vps-configure');
    }
    return;
  }
  if (status.tunnel_status === 'connected') {
    showScreen('dashboard');
    updateDashboard(status, 'vps');
    return;
  }
  if (currentScreen === 'vps-connecting') {
    // Update connecting screen live
    if (status.tunnel_status === 'error') {
      els.vpsConnectingDot.className = 'dot dot-red';
      els.vpsConnectingText.textContent = status.last_error || 'Connection failed — retrying…';
    } else {
      els.vpsConnectingDot.className = 'dot dot-yellow';
      els.vpsConnectingText.textContent = `Establishing SSH tunnel to ${status.host}…`;
    }
    return;
  }
  // Configured but not connected (connecting / error / disconnected) and not in the
  // setup flow — always land on the dashboard so the live status and the
  // Restart/Reset controls are visible (otherwise the page renders blank on load
  // whenever the tunnel is down, e.g. a changed VPS host key).
  showScreen('dashboard');
  updateDashboard(status, 'vps');
}

// ─── Shared dashboard ─────────────────────────────────────────────────────────

function updateDashboard(status, mode) {
  // Endpoint
  if (status.public_endpoint) {
    const endpoint = `stratum+tcp://${status.public_endpoint}`;
    els.endpointText.textContent = endpoint;
    els.btnCopy.style.display = 'inline-block';
  } else {
    els.endpointText.textContent = mode === 'vps' ? 'Waiting for tunnel…' : 'Waiting for tunnel allocation…';
    els.btnCopy.style.display = 'none';
  }

  if (mode === 'vps') {
    // Tunnel status
    const tsMap = {
      connected:    { dot: 'dot-green', text: `Connected (${status.host})` },
      connecting:   { dot: 'dot-yellow', text: 'Connecting…' },
      error:        { dot: 'dot-red', text: status.last_error ? `Error: ${status.last_error}` : 'Error — retrying…' },
      disconnected: { dot: 'dot-gray', text: 'Disconnected' },
    };
    const ts = tsMap[status.tunnel_status] || { dot: 'dot-gray', text: status.tunnel_status };
    els.dotTunnel.className = `dot ${ts.dot}`;
    els.statusTunnel.textContent = ts.text;

    // Agent = SSH tunnel process
    if (status.tunnel_status === 'connected') {
      els.dotAgent.className = 'dot dot-green';
      els.statusAgent.textContent = `SSH tunnel (${formatUptime(status.uptime)})`;
    } else {
      els.dotAgent.className = 'dot dot-yellow';
      els.statusAgent.textContent = 'SSH tunnel';
    }

    els.btnRestartTunnel.style.display = 'inline-block';
  } else {
    // Playit mode
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

    const agentMap = {
      running: { dot: 'dot-green', text: `Running (${formatUptime(status.uptime)})` },
      starting: { dot: 'dot-yellow', text: 'Starting...' },
      crashed: { dot: 'dot-red', text: 'Error — restarting...' },
      stopped: { dot: 'dot-gray', text: 'Stopped' },
    };
    const agent = agentMap[status.agent_status] || { dot: 'dot-gray', text: status.agent_status };
    els.dotAgent.className = `dot ${agent.dot}`;
    els.statusAgent.textContent = agent.text;

    els.btnRestartTunnel.style.display = 'none';
  }

  // Cleanup link is playit-only (uses the playit account API).
  els.dashboardCleanupLink.style.display = mode === 'playit' ? 'block' : 'none';
  // Teardown link is vps-only (removes HashGG's config from the VPS).
  els.dashboardTeardownLink.style.display = mode === 'vps' ? 'block' : 'none';

  // Datum — same for both modes
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

// ─── Event handlers: Tunnel choice ────────────────────────────────────────────

els.btnChoosePlayit.addEventListener('click', async () => {
  try {
    await api('POST', '/tunnel/mode', { mode: 'playit' });
    currentMode = 'playit';
    showScreen('setup');
  } catch (err) {
    showError('Failed to set tunnel mode: ' + err.message);
  }
});

els.btnChooseVps.addEventListener('click', async () => {
  try {
    await api('POST', '/tunnel/mode', { mode: 'vps' });
    currentMode = 'vps';
    showScreen('vps-instructions');
  } catch (err) {
    showError('Failed to set tunnel mode: ' + err.message);
  }
});

// ─── Event handlers: VPS instructions ────────────────────────────────────────

els.btnVpsInstructionsContinue.addEventListener('click', () => {
  showScreen('vps-configure');
});

els.btnVpsInstructionsBack.addEventListener('click', () => {
  showScreen('tunnel-choice');
});

// ─── Event handlers: VPS configure (step 1) ──────────────────────────────────

els.btnVpsConfigureContinue.addEventListener('click', async () => {
  const host = els.inputVpsHost.value.trim();
  if (!host) { showError('Please enter the VPS IP address'); return; }
  const configBody = buildVpsConfigBody();
  if (!configBody) return;
  try {
    await api('POST', '/vps/configure', configBody);
    // Fetch the setup script (generates keypair if needed)
    const res = await api('GET', '/vps/setup-script');
    if (!res.script) { showError('Failed to load setup script'); return; }
    els.vpsScriptText.textContent = res.script;
    // Build SSH login command
    const sshPort = parseInt(els.inputVpsSshPort.value, 10) || 22;
    const sshCmd = sshPort === 22 ? `ssh root@${host}` : `ssh -p ${sshPort} root@${host}`;
    els.vpsSshCmd.textContent = sshCmd;
    // Clear any stale test status
    els.vpsTestStatus.textContent = '';
    els.vpsTestStatus.className = 'test-status';
    showScreen('vps-key');
  } catch (err) {
    showError('Failed to save config: ' + err.message);
  }
});

els.btnVpsConfigureBack.addEventListener('click', () => {
  showScreen('vps-instructions');
});

// ─── Event handlers: VPS key/script (step 2) ─────────────────────────────────

els.btnCopySshCmd.addEventListener('click', () => {
  copyText(els.vpsSshCmd.textContent, els.copySshCmdFeedback, els.vpsSshCmd);
});

els.btnCopyScript.addEventListener('click', () => {
  copyText(els.vpsScriptText.textContent, els.copyScriptFeedback, els.vpsScriptText);
});

els.btnVpsTest.addEventListener('click', async () => {
  try {
    els.vpsTestStatus.textContent = 'Testing…';
    els.vpsTestStatus.className = 'test-status test-status-pending';
    const res = await api('POST', '/vps/test-connection');
    if (res.success) {
      els.vpsTestStatus.textContent = '✓ Connection successful!';
      els.vpsTestStatus.className = 'test-status test-status-ok';
    } else {
      els.vpsTestStatus.textContent = '✗ ' + (res.error || 'Connection failed');
      els.vpsTestStatus.className = 'test-status test-status-err';
    }
  } catch (err) {
    els.vpsTestStatus.textContent = '✗ Error: ' + err.message;
    els.vpsTestStatus.className = 'test-status test-status-err';
  }
});

els.btnVpsConnect.addEventListener('click', async () => {
  try {
    await api('POST', '/vps/connect');
    showScreen('vps-connecting');
  } catch (err) {
    showError('Failed to connect: ' + err.message);
  }
});

els.btnVpsKeyBack.addEventListener('click', () => {
  showScreen('vps-configure');
});

function buildVpsConfigBody() {
  const host = els.inputVpsHost.value.trim();
  if (!host) { showError('Please enter the VPS IP address'); return null; }
  const body = { host };
  const sshPort = parseInt(els.inputVpsSshPort.value, 10);
  const sshUser = els.inputVpsUser.value.trim();
  const remotePort = parseInt(els.inputVpsRemotePort.value, 10);
  if (sshPort) body.ssh_port = sshPort;
  if (sshUser) body.ssh_user = sshUser;
  if (remotePort) body.remote_port = remotePort;
  return body;
}

// ─── Event handlers: VPS connecting ──────────────────────────────────────────

els.btnVpsConnectingCancel.addEventListener('click', async () => {
  try { await api('POST', '/vps/disconnect'); } catch (_) {}
  showScreen('vps-configure');
});

// ─── Event handlers: Dashboard ────────────────────────────────────────────────

els.btnRestartTunnel.addEventListener('click', async () => {
  try {
    await api('POST', '/vps/disconnect');
    setTimeout(async () => {
      try { await api('POST', '/vps/connect'); } catch (_) {}
    }, 1000);
  } catch (err) {
    showError('Failed to restart tunnel: ' + err.message);
  }
});

// ─── Event handlers: Playit.gg setup ─────────────────────────────────────────

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
  if (!key) { showError('Please enter a secret key'); return; }
  if (!/^[0-9a-fA-F]+$/.test(key)) { showError('Secret key must be a hex string'); return; }
  try {
    await api('POST', '/secret', { secret_key: key });
    els.inputSecret.value = '';
    showScreen('dashboard');
  } catch (err) {
    showError('Failed to save secret key: ' + err.message);
  }
});

els.btnCancelClaim.addEventListener('click', () => { showScreen('setup'); });

// ─── Event handlers: Copy endpoint ───────────────────────────────────────────

els.btnCopy.addEventListener('click', () => {
  copyText(els.endpointText.textContent, els.copyFeedback, els.endpointText);
});

// ─── Event handlers: Reset ───────────────────────────────────────────────────

els.btnReset.addEventListener('click', async () => {
  const mode = currentMode;
  const msg = mode === 'vps'
    ? 'This will disconnect the VPS tunnel and clear all VPS configuration. Continue?'
    : 'This will disconnect the tunnel and clear your playit.gg credentials. Continue?';
  if (!confirm(msg)) return;
  try {
    if (mode === 'vps') {
      await api('POST', '/vps/reset');
      currentMode = null;
      showScreen('tunnel-choice');
    } else {
      await api('POST', '/reset');
      currentMode = null;
      showScreen('tunnel-choice');
    }
  } catch (err) {
    showError('Failed to reset: ' + err.message);
  }
});

// ─── Cleanup: playit.gg orphan tunnels ───────────────────────────────────────

let cleanupOrphanIds = [];

function showCleanupSection(name) {
  const sections = {
    loading: els.cleanupLoading,
    none: els.cleanupNone,
    found: els.cleanupFound,
    deleting: els.cleanupDeleting,
    result: els.cleanupResult,
  };
  Object.values(sections).forEach(s => { if (s) s.style.display = 'none'; });
  if (sections[name]) sections[name].style.display = 'block';
}

function openCleanupModal() {
  els.cleanupModal.style.display = 'flex';
  showCleanupSection('loading');
  scanForCleanup();
}

function closeCleanupModal() {
  els.cleanupModal.style.display = 'none';
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString();
  } catch (_) { return ''; }
}

async function scanForCleanup() {
  try {
    const res = await api('GET', '/playit/cleanup/scan');
    if (res.error) { showError(res.error); closeCleanupModal(); return; }
    const orphans = res.orphan_tunnels || [];
    cleanupOrphanIds = orphans.map(t => t.id);

    if (orphans.length === 0) {
      showCleanupSection('none');
      return;
    }

    els.cleanupCount.textContent = String(orphans.length);
    els.cleanupCountBtn.textContent = String(orphans.length);
    els.cleanupList.innerHTML = '';
    orphans.forEach(t => {
      const li = document.createElement('li');
      const created = formatDate(t.created_at);
      const ep = t.endpoint ? ` · ${t.endpoint}` : '';
      const when = created ? ` · created ${created}` : '';
      li.textContent = `${t.name}${ep}${when}`;
      els.cleanupList.appendChild(li);
    });

    if (res.account_dashboard_url) els.cleanupAgentsLink.href = res.account_dashboard_url;
    const agentCount = (res.orphan_agent_ids || []).length;
    els.cleanupAgentCount.textContent = String(agentCount);
    els.cleanupModal._agentCount = agentCount;

    showCleanupSection('found');
  } catch (err) {
    showError('Scan failed: ' + err.message);
    closeCleanupModal();
  }
}

async function confirmCleanup() {
  showCleanupSection('deleting');
  try {
    const res = await api('POST', '/playit/cleanup/delete', { tunnel_ids: cleanupOrphanIds });
    if (res.error) { showError(res.error); closeCleanupModal(); return; }
    const deleted = res.deleted || 0;
    const failed = (res.results || []).filter(r => !r.deleted).length;
    els.cleanupResultText.textContent = failed
      ? `Deleted ${deleted} tunnel(s). ${failed} could not be deleted — you can try again.`
      : `Deleted ${deleted} tunnel(s).`;
    const agentCount = els.cleanupModal._agentCount || 0;
    els.cleanupAgentsNote.style.display = agentCount > 0 ? 'block' : 'none';
    showCleanupSection('result');
  } catch (err) {
    showError('Delete failed: ' + err.message);
    closeCleanupModal();
  }
}

els.btnOpenCleanup.addEventListener('click', (e) => { e.preventDefault(); openCleanupModal(); });
els.btnCleanupConfirm.addEventListener('click', confirmCleanup);
els.btnCleanupCancel.addEventListener('click', closeCleanupModal);
els.btnCleanupCloseNone.addEventListener('click', closeCleanupModal);
els.btnCleanupCloseResult.addEventListener('click', closeCleanupModal);
els.cleanupModal.addEventListener('click', (e) => {
  if (e.target === els.cleanupModal) closeCleanupModal();
});

// ─── Teardown: remove HashGG from the VPS ─────────────────────────────────────

async function openTeardownModal() {
  els.teardownScriptText.textContent = 'Loading…';
  els.teardownModal.style.display = 'flex';
  try {
    const res = await api('GET', '/vps/teardown-script');
    if (res.error || !res.script) {
      showError(res.error || 'Failed to load teardown script');
      closeTeardownModal();
      return;
    }
    els.teardownScriptText.textContent = res.script;
  } catch (err) {
    showError('Failed to load teardown script: ' + err.message);
    closeTeardownModal();
  }
}

function closeTeardownModal() {
  els.teardownModal.style.display = 'none';
}

els.btnOpenTeardown.addEventListener('click', (e) => { e.preventDefault(); openTeardownModal(); });
els.btnCopyTeardown.addEventListener('click', () => {
  copyText(els.teardownScriptText.textContent, els.copyTeardownFeedback, els.teardownScriptText);
});
els.btnTeardownClose.addEventListener('click', closeTeardownModal);
els.teardownModal.addEventListener('click', (e) => {
  if (e.target === els.teardownModal) closeTeardownModal();
});

// ─── Additional miners (advanced) ─────────────────────────────────────────────

const CONN_STATUS = {
  active:      { dot: 'dot-green',  text: 'Active' },
  pending:     { dot: 'dot-yellow', text: 'Connecting…' },
  unreachable: { dot: 'dot-red',    text: 'Stratum unreachable' },
  error:       { dot: 'dot-red',    text: 'Error' },
};

let connFormBusy = false;

async function refreshConnections() {
  try {
    const res = await api('GET', '/connections');
    renderConnections(res.connections || []);
  } catch (_) { /* non-fatal */ }
}

let lastConnSig = null;

function renderConnections(list) {
  // Skip the rebuild when nothing visible changed, so the 3s poll doesn't wipe
  // a row's "Copied!" feedback or swap the DOM out from under a click.
  const sig = JSON.stringify(list.map((c) =>
    [c.id, c.name, c.local_ip, c.local_port, c.public_endpoint, c.status]));
  if (sig === lastConnSig) return;
  lastConnSig = sig;

  els.connectionsEmpty.style.display = list.length ? 'none' : 'block';
  els.connectionsList.innerHTML = '';

  list.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'connection-row';

    const st = CONN_STATUS[c.status] || { dot: 'dot-gray', text: c.status || '—' };
    const dot = document.createElement('span');
    dot.className = `dot ${st.dot}`;

    const info = document.createElement('div');
    info.className = 'connection-info';
    const title = document.createElement('div');
    title.className = 'connection-name';
    title.textContent = c.name;
    const meta = document.createElement('div');
    meta.className = 'connection-meta';
    const ep = c.public_endpoint ? `stratum+tcp://${c.public_endpoint}` : st.text;
    meta.textContent = `→ ${c.local_ip}:${c.local_port}  ·  ${ep}`;
    info.appendChild(title);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'connection-actions';
    if (c.public_endpoint) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn btn-secondary btn-sm';
      copyBtn.textContent = 'Copy';
      // Per-row feedback element so confirmation appears at the clicked row, and
      // the manual-select fallback (clipboard-blocked iframes) targets this row.
      const rowFeedback = document.createElement('span');
      rowFeedback.className = 'copy-feedback';
      rowFeedback.style.display = 'none';
      rowFeedback.textContent = 'Copied!';
      copyBtn.addEventListener('click', () => {
        copyText(`stratum+tcp://${c.public_endpoint}`, rowFeedback, meta);
      });
      actions.appendChild(copyBtn);
      actions.appendChild(rowFeedback);
    }
    const rmBtn = document.createElement('button');
    rmBtn.className = 'btn btn-danger btn-sm';
    rmBtn.textContent = 'Remove';
    rmBtn.addEventListener('click', () => removeConnection(c));
    actions.appendChild(rmBtn);

    li.appendChild(dot);
    li.appendChild(info);
    li.appendChild(actions);
    els.connectionsList.appendChild(li);
  });
}

function openConnectionForm() {
  els.connFirewallNote.style.display = 'none';
  els.connFormStatus.textContent = '';
  els.connName.value = '';
  els.connIp.value = '';
  els.connPort.value = '';
  els.connectionForm.style.display = 'block';
  els.btnAddConnection.style.display = 'none';
  els.connName.focus();
}

function closeConnectionForm() {
  els.connectionForm.style.display = 'none';
  els.btnAddConnection.style.display = 'inline-block';
  els.connFormStatus.textContent = '';
}

async function saveConnection() {
  if (connFormBusy) return;
  const name = els.connName.value.trim();
  const local_ip = els.connIp.value.trim();
  const local_port = parseInt(els.connPort.value, 10);
  if (!name) { setConnFormStatus('Enter a name', 'err'); return; }
  if (!local_ip) { setConnFormStatus('Enter the stratum IP', 'err'); return; }
  if (!local_port || local_port < 1 || local_port > 65535) { setConnFormStatus('Enter a valid port', 'err'); return; }

  connFormBusy = true;
  setConnFormStatus('Adding…', 'pending');
  try {
    const res = await api('POST', '/connections', { name, local_ip, local_port });
    if (res.error) { setConnFormStatus(res.error, 'err'); connFormBusy = false; return; }
    closeConnectionForm();
    if (res.firewall_cmd) {
      els.connFirewallCmd.textContent = res.firewall_cmd;
      els.connFirewallNote.style.display = 'block';
    }
    refreshConnections();
  } catch (err) {
    setConnFormStatus('Failed: ' + err.message, 'err');
  }
  connFormBusy = false;
}

function setConnFormStatus(msg, kind) {
  els.connFormStatus.textContent = msg;
  els.connFormStatus.className = 'test-status' +
    (kind === 'err' ? ' test-status-err' : kind === 'pending' ? ' test-status-pending' : '');
}

async function removeConnection(c) {
  if (!confirm(`Remove "${c.name}"? Its tunnel will be deleted and miners can no longer connect to it.`)) return;
  try {
    const res = await api('POST', '/connections/delete', { id: c.id });
    if (res.error) { showError(res.error); return; }
    refreshConnections();
  } catch (err) {
    showError('Failed to remove: ' + err.message);
  }
}

els.btnAddConnection.addEventListener('click', openConnectionForm);
els.btnConnCancel.addEventListener('click', closeConnectionForm);
els.btnConnSave.addEventListener('click', saveConnection);
els.btnCopyFirewall.addEventListener('click', () => {
  copyText(els.connFirewallCmd.textContent, els.copyFirewallFeedback, els.connFirewallCmd);
});

// ─── Initialize ───────────────────────────────────────────────────────────────

startPolling();

// ---------------------------------------------------------------------------
// Bitcoin clearnet inbound
// ---------------------------------------------------------------------------

let btcState = null;
let btcBusy = false;
let lastBtcSig = null;

// Where the externalip line has to go, per platform. Named steps rather than a
// generic "edit bitcoin.conf", because the whole point of the feature is that
// the user does not have to know where that file lives.
const BTC_PASTE_INSTRUCTIONS = {
  umbrel: 'Open the <strong>Bitcoin Knots</strong> app → <strong>Settings</strong> → '
        + '<strong>Advanced</strong> → <strong>Custom configuration</strong>, paste the line '
        + 'on its own line, and Save.',
  docker: 'Add the line to your <code>bitcoin.conf</code> and restart Bitcoin.',
};

async function refreshBtcStatus() {
  try {
    btcState = await api('GET', '/btc/status');
    renderBtc(btcState);
  } catch (_) { /* non-fatal — the section just stops updating */ }
}

function renderBtc(d) {
  if (!d) return;

  // Nothing to show unless we found a node (or the platform needs to explain
  // itself). Keeps the dashboard unchanged for everyone else.
  const show = !!d.detected || d.detecting || d.capability !== 'full';
  els.btcSection.style.display = show ? 'block' : 'none';
  if (!show) return;

  // Cheap redraw guard: the 3s poll must not wipe "Copied!" feedback or swap
  // the DOM out from under a click.
  const sig = JSON.stringify([d.capability, d.enabled, d.detecting, d.tunnel_status, d.last_error,
    d.public_endpoint, d.acked, d.verified_at, d.advertising, d.inbound_peers,
    d.advertised_stale, d.verified_endpoint, d.vps_host, d.stratum_vps_host,
    d.detected && d.detected.user_agent]);
  if (sig === lastBtcSig) return;
  lastBtcSig = sig;

  if (d.capability !== 'full') { renderBtcGuidance(d); return; }
  els.btcGuidance.style.display = 'none';

  if (!d.enabled) {
    els.btcIntro.style.display = 'block';
    els.btcChecklist.style.display = 'none';
    els.btcSummaryNote.textContent = d.detected
      ? `· ${shortAgent(d.detected.user_agent)} found, not reachable from the internet`
      : (d.detecting ? '· checking…' : '');
    renderBtcVpsSetup(d);
    return;
  }

  els.btcIntro.style.display = 'none';
  els.btcChecklist.style.display = 'block';

  // Summary line — what the user sees without expanding.
  if (d.verified_at) {
    const peers = (typeof d.inbound_peers === 'number') ? ` · ${d.inbound_peers} inbound` : '';
    els.btcSummaryNote.textContent = `· reachable at ${d.public_endpoint}${peers}`;
  } else {
    els.btcSummaryNote.textContent = `· ${d.tunnel_status}`;
  }

  // Step 1 — tunnel
  const TS = {
    connected: ['dot-green', 'Connected'],
    connecting: ['dot-yellow', 'Connecting…'],
    error: ['dot-red', 'Problem'],
    disconnected: ['dot-gray', 'Not connected'],
  };
  const [dot, text] = TS[d.tunnel_status] || ['dot-gray', d.tunnel_status || '—'];
  els.btcDotTunnel.className = `dot ${dot}`;
  els.btcTunnelText.textContent = text;
  els.btcTunnelErr.style.display = d.last_error ? 'block' : 'none';
  els.btcTunnelErr.textContent = d.last_error || '';

  // Step 2 — firewall one-liner
  const port = d.remote_port || 8333;
  els.btcFirewallCmd.textContent =
    `ufw allow ${port}/tcp comment "HashGG bitcoin p2p"   # or: firewall-cmd --permanent --add-port=${port}/tcp && firewall-cmd --reload`;

  // Step 3 — the line, and where it goes
  els.btcWhereToPaste.innerHTML = BTC_PASTE_INSTRUCTIONS[d.platform] || BTC_PASTE_INSTRUCTIONS.docker;
  els.btcExternalipLine.textContent = d.public_endpoint ? `externalip=${d.public_endpoint}` : '—';
  els.btcAckState.textContent = d.acked ? 'Added' : '';
  els.btcAckState.className = 'test-status' + (d.acked ? ' ok' : '');

  // Step 4 — verification, and the advertisement rung where we can see it
  if (d.verified_at) {
    els.btcVerifyStatus.textContent = `Reachable — ${shortAgent(d.verified_agent)} answered`;
    els.btcVerifyStatus.className = 'test-status ok';
  }
  if (d.advertising === true) {
    els.btcAdvertising.style.display = 'block';
    els.btcAdvertising.innerHTML = `✓ Your node is advertising <code>${d.public_endpoint}</code>.`;
  } else if (d.advertising === false) {
    els.btcAdvertising.style.display = 'block';
    els.btcAdvertising.innerHTML = '⚠ The tunnel works, but your node is not advertising that '
      + 'address yet. Check step 3 saved, and that your node restarted.';
  } else {
    // null means we cannot see it — say nothing rather than imply a problem.
    els.btcAdvertising.style.display = 'none';
  }

  // The advertised address no longer matches the tunnel.
  if (d.advertised_stale) {
    els.btcStaleWarning.style.display = 'block';
    els.btcStaleWarning.innerHTML = '<strong>Your VPS address changed.</strong> The line in your '
      + 'Bitcoin app still points at the old one — update it with the line above.';
  } else {
    els.btcStaleWarning.style.display = 'none';
  }
}

function renderBtcGuidance(d) {
  els.btcIntro.style.display = 'none';
  els.btcChecklist.style.display = 'none';
  els.btcGuidance.style.display = 'block';
  // On this path HashGG owns no tunnel, so a completed setup would otherwise
  // leave no trace after a reload — on the longest flow of the three.
  els.btcSummaryNote.textContent = d.verified_endpoint
    ? `· reachable at ${d.verified_endpoint}`
    : (d.detected ? `· ${shortAgent(d.detected.user_agent)} found` : '');

  els.btcStartos.style.display = (d.capability === 'guided') ? 'block' : 'none';
  if (d.capability === 'guided') {
    loadBlockA();
    els.btcGuidance.innerHTML = `
      <p><strong>StartOS can do this itself, and does it better than HashGG could.</strong>
      It preserves each peer's real IP address, and configures your node for you.</p>
      <p>You will need a second VPS running <strong>StartTunnel</strong> — separate from the one
      carrying your mining tunnel, because StartTunnel takes over the firewall on whatever
      machine it runs on.</p>
      <p class="hint">HashGG writes the commands for you below — StartOS then opens the port
      and tells your node to advertise it, so there is no config line to paste.</p>
      <p class="hint"><strong>No VPS needed if your ISP doesn't use CGNAT:</strong> forward the port
      on your router and switch on the router gateway's public IP instead. That exposes your home
      IP, which the VPS route avoids — a real trade, not a worse option.</p>`;
  } else {
    els.btcGuidance.innerHTML = `
      <p>On this version of StartOS, the Bitcoin package rewrites its configuration every time it
      starts and only ever advertises its Tor address. There is no way to tell it about a public
      address, so HashGG cannot help here.</p>
      <p class="hint">Upgrading to StartOS 0.4.0 enables this. If your Bitcoin node runs on a
      different machine, you can point HashGG at it instead.</p>`;
  }
}

// "/Satoshi:29.3.0/Knots:20260508/" -> "Knots 29.3.0"
function shortAgent(ua) {
  if (!ua) return 'your node';
  const knots = /Knots:/.test(ua);
  const ver = (ua.match(/Satoshi:([0-9.]+)/) || [])[1];
  return (knots ? 'Knots' : 'Bitcoin Core') + (ver ? ` ${ver}` : '');
}

function setBtcStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = 'test-status' + (kind ? ` ${kind}` : '');
}

async function btcEnable() {
  if (btcBusy) return;
  btcBusy = true;
  setBtcStatus(els.btcEnableStatus, 'Setting up…', '');
  try {
    await api('POST', '/btc/enable', {});
    lastBtcSig = null;
    await refreshBtcStatus();
    setBtcStatus(els.btcEnableStatus, '', '');
  } catch (err) {
    setBtcStatus(els.btcEnableStatus, err.message, 'err');
  } finally { btcBusy = false; }
}

async function btcDisable() {
  if (btcBusy) return;
  btcBusy = true;
  try {
    const r = await api('POST', '/btc/disable', {});
    const line = r.cleanup && r.cleanup.externalip_line;
    els.btcCleanupNote.style.display = 'block';
    els.btcCleanupNote.innerHTML = '<strong>Two things left to tidy up.</strong>'
      + (line ? `<br>1. Remove <code>${line}</code> from your Bitcoin app's configuration —
           otherwise your node keeps advertising an address that no longer works.` : '')
      + `<br>${line ? '2.' : '1.'} Optional: close the port on your VPS with
           <code>ufw delete allow ${(r.cleanup && r.cleanup.remote_port) || 8333}/tcp</code>.`;
    lastBtcSig = null;
    await refreshBtcStatus();
  } catch (err) {
    showError(err.message);
  } finally { btcBusy = false; }
}

async function btcVerify() {
  if (btcBusy) return;
  btcBusy = true;
  setBtcStatus(els.btcVerifyStatus, 'Checking from the internet…', '');
  try {
    const r = await api('POST', '/btc/verify', {});
    if (r.ok) {
      setBtcStatus(els.btcVerifyStatus,
        `Reachable — ${shortAgent(r.user_agent)} answered`, 'ok');
      if (r.warning) setBtcStatus(els.btcVerifyStatus, r.warning, 'err');
    } else {
      setBtcStatus(els.btcVerifyStatus, verifyHint(r.error), 'err');
    }
    lastBtcSig = null;
    await refreshBtcStatus();
  } catch (err) {
    setBtcStatus(els.btcVerifyStatus, err.message, 'err');
  } finally { btcBusy = false; }
}

// A raw socket error tells the user nothing about which link broke. Name the
// most likely cause for the two that actually happen.
function verifyHint(raw) {
  if (/timed out/i.test(raw || '')) {
    return "No answer. The port is probably still closed on your VPS — check step 2, "
         + "and your provider's own firewall panel.";
  }
  if (/ECONNREFUSED|refused/i.test(raw || '')) {
    return 'Your VPS refused the connection — the tunnel may not be up yet. Give it a moment.';
  }
  return raw || 'Could not reach your node from the internet.';
}

async function btcAck() {
  try {
    await api('POST', '/btc/ack', {});
    lastBtcSig = null;
    await refreshBtcStatus();
  } catch (err) { showError(err.message); }
}

async function btcApplyAdvanced() {
  if (btcBusy) return;
  btcBusy = true;
  setBtcStatus(els.btcAdvancedStatus, 'Applying…', '');
  const body = {};
  const rp = parseInt(els.btcRemotePort.value, 10);
  if (rp) body.remote_port = rp;
  const th = els.btcTargetHost.value.trim();
  if (th) { body.target_host = th; body.target_port = parseInt(els.btcTargetPort.value, 10) || 8333; }
  try {
    await api('POST', '/btc/enable', body);
    setBtcStatus(els.btcAdvancedStatus, 'Applied', 'ok');
    lastBtcSig = null;
    await refreshBtcStatus();
  } catch (err) {
    setBtcStatus(els.btcAdvancedStatus, err.message, 'err');
  } finally { btcBusy = false; }
}

els.btnBtcEnable.addEventListener('click', btcEnable);
els.btnBtcDisable.addEventListener('click', btcDisable);
els.btnBtcVerify.addEventListener('click', btcVerify);
els.btnBtcAck.addEventListener('click', btcAck);
els.btnBtcApplyAdvanced.addEventListener('click', btcApplyAdvanced);
els.btnBtcCopyFirewall.addEventListener('click', () =>
  copyText(els.btcFirewallCmd.textContent, els.btcCopyFwFeedback, els.btnBtcCopyFirewall));
els.btnBtcCopyLine.addEventListener('click', () =>
  copyText(els.btcExternalipLine.textContent, els.btcCopyLineFeedback, els.btnBtcCopyLine));

// --- The P2P endpoint's own VPS -------------------------------------------
//
// Deliberately inline rather than the full-screen VPS onboarding: that flow
// belongs to mining, and threading a scope through it would put the mining path
// one bad branch away from breaking. This is an advanced sub-flow and should not
// hijack the whole app anyway.

function renderBtcVpsSetup(d) {
  const configured = !!d.vps_host;
  els.btcVpsSetup.style.display = configured ? 'none' : 'block';
  els.btcVpsScript.style.display = configured ? 'block' : 'none';
  // Nothing to enable until there is a VPS to enable it on.
  els.btnBtcEnable.disabled = !configured;

  if (configured) {
    els.btcVpsTarget.textContent = d.vps_host;
    loadBtcSetupScript();
    return;
  }

  const canShare = !!d.stratum_vps_host;
  els.btcVpsShare.style.display = canShare ? 'block' : 'none';
  if (canShare) els.btcSharedHost.textContent = d.stratum_vps_host;
  // Worth saying once, not nagging: someone renting a VPS for this while paying
  // for playit can usually consolidate onto one machine.
  els.btcVpsConsolidate.style.display = (!canShare && currentMode === 'playit') ? 'block' : 'none';
}

let btcSetupScriptFor = null;
async function loadBtcSetupScript() {
  const host = btcState && btcState.vps_host;
  if (!host || btcSetupScriptFor === host) return;
  try {
    const r = await api('GET', '/btc/vps/setup-script');
    els.btcVpsSetupScript.textContent = r.script;
    btcSetupScriptFor = host;
  } catch (err) {
    els.btcVpsSetupScript.textContent = `Could not generate the script: ${err.message}`;
  }
}

async function btcVpsConfigure(body, statusEl) {
  setBtcStatus(statusEl, 'Saving…', '');
  try {
    await api('POST', '/btc/vps/configure', body);
    btcSetupScriptFor = null;
    lastBtcSig = null;
    await refreshBtcStatus();
    setBtcStatus(statusEl, '', '');
  } catch (err) {
    setBtcStatus(statusEl, err.message, 'err');
  }
}

async function btcVpsTest() {
  setBtcStatus(els.btcVpsTestStatus, 'Connecting…', '');
  try {
    const r = await api('POST', '/btc/vps/test-connection', {});
    setBtcStatus(els.btcVpsTestStatus,
      r.success ? 'Connected — your VPS is ready' : (r.error || 'Could not connect'),
      r.success ? 'ok' : 'err');
  } catch (err) {
    setBtcStatus(els.btcVpsTestStatus, err.message, 'err');
  }
}

async function btcVpsReset() {
  try {
    const r = await api('POST', '/btc/vps/reset', {});
    if (r.cleanup && r.cleanup.externalip_line) {
      els.btcCleanupNote.style.display = 'block';
      els.btcCleanupNote.innerHTML = `<strong>One thing left to tidy up.</strong><br>Remove
        <code>${r.cleanup.externalip_line}</code> from your Bitcoin app's configuration —
        it points at a VPS you are no longer using.`;
    }
    btcSetupScriptFor = null;
    lastBtcSig = null;
    await refreshBtcStatus();
  } catch (err) { showError(err.message); }
}

els.btnBtcUseShared.addEventListener('click', () =>
  btcVpsConfigure({ source: 'shared' }, els.btcVpsSaveStatus));
els.btnBtcVpsSave.addEventListener('click', () => {
  const h = els.btcVpsHost.value.trim();
  if (!h) { setBtcStatus(els.btcVpsSaveStatus, 'Enter your VPS address', 'err'); return; }
  btcVpsConfigure({ source: 'own', host: h }, els.btcVpsSaveStatus);
});
els.btnBtcVpsTest.addEventListener('click', btcVpsTest);
els.btnBtcVpsReset.addEventListener('click', btcVpsReset);
els.btnBtcCopySetup.addEventListener('click', () =>
  copyText(els.btcVpsSetupScript.textContent, els.btcCopySetupFeedback, els.btnBtcCopySetup));

// --- StartOS 0.4.0: the generated setup blocks ------------------------------

let btcBlockALoaded = false;

async function loadBlockA() {
  if (btcBlockALoaded) return;
  try {
    const r = await api('GET', '/btc/startos/block-a');
    els.btcBlockA.textContent = r.script;
    btcBlockALoaded = true;
  } catch (err) {
    els.btcBlockA.textContent = `Could not generate the script: ${err.message}`;
  }
}

async function makeBlockB() {
  const cfg = els.btcWgConfig.value;
  if (!cfg.trim()) { setBtcStatus(els.btcBStatus, 'Paste the configuration first', 'err'); return; }
  setBtcStatus(els.btcBStatus, 'Checking…', '');
  try {
    const r = await api('POST', '/btc/startos/block-b', { wg_config: cfg });
    els.btcBlockB.textContent = r.script;
    els.btcStepB.style.display = 'list-item';
    els.btcStepVerify.style.display = 'list-item';
    setBtcStatus(els.btcBStatus, '', '');
  } catch (err) {
    // Validation failures are the interesting case: the message explains what
    // was wrong with the paste, not that "something failed".
    setBtcStatus(els.btcBStatus, err.message, 'err');
  }
}

async function startosVerify() {
  const line = els.btcVerifyLine.value;
  if (!line.trim()) { setBtcStatus(els.btcStartosVerifyStatus, 'Paste the line first', 'err'); return; }
  setBtcStatus(els.btcStartosVerifyStatus, 'Checking from the internet…', '');
  try {
    const r = await api('POST', '/btc/startos/verify', { line });
    if (r.ok) {
      setBtcStatus(els.btcStartosVerifyStatus,
        `Reachable at ${r.host}:${r.port} — ${shortAgent(r.user_agent)} answered. Your node is on clearnet.`, 'ok');
    } else {
      setBtcStatus(els.btcStartosVerifyStatus, verifyHint(r.error), 'err');
    }
  } catch (err) {
    setBtcStatus(els.btcStartosVerifyStatus, err.message, 'err');
  }
}

els.btnBtcMakeB.addEventListener('click', makeBlockB);
els.btnBtcStartosVerify.addEventListener('click', startosVerify);
els.btnBtcCopyA.addEventListener('click', () =>
  copyText(els.btcBlockA.textContent, els.btcCopyAFeedback, els.btnBtcCopyA));
els.btnBtcCopyB.addEventListener('click', () =>
  copyText(els.btcBlockB.textContent, els.btcCopyBFeedback, els.btnBtcCopyB));
