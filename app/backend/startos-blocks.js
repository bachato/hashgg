'use strict';

// StartOS 0.4.0 — generated setup blocks.
//
// On 0.4.0 HashGG does not tunnel. `externalip` is derived from addresses
// published on the Peer interface, and those must belong to a registered
// gateway, so an arbitrary tunnel address can never be advertised. StartOS does
// this natively via StartTunnel, and does it better — its port forwarding is
// L3 DNAT, so peers keep their real IP addresses.
//
// What HashGG can do is remove the barrier. The documented path is ~9 steps
// across three UIs; every one of them has a CLI equivalent, so we generate the
// commands and the user pastes them. HashGG never touches either machine — it
// is a generator and a verifier, which keeps the privilege story identical to
// the stratum onboarding people already complete.
//
// SECURITY — the user pastes our output into a privileged shell, and part of it
// (the WireGuard config) arrives through a form on a UI with no authentication.
// A single quote in that text would escape a quoted argument and run as their
// shell. So: the config is validated against a narrow grammar, and it is never
// interpolated into a command — it goes into a quoted heredoc, which disables
// every form of expansion, and reaches start-cli via a file.

const variant = require('./variant');

const HEREDOC_DELIMITER = 'HASHGG_WG_CONFIG_EOF';
const MAX_CONFIG_BYTES = 4096;

// A WireGuard config is a narrow format: section headers and `Key = value`
// lines. Anything outside this is rejected rather than escaped, because
// escaping is where this kind of thing goes wrong.
const ALLOWED_LINE = /^(\[(Interface|Peer)\]|[A-Za-z]+ *= *[A-Za-z0-9+/=:.,_\- ]+|#.*)?$/;

/**
 * Validate a pasted WireGuard config.
 * Returns { ok: true, config } or { ok: false, error }.
 */
function validateWireGuardConfig(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'No configuration supplied' };
  const text = raw.replace(/\r\n/g, '\n').trim();

  if (!text) return { ok: false, error: 'No configuration supplied' };
  if (text.length > MAX_CONFIG_BYTES) {
    return { ok: false, error: 'That is much larger than a WireGuard configuration — check what you pasted.' };
  }
  // Belt and braces: if the body could contain our delimiter it could close the
  // heredoc early, so refuse rather than pick a different delimiter.
  if (text.includes(HEREDOC_DELIMITER)) {
    return { ok: false, error: 'That text cannot be used as a configuration.' };
  }
  if (!/\[Interface\]/.test(text) || !/\[Peer\]/.test(text)) {
    return { ok: false, error: 'That does not look like a WireGuard configuration — it should contain [Interface] and [Peer] sections.' };
  }

  const lines = text.split('\n');
  for (const line of lines) {
    if (!ALLOWED_LINE.test(line.trim())) {
      return { ok: false, error: 'The configuration contains unexpected characters. Paste only what StartTunnel printed.' };
    }
  }

  // The VPS address, which we need for the verification step later.
  const endpoint = (text.match(/^Endpoint *= *([^:\s]+):(\d+)/m) || []);
  return { ok: true, config: text, vpsHost: endpoint[1] || null };
}

/**
 * Block A — paste into the new VPS as root.
 *
 * Delivered as a quoted heredoc plus `bash`, NOT as bare lines to paste. That
 * is not cosmetic. Pasted line by line into a login shell, the whole thing runs
 * as interactive input: every line is echoed back and interleaves with the
 * output, which is unreadable, and `set -e` firing on any failure kills the
 * LOGIN SHELL — the user's SSH session simply closes, mid-run, with no error
 * and nothing to act on. Inside a heredoc the text is inert until `bash` runs
 * it as a child, so a failure ends the script and leaves the user logged in
 * looking at the reason. Observed in testing, not theorised.
 *
 * Every command was executed on real hardware; the comments record the traps
 * that are not obvious from the documentation.
 */
const SETUP_DELIMITER = 'HASHGG_SETUP_EOF';

function buildBlockA() {
  return `cat > /root/hashgg-starttunnel.sh <<'${SETUP_DELIMITER}'
#!/bin/bash
# HashGG — StartTunnel setup.
set -uo pipefail

# One place to fail from, so every exit says what to do next rather than just
# stopping. Without this the script ends on a bare message the user has to
# scroll back through the install output to find.
die() {
  echo ""
  echo "!! \${1}"
  echo ""
  echo "   Nothing further was changed, and you are still logged in to the VPS."
  echo "   Once that is sorted, run this to pick up from the top:"
  echo ""
  echo "       bash /root/hashgg-starttunnel.sh"
  exit 1
}

echo "=== Checking this machine ==="

# Our own pre-flight rather than the installer's, whose error text and code
# disagree about which Debian versions are supported.
[ -f /etc/os-release ] || die "Cannot identify this operating system. Debian 12 or newer is required."
. /etc/os-release
if [ "\${ID:-}" != "debian" ]; then
  die "This is \${PRETTY_NAME:-unknown}. StartTunnel runs on Debian only — Ubuntu will not work. Rebuild this VPS with a Debian image."
fi
MAJOR="\${VERSION_ID%%.*}"
if [ "\${MAJOR:-0}" -lt 12 ]; then
  die "Debian \$MAJOR is too old. Debian 12 (bookworm) or newer is required."
fi

# A dedicated public IPv4 is required — port forwarding cannot work behind a
# shared or CGNAT address.
WAN=\$(ip -4 -o addr show scope global 2>/dev/null | awk '{print \$4}' | cut -d/ -f1 | head -1) || true
[ -n "\$WAN" ] || die "No public IPv4 address found on this machine."
case "\$WAN" in
  10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|100.6[4-9].*|100.[7-9][0-9].*|100.1[0-1][0-9].*|100.12[0-7].*)
    die "\$WAN is a private address, so this VPS is behind NAT or CGNAT. Port forwarding cannot work here — you need a VPS with its own dedicated public IPv4." ;;
esac
echo "   Debian \$MAJOR, public address \$WAN — OK"

echo ""
echo "=== What this will do ==="
echo "   * install StartTunnel from Start9's package repository"
echo "   * DISABLE any firewall on this machine (ufw) and clear its rules —"
echo "     StartTunnel manages the firewall itself and must be the only"
echo "     internet-facing service here"
echo "   * rewrite /etc/resolv.conf if DNS is not working"
echo ""
echo "   Use a FRESH VPS. Continuing in 10 seconds — Ctrl-C to stop."
sleep 10

echo ""
if command -v start-tunnel >/dev/null 2>&1; then
  # Re-running matters: if the first attempt died partway (a dropped SSH
  # session, a Ctrl-C), the user's instinct is to run it again. The upstream
  # installer PROMPTS for confirmation when the package is already present, so
  # running it again would stall at a question this script cannot answer. Skip
  # it — the configuration steps below are safe to repeat.
  echo "=== StartTunnel is already installed — skipping installation ==="
else
  echo "=== Installing StartTunnel ==="
  curl -sSL https://start9labs.github.io/start-tunnel/install.sh | sh || \\
    die "The StartTunnel installer failed. Check this VPS can reach the internet, then try again."
fi

# The installer reports success even when the service does not come up, and
# every command below reads from it — so without this the next step fails with
# an empty result and no hint that the service is the reason. Seen in testing.
echo ""
echo "=== Waiting for StartTunnel to start ==="
wait_for_service() {
  for i in \$(seq 1 30); do
    if systemctl is-active --quiet start-tunneld.service; then return 0; fi
    sleep 1
  done
  return 1
}
systemctl start start-tunneld.service >/dev/null 2>&1 || true
if ! wait_for_service; then
  # One restart before involving the user. In the reported failure the service
  # was simply slow — it was running by the time the VPS was inspected — so this
  # resolves the case that actually happened without anyone having to do
  # anything.
  echo "   taking longer than usual — restarting it"
  systemctl restart start-tunneld.service >/dev/null 2>&1 || true
  if ! wait_for_service; then
    echo ""
    echo "!! StartTunnel is installed, but its service has not started."
    echo ""
    echo "   Restarting the VPS almost always fixes this. Three things to do:"
    echo ""
    echo "     1. Type:  reboot"
    echo "        Your connection will close straight away. That is expected."
    echo ""
    echo "     2. Wait about a minute, then connect again with the same"
    echo "        'ssh root@...' command HashGG gave you."
    echo ""
    echo "     3. Type:  bash /root/hashgg-starttunnel.sh"
    echo ""
    echo "   Nothing is half-finished — that starts again from the top."
    echo "   If it still stops here afterwards, this says why:"
    echo "       systemctl status start-tunneld.service"
    exit 1
  fi
fi
echo "   running"

echo ""
echo "=== Configuring ==="

# A "Default Subnet" already exists after install, but its CIDR is generated
# per install, so it has to be discovered. jq is NOT present on a stock Debian
# image, so parse without it. The trailing '|| true' matters: grep exits
# non-zero when it finds nothing, and with pipefail that would abort before the
# check below could explain what went wrong.
SUBNET=\$(start-tunnel db dump -p /wg 2>/dev/null | grep -oE '"[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+/[0-9]+"' | head -1 | tr -d '"') || true
[ -n "\$SUBNET" ] || die "Could not read StartTunnel's default subnet. Check 'systemctl status start-tunneld.service'."
echo "   subnet: \$SUBNET"

# --kind server is what grants allowAutoPortForward, which is how StartOS later
# creates the port forward itself over PCP. Without it you would have to add the
# forward by hand, with a port StartOS has not assigned yet.
start-tunnel device add --kind server "\$SUBNET" "StartOS" >/dev/null 2>&1 || true
DEV_IP=\$(start-tunnel device list "\$SUBNET" 2>/dev/null | awk '/StartOS/{print \$4}' | head -1) || true
[ -n "\$DEV_IP" ] || die "Could not create the StartOS device in StartTunnel."
echo "   device: \$DEV_IP"

# REQUIRED. Without a WAN address, show-config fails with "Not Found: a public
# IP address". The obvious 'subnet set-wan' is broken in 1.2.1 (it errors with
# "Serialization Error: duplicate key: subnet"), so set it on the device.
start-tunnel device set-wan "\$SUBNET" "\$DEV_IP" --wan-ip "\$WAN" >/dev/null 2>&1 || true

CONFIG=\$(start-tunnel device show-config "\$SUBNET" "\$DEV_IP" 2>/dev/null) || true
[ -n "\$CONFIG" ] || die "Could not generate the configuration. Try again, or check 'systemctl status start-tunneld.service'."

echo ""
echo "==================== COPY EVERYTHING BELOW ===================="
printf '%s\\n' "\$CONFIG"
echo "==================== COPY EVERYTHING ABOVE ===================="
echo ""
echo "Paste that into HashGG to get your next command."
${SETUP_DELIMITER}
bash /root/hashgg-starttunnel.sh
`;
}

/**
 * Block B — paste into a StartOS terminal.
 *
 * Registers the gateway, then finds and enables the new public address. The
 * address cannot be constructed here: StartOS assigns both the external port
 * and the interface name when the gateway is created, so the selection has to
 * happen on the StartOS host, after the fact.
 */
function buildBlockB(config, vpsHost, node = variant.NODE_TARGETS[0]) {
  // Id and port travel together and are not defaulted separately: the peer
  // binding is registered under a different internal port in each package
  // (bitcoind and knots-prerdts use 58333, knots-blake2b uses 18444), so a
  // correct id with a stale port silently addresses nothing.
  const nodeId = node.id;
  const peerInternalPort = node.peerInternalPort;
  return `# HashGG — StartOS setup. Paste this into a terminal on your StartOS server
# (ssh start9@<your-server>.local).

cat > /tmp/hashgg-wg.conf <<'${HEREDOC_DELIMITER}'
${config}
${HEREDOC_DELIMITER}

# Adding the same tunnel twice creates a SECOND gateway rather than replacing
# the first — and re-pasting is exactly what someone does when a step seems not
# to have worked. Skip the add when a gateway for this VPS already exists.
EXISTING=$(start-cli net gateway list --format json 2>/dev/null | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for name, g in d.items():
    ip = (g.get("ipInfo") or {})
    if name.startswith("wg") and ip.get("wanIp") == "${vpsHost || ''}":
        print(name); break
')

if [ -n "$EXISTING" ]; then
  echo "Gateway for this VPS already exists ($EXISTING) — skipping."
else
  start-cli net tunnel add "StartTunnel" "$(cat /tmp/hashgg-wg.conf)" inbound-outbound
fi
rm -f /tmp/hashgg-wg.conf
sleep 5

# The address object has to be read back rather than constructed: StartOS
# assigns the external port and names the interface when the gateway is added,
# so neither value is known before this point.
ADDR=$(start-cli package host ${nodeId} binding peer list --format json | python3 -c '
import json, sys
d = json.load(sys.stdin)
b = d.get("${peerInternalPort}") or {}
for a in b.get("addresses", {}).get("available", []):
    g = (a.get("metadata") or {}).get("gateway") or ""
    if a.get("public") and (a.get("metadata") or {}).get("kind") == "ipv4" and g.startswith("wg"):
        print(json.dumps(a)); break
')

if [ -z "$ADDR" ]; then
  echo "!! Could not find the tunnel address. Is the gateway connected?"
else
  start-cli package host ${nodeId} binding peer set-address-enabled --address "$ADDR" --enabled true ${peerInternalPort}
  VERIFY_LINE="HASHGG_VERIFY $(printf '%s' "$ADDR" | python3 -c 'import json,sys; a=json.load(sys.stdin); print(str(a["hostname"]) + ":" + str(a["port"]))')"
  clear 2>/dev/null || printf '\\033[2J\\033[H'
  echo ""
  echo "  =================================================="
  echo ""
  echo "     Your node is now reachable from the internet."
  echo ""
  echo "     Copy this line back into HashGG:"
  echo ""
  echo "     $VERIFY_LINE"
  echo ""
  echo "  =================================================="
  echo ""
fi
`;
}

/**
 * The block that disconnects a previous VPS.
 *
 * This exists because the honest instruction — "remove the gateway, then check
 * System > Gateways to confirm wg0 is actually gone, and run it again if it is
 * not" — is three pieces of vocabulary and a verification burden aimed at
 * someone who does not want to know what a gateway is. Worse, `net tunnel
 * remove` has been observed reporting success without removing anything, and a
 * tunnel left pointing at a VPS that is going away takes DNS down with it, which
 * stops mining. So the script does the checking, retries, and says one thing at
 * the end.
 */
function buildReplaceBlock(node = variant.NODE_TARGETS[0]) {
  const nodeId = node.id;
  return `# HashGG — disconnect your current VPS. Paste into a terminal on StartOS.

python3 - <<'HASHGG_REPLACE_EOF'
import json, subprocess, sys, time

def run(args):
    r = subprocess.run(["start-cli"] + args, capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()

def tunnels():
    code, out, _ = run(["net", "gateway", "list", "--format", "json"])
    if code != 0:
        return None
    try:
        return sorted(k for k in json.loads(out) if k.startswith("wg"))
    except Exception:
        return None

found = tunnels()
if found is None:
    print("!! Could not read this server's network settings.")
    sys.exit(1)
if not found:
    print("Nothing to disconnect — no VPS is connected to this server.")
    sys.exit(0)

# Switch the public address off first. That is what makes StartOS stop telling
# the node to advertise it and drop the port forward; removing the tunnel alone
# would leave the node announcing an address that is about to stop working.
code, out, _ = run(["package", "host", "${nodeId}", "binding", "peer", "list", "--format", "json"])
if code == 0:
    try:
        bindings = json.loads(out)
    except Exception:
        bindings = {}
    for port, b in bindings.items():
        for a in b.get("addresses", {}).get("enabled", []):
            for cand in b.get("addresses", {}).get("available", []):
                gw = (cand.get("metadata") or {}).get("gateway") or ""
                same = cand.get("hostname") == (a if isinstance(a, str) else a.get("hostname"))
                if gw.startswith("wg") and (same or str(a).startswith(str(cand.get("hostname")))):
                    run(["package", "host", "${nodeId}", "binding", "peer",
                         "set-address-enabled", "--address", json.dumps(cand),
                         "--enabled", "false", str(port)])
    time.sleep(3)

# Remove, then confirm. The command has been seen to return success while
# leaving the tunnel in place, so its exit status is not evidence.
for name in found:
    for attempt in range(4):
        run(["net", "tunnel", "remove", name])
        time.sleep(3)
        still = tunnels()
        if still is not None and name not in still:
            break
    else:
        print("")
        print("!! Could not disconnect %s. Try running this again." % name)
        sys.exit(1)

print("")
print("  ==================================================")
print("")
print("     Your old VPS is disconnected.")
print("")
print("     Go back to HashGG and click Continue.")
print("")
print("  ==================================================")
print("")
HASHGG_REPLACE_EOF
`;
}

/**
 * Parse the `HASHGG_VERIFY host:port` line the user copies back.
 */
function parseVerifyLine(raw) {
  const m = String(raw || '').match(/([A-Za-z0-9.\-:]+):(\d{1,5})\s*$/);
  if (!m) return { ok: false, error: 'That does not look like the line HashGG asked for.' };
  const port = Number(m[2]);
  if (!port || port > 65535) return { ok: false, error: 'That port is not valid.' };
  if (m[1].length > 255 || m[1][0] === '-') return { ok: false, error: 'That address is not valid.' };
  return { ok: true, host: m[1], port };
}

module.exports = {
  validateWireGuardConfig,
  buildBlockA,
  buildReplaceBlock,
  buildBlockB,
  parseVerifyLine,
  HEREDOC_DELIMITER,
};
