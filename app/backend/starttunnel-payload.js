'use strict';

// The StartTunnel setup script that lives ON the user's VPS.
//
// It is installed once by the block the user pastes, and from then on HashGG
// runs it over SSH. That split is the whole point of the design:
//
//   * the account HashGG holds a key for cannot run anything else — sshd pins it
//     to a shim, the shim maps to exactly two invocations of this file, and
//     sudo permits exactly those two. Compromising HashGG does not yield a shell
//     on the VPS, it yields the ability to re-run this;
//   * the script is fixed on disk rather than sent per-run, so what executes as
//     root is never assembled from anything HashGG receives at runtime;
//   * failures become something HashGG can see, retry and explain, instead of
//     output a non-technical user is asked to read.
//
// It takes one argument, `setup` or `cleanup`, and nothing else. Everything it
// prints is either progress (which HashGG shows) or a marked block (which
// HashGG parses), so keep the markers stable.

const CONFIG_BEGIN = 'HASHGG_CONFIG_BEGIN';
const CONFIG_END = 'HASHGG_CONFIG_END';
const OK_MARKER = 'HASHGG_OK';
const FAIL_MARKER = 'HASHGG_FAIL';

const SETUP_USER = 'hashgg-setup';
const PAYLOAD_PATH = '/usr/local/sbin/hashgg-starttunnel-setup';
const SHIM_PATH = '/usr/local/sbin/hashgg-setup-shim';
const SUDOERS_PATH = '/etc/sudoers.d/hashgg-setup';
const SSHD_DROPIN = '/etc/ssh/sshd_config.d/hashgg-setup.conf';

/**
 * The payload script. Written verbatim to PAYLOAD_PATH by the bootstrap block.
 *
 * Prints a FAIL_MARKER line before exiting non-zero so HashGG can show the
 * reason rather than "the command failed". Every message is written for
 * somebody who will only ever see it relayed into the dashboard.
 */
function payloadScript() {
  return `#!/bin/bash
# HashGG — StartTunnel setup. Installed by HashGG; not intended to be edited.
set -uo pipefail

MODE="\${1:-}"

fail() { echo "${FAIL_MARKER} \${1}"; exit 1; }
note() { echo "\${1}"; }

if [ "$MODE" = cleanup ]; then
  # Remove HashGG's access. Ordered so that the way in is closed before the
  # things it could have run, and sshd is reloaded rather than restarted so an
  # in-flight session is not cut off mid-cleanup.
  rm -f ${SSHD_DROPIN} ${SUDOERS_PATH}
  systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1 || true
  userdel -f -r ${SETUP_USER} >/dev/null 2>&1 || true
  rm -f ${SHIM_PATH}
  echo "${OK_MARKER} cleanup"
  # Last, because it is the file currently executing. Linux keeps the inode
  # alive until this process exits, so the remaining lines still run.
  rm -f ${PAYLOAD_PATH}
  exit 0
fi

[ "$MODE" = setup ] || fail "Unsupported request."

note "Checking this machine"

# Our own pre-flight rather than the installer's, whose error text and exit code
# disagree about which Debian versions are supported.
[ -f /etc/os-release ] || fail "Cannot identify the operating system on this VPS. It needs to be Debian 12 or newer."
. /etc/os-release
if [ "\${ID:-}" != "debian" ]; then
  fail "This VPS is running \${PRETTY_NAME:-an unsupported system}. StartTunnel runs on Debian only, so this VPS will need to be rebuilt with a Debian image."
fi
MAJOR="\${VERSION_ID%%.*}"
if [ "\${MAJOR:-0}" -lt 12 ]; then
  fail "This VPS is running Debian \$MAJOR, which is too old. Debian 12 or newer is required."
fi

# A dedicated public IPv4 is required — port forwarding cannot work behind a
# shared or CGNAT address.
WAN=\$(ip -4 -o addr show scope global 2>/dev/null | awk '{print \$4}' | cut -d/ -f1 | head -1) || true
[ -n "\$WAN" ] || fail "This VPS has no public IPv4 address."
case "\$WAN" in
  10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|100.6[4-9].*|100.[7-9][0-9].*|100.1[0-1][0-9].*|100.12[0-7].*)
    fail "This VPS's address (\$WAN) is a private one, so it is behind NAT or CGNAT. It needs its own dedicated public IPv4 address." ;;
esac
note "Debian \$MAJOR, public address \$WAN"

if command -v start-tunnel >/dev/null 2>&1; then
  # Re-running has to be safe: HashGG retries, and the upstream installer PROMPTS
  # for confirmation when the package is already present, which would hang a
  # non-interactive run forever.
  note "StartTunnel is already installed"
else
  note "Installing StartTunnel (this takes a minute or two)"
  command -v script >/dev/null 2>&1 || fail "This VPS is missing the 'script' command, which the StartTunnel installer needs."
  script -qec "curl -sSL https://start9labs.github.io/start-tunnel/install.sh | sh" /dev/null >/tmp/hashgg-install.log 2>&1
  command -v start-tunnel >/dev/null 2>&1 \\
    || fail "The StartTunnel installer did not complete. Check that this VPS can reach the internet."
fi

# The installer reports success even when the service has not come up, and every
# command below reads from it — so without this the next step returns nothing
# and the real cause is invisible. Seen in testing.
note "Waiting for StartTunnel to start"
wait_for_service() {
  for _ in \$(seq 1 30); do
    systemctl is-active --quiet start-tunneld.service && return 0
    sleep 1
  done
  return 1
}
systemctl start start-tunneld.service >/dev/null 2>&1 || true
if ! wait_for_service; then
  note "Taking longer than usual, restarting it"
  systemctl restart start-tunneld.service >/dev/null 2>&1 || true
  wait_for_service || fail "StartTunnel is installed but its service will not start. Restarting the VPS usually clears this."
fi

note "Configuring the tunnel"

# A "Default Subnet" exists after install but its CIDR is generated per install,
# so it has to be discovered. jq is NOT present on a stock Debian image, so parse
# without it. The trailing '|| true' matters: grep exits non-zero when it finds
# nothing, and with pipefail that would abort before the check below could say
# what went wrong.
read_subnet() {
  start-tunnel db dump -p /wg 2>/dev/null | grep -oE '"[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+/[0-9]+"' | head -1 | tr -d '"'
}
SUBNET=""
for _ in \$(seq 1 30); do
  SUBNET=\$(read_subnet) || true
  [ -n "\$SUBNET" ] && break
  sleep 2
done
[ -n "\$SUBNET" ] || fail "StartTunnel started but has not finished setting itself up. Wait a minute and try again."

# --kind server is what grants allowAutoPortForward, which is how StartOS later
# creates the port forward itself over PCP. Without it the forward would have to
# be added by hand, using a port StartOS has not assigned yet.
DEV_IP=""
for _ in \$(seq 1 10); do
  start-tunnel device add --kind server "\$SUBNET" "StartOS" >/dev/null 2>&1 || true
  DEV_IP=\$(start-tunnel device list "\$SUBNET" 2>/dev/null | awk '/StartOS/{print \$4}' | head -1) || true
  [ -n "\$DEV_IP" ] && break
  sleep 2
done
[ -n "\$DEV_IP" ] || fail "Could not register this server with StartTunnel."

# REQUIRED. Without a WAN address, show-config fails with "Not Found: a public
# IP address". The obvious 'subnet set-wan' is broken in 1.2.1 (it errors with
# "Serialization Error: duplicate key: subnet"), so set it on the device.
start-tunnel device set-wan "\$SUBNET" "\$DEV_IP" --wan-ip "\$WAN" >/dev/null 2>&1 || true

CONFIG=\$(start-tunnel device show-config "\$SUBNET" "\$DEV_IP" 2>/dev/null) || true
[ -n "\$CONFIG" ] || fail "Could not generate the tunnel configuration."

note "Tunnel ready"
echo "${CONFIG_BEGIN}"
printf '%s\\n' "\$CONFIG"
echo "${CONFIG_END}"
echo "${OK_MARKER} setup"
`;
}

/**
 * The block the user pastes, once, as root.
 *
 * Everything it does is bootstrap: install the payload, install a shim, create
 * an account that can reach nothing but the shim, and authorise HashGG's key.
 * It deliberately does NOT do the StartTunnel work — that belongs to the payload
 * so HashGG can drive it, watch it and retry it.
 *
 * Delivered as a quoted heredoc plus `bash`, not as bare lines. Pasted line by
 * line into a login shell the whole thing runs as interactive input: every line
 * echoes back and interleaves with output, and a failure under `set -e` exits
 * the LOGIN shell, so the user's session simply closes mid-run with nothing to
 * act on. Observed in testing, not theorised.
 */
function buildBlockA(publicKey) {
  const key = String(publicKey || '').trim();
  // Reaches an authorized_keys file. An OpenSSH public key is a narrow format,
  // so anything outside it is refused rather than escaped.
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+( [^\n\r]*)?$/.test(key)) {
    throw new Error('Refusing to build the setup script: the SSH public key is not in the expected format.');
  }

  return `cat > /root/hashgg-bootstrap.sh <<'HASHGG_BOOTSTRAP_EOF'
#!/bin/bash
# HashGG — gives HashGG a way in so it can finish the setup for you.
set -uo pipefail

die() {
  echo ""
  echo "!! \${1}"
  echo ""
  echo "   Nothing was changed. You are still logged in to the VPS."
  echo "   To try again:  bash /root/hashgg-bootstrap.sh"
  exit 1
}

[ "\$(id -u)" = "0" ] || die "This has to run as root. Log in as root and paste it again."

echo "=== Preparing this VPS for HashGG ==="

# sudo is how the setup account reaches root for two fixed commands and nothing
# else. Debian cloud images usually have it; minimal ones sometimes do not.
if ! command -v sudo >/dev/null 2>&1; then
  echo "   installing sudo"
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq sudo >/dev/null 2>&1 || die "Could not install sudo. Check this VPS can reach the internet."
fi

cat > ${PAYLOAD_PATH} <<'HASHGG_PAYLOAD_EOF'
${payloadScript()}HASHGG_PAYLOAD_EOF
chmod 700 ${PAYLOAD_PATH}
chown root:root ${PAYLOAD_PATH}

# The only thing the setup account can execute. It maps an SSH request to one of
# two exact commands; anything else is refused. This is what keeps a key that
# HashGG holds from being a shell on this machine.
cat > ${SHIM_PATH} <<'HASHGG_SHIM_EOF'
#!/bin/bash
case "\${SSH_ORIGINAL_COMMAND:-setup}" in
  setup)   exec sudo -n ${PAYLOAD_PATH} setup ;;
  cleanup) exec sudo -n ${PAYLOAD_PATH} cleanup ;;
esac
echo "HASHGG_FAIL Unsupported request."
exit 1
HASHGG_SHIM_EOF
chmod 755 ${SHIM_PATH}
chown root:root ${SHIM_PATH}

# Exactly two invocations, both fully specified. No wildcards: a trailing
# argument left open would let any file be run as root.
cat > ${SUDOERS_PATH} <<'HASHGG_SUDOERS_EOF'
${SETUP_USER} ALL=(root) NOPASSWD: ${PAYLOAD_PATH} setup, ${PAYLOAD_PATH} cleanup
HASHGG_SUDOERS_EOF
chmod 440 ${SUDOERS_PATH}
visudo -cf ${SUDOERS_PATH} >/dev/null 2>&1 || { rm -f ${SUDOERS_PATH}; die "Could not authorise the setup account."; }

id ${SETUP_USER} >/dev/null 2>&1 || useradd -r -m -d /home/${SETUP_USER} -s /bin/bash ${SETUP_USER}
install -d -m 700 -o ${SETUP_USER} -g ${SETUP_USER} /home/${SETUP_USER}/.ssh
cat > /home/${SETUP_USER}/.ssh/authorized_keys <<'HASHGG_KEY_EOF'
${key}
HASHGG_KEY_EOF
chmod 600 /home/${SETUP_USER}/.ssh/authorized_keys
chown ${SETUP_USER}:${SETUP_USER} /home/${SETUP_USER}/.ssh/authorized_keys

# Pin the account to the shim no matter what is asked for, and deny everything
# else sshd could otherwise offer it.
mkdir -p /etc/ssh/sshd_config.d
cat > ${SSHD_DROPIN} <<'HASHGG_SSHD_EOF'
Match User ${SETUP_USER}
    ForceCommand ${SHIM_PATH}
    AllowTcpForwarding no
    X11Forwarding no
    AllowAgentForwarding no
    PermitTTY no
    PermitTunnel no
HASHGG_SSHD_EOF
chmod 644 ${SSHD_DROPIN}

# Some Debian images ship an sshd_config without the Include line, in which case
# the drop-in is silently ignored — and an ignored drop-in means the account is
# NOT restricted. Fail rather than proceed unrestricted.
grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\\.d/' /etc/ssh/sshd_config \\
  || die "This VPS's SSH configuration does not read drop-in files, so the setup account could not be restricted. Nothing was left in place."

sshd -t 2>/dev/null || { rm -f ${SSHD_DROPIN}; die "The SSH configuration change was rejected. Nothing was left in place."; }
systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1 || true

clear 2>/dev/null || printf '\\033[2J\\033[H'
echo ""
echo "  =================================================="
echo ""
echo "     This VPS is ready."
echo ""
echo "     Go back to HashGG and click Continue."
echo ""
echo "  =================================================="
echo ""
HASHGG_BOOTSTRAP_EOF
bash /root/hashgg-bootstrap.sh
`;
}

module.exports = {
  buildBlockA,
  payloadScript,
  CONFIG_BEGIN,
  CONFIG_END,
  OK_MARKER,
  FAIL_MARKER,
  SETUP_USER,
};
