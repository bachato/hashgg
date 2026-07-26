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
 * Every command was executed on real hardware; the comments record the three
 * traps that are not obvious from the documentation.
 */
function buildBlockA() {
  return `#!/bin/bash
# HashGG — StartTunnel setup. Paste this into your NEW VPS as root.
set -euo pipefail

echo "=== Checking this machine ==="

# Our own pre-flight rather than the installer's, whose error text and code
# disagree about which Debian versions are supported.
if [ ! -f /etc/os-release ]; then echo "!! Cannot identify this OS. Debian 12 or newer is required."; exit 1; fi
. /etc/os-release
if [ "\${ID:-}" != "debian" ]; then
  echo "!! This is \${PRETTY_NAME:-unknown}. StartTunnel supports Debian only — Ubuntu will not work."
  exit 1
fi
MAJOR="\${VERSION_ID%%.*}"
if [ "\${MAJOR:-0}" -lt 12 ]; then
  echo "!! Debian \$MAJOR is too old. Debian 12 (bookworm) or newer is required."
  exit 1
fi

# A dedicated public IPv4 is required — port forwarding cannot work behind a
# shared or CGNAT address.
WAN=\$(ip -4 -o addr show scope global 2>/dev/null | awk '{print \$4}' | cut -d/ -f1 | head -1)
if [ -z "\$WAN" ]; then echo "!! No public IPv4 address found on this machine."; exit 1; fi
case "\$WAN" in
  10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|100.6[4-9].*|100.[7-9][0-9].*|100.1[0-1][0-9].*|100.12[0-7].*)
    echo "!! \$WAN is a private address — this VPS is behind NAT or CGNAT."
    echo "!! Port forwarding cannot work here. You need a dedicated public IPv4."
    exit 1 ;;
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
  # session, a Ctrl-C), the user's instinct is to paste the block again. The
  # upstream installer PROMPTS for confirmation when the package is already
  # present, so running it again would stall at a question this script cannot
  # answer. Skip it — the configuration steps below are safe to repeat.
  echo "=== StartTunnel is already installed — skipping installation ==="
else
  echo "=== Installing StartTunnel ==="
  curl -sSL https://start9labs.github.io/start-tunnel/install.sh | sh
fi

echo ""
echo "=== Configuring ==="

# A "Default Subnet" already exists after install, but its CIDR is generated
# per install, so it has to be discovered. jq is NOT present on a stock Debian
# image, so parse without it.
SUBNET=\$(start-tunnel db dump -p /wg 2>/dev/null | grep -oE '"[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+/[0-9]+"' | head -1 | tr -d '"')
if [ -z "\$SUBNET" ]; then echo "!! Could not find the default subnet."; exit 1; fi
echo "   subnet: \$SUBNET"

# --kind server is what grants allowAutoPortForward, which is how StartOS later
# creates the port forward itself over PCP. Without it you would have to add the
# forward by hand, with a port StartOS has not assigned yet.
start-tunnel device add --kind server "\$SUBNET" "StartOS" >/dev/null 2>&1 || true
DEV_IP=\$(start-tunnel device list "\$SUBNET" 2>/dev/null | awk '/StartOS/{print \$4}' | head -1)
if [ -z "\$DEV_IP" ]; then echo "!! Could not add the StartOS device."; exit 1; fi
echo "   device: \$DEV_IP"

# REQUIRED. Without a WAN address, show-config fails with "Not Found: a public
# IP address". The obvious 'subnet set-wan' is broken in 1.2.1 (it errors with
# "Serialization Error: duplicate key: subnet"), so set it on the device.
start-tunnel device set-wan "\$SUBNET" "\$DEV_IP" --wan-ip "\$WAN" >/dev/null 2>&1 || true

echo ""
echo "==================== COPY EVERYTHING BELOW ===================="
start-tunnel device show-config "\$SUBNET" "\$DEV_IP"
echo "==================== COPY EVERYTHING ABOVE ===================="
echo ""
echo "Paste that into HashGG to get your next command."
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
function buildBlockB(config, vpsHost, peerInternalPort = 58333) {
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
ADDR=$(start-cli package host bitcoind binding peer list --format json | python3 -c '
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
  start-cli package host bitcoind binding peer set-address-enabled --address "$ADDR" --enabled true ${peerInternalPort}
  echo ""
  echo "Done. StartOS will open the port and tell your node to advertise it."
  echo ""
  echo "Copy this line back into HashGG:"
  # Plain double quotes: this python is already inside shell single quotes, so
  # escaping them produces literal backslashes and a SyntaxError.
  echo "HASHGG_VERIFY $(printf '%s' "$ADDR" | python3 -c 'import json,sys; a=json.load(sys.stdin); print(str(a["hostname"]) + ":" + str(a["port"]))')"
fi
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
  buildBlockB,
  parseVerifyLine,
  HEREDOC_DELIMITER,
};
