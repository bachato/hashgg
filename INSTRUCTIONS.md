# Welcome to HashGG!

HashGG tunnels your Datum Gateway stratum port to the internet, letting miners connect from anywhere — no port forwarding, no VPN, no static IP needed. You choose between two tunnel options:

- **playit.gg** (~$3/month, fiat) — easiest setup, managed service
- **VPS SSH tunnel** (~$11/month, Bitcoin) — privacy-focused, full control

# Quick Start

1. Install and configure **Datum Gateway** on your StartOS server.
2. Start **HashGG** and open its dashboard.
3. On first launch, HashGG asks you to pick a tunnel method:
   - **playit.gg** — click **Start Setup**, approve the claim URL in your browser, done.
   - **VPS** — provision a VPS (we recommend [BitLaunch](https://app.bitlaunch.io/signup)), paste the one-line setup script into its root shell, enter the VPS IP in the HashGG UI.
4. Once connected, HashGG displays your **Mining Endpoint** — a public `stratum+tcp://host:port` address.
5. Point your miners at that endpoint.

# The Dashboard

HashGG has a simple web dashboard accessible from your StartOS UI. It shows:

- **Mining Endpoint** — the public address to put in your miners. Click **Copy** to copy the full `stratum+tcp://` URL.
- **Tunnel** — whether the tunnel is connected.
- **Datum Gateway** — whether Datum Gateway's stratum port is reachable.
- **Agent** — whether the tunnel agent (playit or SSH) is running.

# Setup Options

## Option 1: playit.gg (Claim Flow)

When HashGG starts fresh and you pick **playit.gg**, click **Start Setup** — HashGG generates a claim URL. Visit it in your browser, log in to playit.gg, and approve the connection. HashGG detects the approval automatically.

You can also paste an existing agent secret key via **"Enter secret key manually"**, or set it under HashGG's StartOS config → **playit > Secret Key**.

**playit.gg requires Premium** (~$3/month). The free tier only offers game-specific tunnel types that inspect protocol traffic at the relay and reject stratum. Sign up at [playit.gg/account/premium](https://playit.gg/account/premium).

## Option 2: VPS SSH Tunnel

HashGG can also tunnel through a small VPS you control, using a standard SSH reverse tunnel. This avoids dependency on a third-party tunnel service on the data path.

**Recommended provider: [BitLaunch](https://app.bitlaunch.io/signup)** — anonymous signup (email only), Bitcoin-funded, ~$11/month for a 1 vCPU / 1 GB server. For privacy, fund with non-KYC Bitcoin. Any Debian / Ubuntu / RHEL-family VPS with root SSH will work, though.

The flow (all guided by the UI):

1. Pick **VPS Tunnel** on the tunnel-choice screen.
2. Read the BitLaunch setup tips, then enter your server's IP.
3. HashGG generates a setup script containing a fresh ED25519 public key. Copy it.
4. SSH into your VPS as root (the UI shows the exact `ssh root@<IP>` command) and paste the script. It creates a restricted `hashgg` user, installs the public key, and locks down sshd so the user can only do reverse port forwarding.
5. Click **Test Connection**. If it succeeds, click **Connect**.

HashGG then maintains a persistent `ssh -R` tunnel to the VPS, reconnecting automatically if it drops.

# Setting Up Your Miners

Point your miners to the **Mining Endpoint** shown in the HashGG dashboard. It will look like:

- playit.gg mode: `stratum+tcp://xx-xx-xx-xx.gl.joinplayit.gg:12345`
- VPS mode: `stratum+tcp://<your-vps-ip>:23335`

For **Username/Worker**, follow the same conventions as your Datum Gateway setup — typically a Bitcoin address, optionally with a worker name appended (e.g. `bc1q...address.worker1`).

**Password** can be left blank or set to `x`.

# Resetting

Click the **Reset** button in the dashboard to clear your configuration:

- playit.gg mode: clears your secret key and tunnel configuration.
- VPS mode: clears the VPS host, port, and SSH keypair (the remote `hashgg` user and `authorized_keys` entry are left in place — clean those up manually on the VPS if you no longer want HashGG to be able to connect).

After a reset you'll be returned to the tunnel-choice screen.

# Troubleshooting

**Tunnel shows "connecting"** — The tunnel agent is starting up. Wait 10–30 seconds. If it persists, check that your server (and VPS, if applicable) has internet access.

**Datum shows "unreachable"** — Datum Gateway may not be running or its stratum port may have changed. Verify Datum Gateway is started and check the port in HashGG's config under **advanced > Datum Stratum Port** (default: 23335).

**Playit claim flow times out** — The claim expires after 5 minutes. Click **Start Setup** again to generate a new one.

**VPS "Test Connection" fails with `Permission denied`** — The setup script may not have run successfully. Re-copy and re-run it on the VPS; check its final output for the "Verification" section. Most failures are caused by stale sshd_config or a home-directory mismatch — the latest setup script repairs both automatically.

**Miners can't connect** — Verify the Mining Endpoint is correct and the Tunnel status shows "Connected". Make sure your miner includes the full address *with* the port number.
