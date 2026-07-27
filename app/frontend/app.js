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
  // Bitcoin reachability wizard. Additive: the mining screens above and the
  // router itself are untouched.
  'btc-intro': document.getElementById('screen-btc-intro'),
  'btc-vps': document.getElementById('screen-btc-vps'),
  'btc-login': document.getElementById('screen-btc-login'),
  'btc-paste': document.getElementById('screen-btc-paste'),
  'btc-working': document.getElementById('screen-btc-working'),
  'btc-manual': document.getElementById('screen-btc-manual'),
  'btc-startos': document.getElementById('screen-btc-startos'),
  'btc-done': document.getElementById('screen-btc-done'),
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
  resetCleanupNote: document.getElementById('reset-cleanup-note'),
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
  btnBtcWizLaunch: document.getElementById('btn-btc-wiz-launch'),
  btnBtcWizResult: document.getElementById('btn-btc-wiz-result'),
  btnBtcWizAgain: document.getElementById('btn-btc-wiz-again'),
  btnBtcWizStart: document.getElementById('btn-btc-wiz-start'),
  btnBtcWizToLogin: document.getElementById('btn-btc-wiz-to-login'),
  btnBtcWizToPaste: document.getElementById('btn-btc-wiz-to-paste'),
  btnBtcWizRun: document.getElementById('btn-btc-wiz-run'),
  btnBtcWizRetry: document.getElementById('btn-btc-wiz-retry'),
  btnBtcWizManual: document.getElementById('btn-btc-wiz-manual'),
  btcLoginRest: document.getElementById('btc-login-rest'),
  btcStartosSsh: document.getElementById('btc-startos-ssh'),
  btcStartosSshNote: document.getElementById('btc-startos-ssh-note'),
  btnBtcCopySos: document.getElementById('btn-btc-copy-sos'),
  btcCopySosFeedback: document.getElementById('btc-copy-sos-feedback'),
  btcDoneEndpoint: document.getElementById('btc-done-endpoint'),
  btcDoneAgent: document.getElementById('btc-done-agent'),
  btcCleanupWarn: document.getElementById('btc-cleanup-warn'),
  btcIntroReplace: document.getElementById('btc-intro-replace'),
  btnBtcRecheck: document.getElementById('btn-btc-recheck'),
  btcRecheckStatus: document.getElementById('btc-recheck-status'),
  btcVpsIp: document.getElementById('btc-vps-ip'),
  btcSshCmd: document.getElementById('btc-ssh-cmd'),
  btnBtcCopySsh: document.getElementById('btn-btc-copy-ssh'),
  btcCopySshFeedback: document.getElementById('btc-copy-ssh-feedback'),
  btcIpStatus: document.getElementById('btc-ip-status'),
  btcSetupStatus: document.getElementById('btc-setup-status'),
  btcSetupLog: document.getElementById('btc-setup-log'),
  btnBtcStartosCleanup: document.getElementById('btn-btc-startos-cleanup'),
  btcCleanupStatus: document.getElementById('btc-cleanup-status'),
  btcBlockA: document.getElementById('btc-block-a'),
  btnBtcCopyA: document.getElementById('btn-btc-copy-a'),
  btcCopyAFeedback: document.getElementById('btc-copy-a-feedback'),
  btcWgConfig: document.getElementById('btc-wg-config'),
  btnBtcMakeB: document.getElementById('btn-btc-make-b'),
  btcBStatus: document.getElementById('btc-b-status'),
  btcBlockB: document.getElementById('btc-block-b'),
  btnBtcCopyB: document.getElementById('btn-btc-copy-b'),
  btcCopyBFeedback: document.getElementById('btc-copy-b-feedback'),
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
// True only while deliberately leaving the Bitcoin wizard — see the guard below.
let btcWizLeaving = false;

function showScreen(name) {
  // The status poll routes screens every few seconds, and it does not know the
  // Bitcoin wizard exists — so it would drag the user back to the dashboard
  // mid-setup, which is exactly what it did. Ignore routing OUT of the wizard
  // unless the wizard itself asked for it.
  if (!btcWizLeaving
      && String(currentScreen).startsWith('btc-')
      && !String(name).startsWith('btc-')) {
    return;
  }
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
  let msg = mode === 'vps'
    ? 'This will disconnect the VPS tunnel and clear all VPS configuration. Continue?'
    : 'This will disconnect the tunnel and clear your playit.gg credentials. Continue?';
  // Warn BEFORE, not only after: a reset leaves the user's node advertising an
  // address that is about to stop working, and only they can undo that. Saying
  // it up front is the half that survives them navigating away afterwards.
  if (btcState && btcState.acked) {
    msg += '\n\nYour Bitcoin node is also advertising a public address through HashGG. '
         + 'After this you will need to remove that line from your node\'s configuration.';
  }
  if (!confirm(msg)) return;
  try {
    if (mode === 'vps') {
      // Stratum-only: deliberately does not touch the Bitcoin P2P record.
      await api('POST', '/vps/reset');
      currentMode = null;
      showScreen('tunnel-choice');
    } else {
      const r = await api('POST', '/reset');
      currentMode = null;
      showScreen('tunnel-choice');
      const line = r && r.btc_cleanup && r.btc_cleanup.externalip_line;
      if (line) {
        els.resetCleanupNote.style.display = 'block';
        els.resetCleanupNote.innerHTML = '<strong>One thing left to do.</strong> Remove '
          + `<code>${line}</code> from your Bitcoin node's configuration — it points at a `
          + 'tunnel that no longer exists, and your node will keep advertising it until you do.';
      }
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
  // `d.enabled` matters as much as detection: a node that stops answering must
  // not take the section away with it, or the user is left with a live tunnel
  // they can neither see nor switch off.
  const show = !!d.detected || d.detecting || d.enabled || d.capability !== 'full';
  els.btcSection.style.display = show ? 'block' : 'none';
  if (!show) return;

  // Cheap redraw guard: the 3s poll must not wipe "Copied!" feedback or swap
  // the DOM out from under a click.
  const sig = JSON.stringify([d.capability, d.enabled, d.detecting, !!d.detected,
    d.tunnel_status, d.last_error,
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
  // Past verification is not present reachability. The collapsed line is all
  // most people ever read, so it must not claim "reachable" while the tunnel is
  // down — that is the one place a stale ✓ would be believed without question.
  if (d.verified_at && d.tunnel_status === 'connected') {
    const peers = (typeof d.inbound_peers === 'number') ? ` · ${d.inbound_peers} inbound` : '';
    els.btcSummaryNote.textContent = `· reachable at ${d.public_endpoint}${peers}`;
  } else if (d.verified_at) {
    els.btcSummaryNote.textContent = `· tunnel ${d.tunnel_status} — not reachable right now`;
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
  // A connected tunnel to a node that has stopped answering is the one state
  // where everything looks fine and nothing works: peers reach the VPS and get
  // refused at the far end. The tunnel is genuinely up, so this is a note about
  // the node rather than an error about the tunnel.
  const nodeQuiet = d.tunnel_status === 'connected' && !d.detected && !d.detecting;
  if (d.last_error) {
    els.btcTunnelErr.style.display = 'block';
    els.btcTunnelErr.textContent = d.last_error;
  } else if (nodeQuiet) {
    els.btcTunnelErr.style.display = 'block';
    els.btcTunnelErr.textContent = 'The tunnel is up, but your Bitcoin node is not answering. '
      + 'If it is restarting this will clear on its own.';
  } else {
    els.btcTunnelErr.style.display = 'none';
    els.btcTunnelErr.textContent = '';
  }

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
  // "verified at <ip>" was read as a status nobody could interpret — is that
  // working or not? Say plainly that it is on, and carry the age of the check
  // instead of hedging the verb: StartOS owns the tunnel here, so there is no
  // live signal, and a timestamp says how much to trust it without asking the
  // reader to parse a tense.
  els.btcSummaryNote.textContent = d.verified_endpoint
    ? `· Already done! Reachable at ${d.verified_endpoint}`
      + `${d.verified_at ? ` · checked ${relAge(d.verified_at)}` : ''}`
    : (d.detected ? `· ${shortAgent(d.detected.user_agent)} found` : '');

  els.btcStartos.style.display = (d.capability === 'guided') ? 'block' : 'none';
  if (d.capability === 'guided') {
    // One button per state rather than one that guesses. "Set this up" opening
    // a page that says it is already set up is how it read before.
    const done = !!d.verified_endpoint;
    els.btnBtcWizLaunch.style.display = done ? 'none' : 'inline-block';
    els.btnBtcWizResult.style.display = done ? 'inline-block' : 'none';
    els.btcGuidance.innerHTML = `
      <p><strong>StartOS can do this itself, and does it better than HashGG could.</strong>
      It keeps each peer's real address, and sets up your node for you.</p>

      <div class="hint-box">
        <p><strong>Check this first — you may not need any of it.</strong></p>
        <p>Many home internet connections can already accept incoming connections. If yours
        can, StartOS will do the whole thing for you, and <strong>you can ignore the rest of
        this page</strong> — no VPS, nothing to buy, nothing to paste.</p>
        <p>To find out, open your <strong>Bitcoin Knots</strong> service, go to
        <strong>Interfaces → Peer</strong>, and see whether a <strong>public IP address</strong>
        is listed. If one is, switch it on — StartOS will ask your router to open the port for
        you, and often that is all it takes.</p>
        <p>If your router refuses, the only way on from there is to set up
        <strong>port forwarding</strong> in the router's own settings by hand. That is different
        on every router, it is the part most people would rather not touch, and the steps below
        avoid it completely.</p>
        <p>If no public address is listed at all, your internet provider does not give you one
        that can receive connections — the steps below are the way around that too.</p>
        <p class="hint">Worth knowing either way: using your own connection shows your home IP
        address to the nodes that connect to you. The VPS steps below hide it. Neither is wrong
        — pick whichever you prefer.</p>
      </div>

      <p>If you do need the steps below, you will need a <strong>second VPS</strong> — a rented
      Linux machine, separate from the one carrying your mining tunnel. It has to be a machine of
      its own, because what we install takes over that machine's firewall.</p>
      <p><strong>Get a blank one — you do not set anything up on it yourself.</strong> The first
      step below installs and configures everything for you, including <strong>StartTunnel</strong>,
      the Start9 software that links the VPS to your server.</p>
      <p class="hint"><strong>Where to get one:</strong> this needs a steady address and generous
      data transfer, not a fast machine. We suggest
      <a href="https://btcvps.com/new-server/VPS2?months=1" target="_blank" rel="noopener">BTCVPS's €6/month plan</a> — the same
      provider we suggest for the mining tunnel, paid in Bitcoin, and its 4&nbsp;TB of monthly
      transfer is ample for a Bitcoin node. That link goes straight to the right plan; the site's
      own pricing page highlights the €12 one, which you do not need. When you order it, choose
      <strong>Debian</strong> as the operating system — Ubuntu will not work here.</p>
      <p class="hint">After that, HashGG writes the commands for you, and StartOS opens the port
      and tells your node to advertise it.</p>`;
  } else {
    els.btcGuidance.innerHTML = `
      <p>On this version of StartOS, the Bitcoin package rewrites its configuration every time it
      starts and only ever advertises its Tor address. There is no way to tell it about a public
      address, so HashGG cannot help here.</p>
      <p class="hint">Upgrading to StartOS 0.4.0 enables this.</p>`;
  }
}

// "2026-07-26T12:00:00Z" -> "2 hours ago". Deliberately coarse: the point is
// whether the check is recent, not when exactly it happened.
function relAge(iso) {
  const then = Date.parse(iso);
  if (!then) return 'recently';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
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

// --- Bitcoin reachability wizard (StartOS 0.4.0) ---------------------------
//
// A wizard, not an inline checklist. The steps are linear, done once, and each
// is a different kind of work — buy a machine, log into it, wait, then run
// commands on a different machine entirely. Stacked on one page they extended it
// downward until finishing a step looked like more of the same, and people could
// not tell they had succeeded.

let btcWizReturn = 'dashboard';

// The browser is already talking to StartOS, so its own address usually carries
// the server name — filling it in beats asking someone to substitute a
// placeholder they have to go and look up. Falls back to the placeholder when
// reached by IP or over Tor, where the name is genuinely not knowable.
function fillStartosSshCmd() {
  const m = String(location.hostname || '').match(/^(?:.*\.)?([a-z0-9-]+)\.local$/i);
  if (m && m[1] && m[1] !== 'localhost') {
    els.btcStartosSsh.textContent = `ssh start9@${m[1]}.local`;
    els.btcStartosSshNote.style.display = 'none';
  } else {
    els.btcStartosSsh.textContent = 'ssh start9@your-server.local';
    els.btcStartosSshNote.style.display = 'block';
  }
}

function btcWizGo(name) {
  if (name === 'btc-startos') fillStartosSshCmd();
  // Arriving at the intro with a VPS already recorded means this is a move, not
  // a first run, and the old gateway has to go first.
  if (name === 'btc-intro') {
    els.btcIntroReplace.style.display =
      (btcState && btcState.vps_host) ? 'block' : 'none';
  }
  btcWizLeaving = !String(name).startsWith('btc-');
  showScreen(name);
  btcWizLeaving = false;
  window.scrollTo(0, 0);
}

function btcWizLaunch() {
  btcWizReturn = currentScreen || 'dashboard';
  btcWizGo('btc-intro');
}

// Reached from the dashboard when this is already working — a different button
// with a different label, rather than one button that guesses.
function btcWizShowResult() {
  btcWizReturn = currentScreen || 'dashboard';
  btcShowDone(btcState && btcState.verified_endpoint,
              btcState && btcState.verified_agent,
              btcState && btcState.verified_at);
}

function btcShowDone(endpoint, agent, checkedAt, justFinished) {
  els.btcDoneEndpoint.textContent = endpoint || '—';
  const who = agent ? `${shortAgent(agent)} answered from the internet` : 'Your node answered from the internet';
  els.btcDoneAgent.textContent = checkedAt ? `${who}, checked ${relAge(checkedAt)}.` : `${who}.`;
  setBtcStatus(els.btcRecheckStatus, '', '');
  els.btcCleanupWarn.style.display = 'none';
  btcWizGo('btc-done');
  // Only after a run we just completed. Arriving here from the dashboard means
  // the access was withdrawn long ago, and trying again would fail and raise an
  // alarm about something already handled.
  if (justFinished) btcStartosCleanup(true);
}

// The claim on the dashboard is only as good as the last check, so let people
// make a new one rather than take it on trust.
async function btcRecheck() {
  setBtcStatus(els.btcRecheckStatus, 'Checking from the internet…', '');
  try {
    const r = await api('POST', '/btc/verify', {});
    if (r.ok && !r.warning) {
      setBtcStatus(els.btcRecheckStatus, 'Still reachable', 'ok');
      lastBtcSig = null;
      await refreshBtcStatus();
    } else {
      setBtcStatus(els.btcRecheckStatus, r.warning || verifyHint(r.error), 'err');
    }
  } catch (err) {
    setBtcStatus(els.btcRecheckStatus, err.message, 'err');
  }
}

// --- the generated blocks ---

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
    setBtcStatus(els.btcBStatus, '', '');
    btcWizGo('btc-startos');
  } catch (err) {
    setBtcStatus(els.btcBStatus, err.message, 'err');
  }
}

async function startosVerify() {
  const line = els.btcVerifyLine.value;
  if (!line.trim()) { setBtcStatus(els.btcStartosVerifyStatus, 'Paste the line first', 'err'); return; }
  setBtcStatus(els.btcStartosVerifyStatus, 'Checking from the internet…', '');
  try {
    const r = await api('POST', '/btc/startos/verify', { line });
    if (r.ok && !r.warning) {
      lastBtcSig = null;
      await refreshBtcStatus();
      btcShowDone(`${r.host}:${r.port}`, r.user_agent, new Date().toISOString(), true);
    } else {
      setBtcStatus(els.btcStartosVerifyStatus, r.warning || verifyHint(r.error), 'err');
    }
  } catch (err) {
    setBtcStatus(els.btcStartosVerifyStatus, err.message, 'err');
  }
}

// --- the address, and the login command built from it ---

function updateBtcSshCmd() {
  const ip = els.btcVpsIp.value.trim();
  els.btcSshCmd.textContent = ip ? `ssh root@${ip}` : 'ssh root@…';
}

// Catch here what would otherwise fail much later and less clearly. A private
// address is the common mistake — someone reads their own LAN address off the
// wrong page — and the VPS pre-flight refuses that machine anyway.
function btcIpProblem(raw) {
  const v = String(raw || '').trim();
  if (!v) return 'Enter the IP address from the Manage page.';
  if (v.length > 255 || v[0] === '-' || !/^[a-zA-Z0-9.\-:]+$/.test(v)) {
    return 'That does not look like an IP address.';
  }
  if (/^[\d.]+$/.test(v)) {
    const parts = v.split('.');
    if (parts.length !== 4 || parts.some((n) => !/^\d{1,3}$/.test(n) || Number(n) > 255)) {
      return 'That does not look like an IP address.';
    }
    if (/^10\./.test(v) || /^192\.168\./.test(v) || /^172\.(1[6-9]|2\d|3[01])\./.test(v)
        || /^127\./.test(v) || /^169\.254\./.test(v)
        || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) {
      return 'That is a private address, not a public one. Your VPS has its own public IP '
           + 'address — check the Manage page.';
    }
  }
  return null;
}

els.btcVpsIp.addEventListener('input', () => {
  updateBtcSshCmd();
  setBtcStatus(els.btcIpStatus, '', '');
  els.btcLoginRest.style.display = btcIpProblem(els.btcVpsIp.value) ? 'none' : 'block';
});

// --- HashGG runs the VPS setup itself ---
//
// The slow, failure-prone half now belongs to software. A first install pulls
// packages over a new VPS's network: minutes, and failures that want a retry
// rather than a paragraph of instructions.

let btcSetupPoll = null;

function btcSetupControls(show) {
  els.btnBtcWizRetry.style.display = show ? 'inline-block' : 'none';
  els.btnBtcWizManual.style.display = show ? 'inline-block' : 'none';
  document.querySelectorAll('#screen-btc-working .btc-wiz-back')
    .forEach((b) => { b.style.display = show ? 'inline-block' : 'none'; });
}

async function pollBtcSetup() {
  try {
    const r = await api('GET', '/btc/startos/setup-status');
    if (r.lines && r.lines.length) els.btcSetupLog.textContent = r.lines.join('\n');
    if (r.state === 'running') return;

    clearInterval(btcSetupPoll); btcSetupPoll = null;

    if (r.state === 'done' && r.script) {
      els.btcBlockB.textContent = r.script;
      setBtcStatus(els.btcSetupStatus, '', '');
      btcWizGo('btc-startos');
    } else {
      setBtcStatus(els.btcSetupStatus, r.error || 'The setup did not finish.', 'err');
      btcSetupControls(true);
    }
  } catch (err) {
    clearInterval(btcSetupPoll); btcSetupPoll = null;
    setBtcStatus(els.btcSetupStatus, err.message, 'err');
    btcSetupControls(true);
  }
}

async function btcRunSetup() {
  const host = els.btcVpsIp.value.trim();
  const problem = btcIpProblem(host);
  btcWizGo('btc-working');
  btcSetupControls(false);
  els.btcSetupLog.textContent = '';
  if (problem) { setBtcStatus(els.btcSetupStatus, problem, 'err'); btcSetupControls(true); return; }
  setBtcStatus(els.btcSetupStatus, 'Working…', '');
  try {
    await api('POST', '/btc/startos/setup', { host });
    if (btcSetupPoll) clearInterval(btcSetupPoll);
    btcSetupPoll = setInterval(pollBtcSetup, 1500);
    pollBtcSetup();
  } catch (err) {
    setBtcStatus(els.btcSetupStatus, err.message, 'err');
    btcSetupControls(true);
  }
}

async function btcStartosCleanup(silent) {
  if (!silent) setBtcStatus(els.btcCleanupStatus, 'Removing…', '');
  try {
    const r = await api('POST', '/btc/startos/cleanup', {});
    if (r.ok) { els.btcCleanupWarn.style.display = 'none'; return; }
    els.btcCleanupWarn.style.display = 'block';
    setBtcStatus(els.btcCleanupStatus, r.error || '', 'err');
  } catch (err) {
    els.btcCleanupWarn.style.display = 'block';
    setBtcStatus(els.btcCleanupStatus, err.message, 'err');
  }
}

// --- navigation ---

els.btnBtcWizLaunch.addEventListener('click', btcWizLaunch);
els.btnBtcWizResult.addEventListener('click', btcWizShowResult);
els.btnBtcWizAgain.addEventListener('click', () => btcWizGo('btc-intro'));
els.btnBtcRecheck.addEventListener('click', btcRecheck);
els.btnBtcWizStart.addEventListener('click', () => btcWizGo('btc-vps'));
els.btnBtcWizToLogin.addEventListener('click', () => btcWizGo('btc-login'));
els.btnBtcWizToPaste.addEventListener('click', () => {
  const problem = btcIpProblem(els.btcVpsIp.value);
  if (problem) { setBtcStatus(els.btcIpStatus, problem, 'err'); return; }
  loadBlockA();
  btcWizGo('btc-paste');
});
els.btnBtcWizRun.addEventListener('click', btcRunSetup);
els.btnBtcWizRetry.addEventListener('click', btcRunSetup);
els.btnBtcWizManual.addEventListener('click', () => btcWizGo('btc-manual'));
els.btnBtcMakeB.addEventListener('click', makeBlockB);
els.btnBtcStartosVerify.addEventListener('click', startosVerify);
els.btnBtcStartosCleanup.addEventListener('click', btcStartosCleanup);

document.querySelectorAll('.btc-wiz-back').forEach((b) =>
  b.addEventListener('click', () => btcWizGo(b.dataset.back)));
document.querySelectorAll('.btc-wiz-exit').forEach((b) =>
  b.addEventListener('click', () => {
    if (btcSetupPoll) { clearInterval(btcSetupPoll); btcSetupPoll = null; }
    btcWizGo(btcWizReturn || 'dashboard');
  }));

els.btnBtcCopyA.addEventListener('click', () =>
  copyText(els.btcBlockA.textContent, els.btcCopyAFeedback, els.btnBtcCopyA));
els.btnBtcCopyB.addEventListener('click', () =>
  copyText(els.btcBlockB.textContent, els.btcCopyBFeedback, els.btnBtcCopyB));
els.btnBtcCopySsh.addEventListener('click', () =>
  copyText(els.btcSshCmd.textContent, els.btcCopySshFeedback, els.btnBtcCopySsh));
els.btnBtcCopySos.addEventListener('click', () =>
  copyText(els.btcStartosSsh.textContent, els.btcCopySosFeedback, els.btnBtcCopySos));



els.btnBtcMakeB.addEventListener('click', makeBlockB);
els.btnBtcStartosVerify.addEventListener('click', startosVerify);
els.btnBtcCopyA.addEventListener('click', () =>
  copyText(els.btcBlockA.textContent, els.btcCopyAFeedback, els.btnBtcCopyA));
els.btnBtcCopyB.addEventListener('click', () =>
  copyText(els.btcBlockB.textContent, els.btcCopyBFeedback, els.btnBtcCopyB));
