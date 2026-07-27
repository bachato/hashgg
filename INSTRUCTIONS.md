# Welcome to HashGG!

HashGG tunnels your Datum Gateway stratum port to the internet, letting miners connect from anywhere — no port forwarding, no VPN, no static IP needed. You choose between two tunnel options:

- **playit.gg** (~$3/month, fiat) — easiest setup, managed service
- **VPS SSH tunnel** (~€6/month, Bitcoin) — privacy-focused, full control

# Quick Start

1. Install and configure **Datum Gateway** on your StartOS server.
2. Start **HashGG** and open its dashboard.
3. On first launch, HashGG asks you to pick a tunnel method:
   - **playit.gg** — click **Start Setup**, approve the claim URL in your browser, done.
   - **VPS** — provision a VPS (we recommend [BTCVPS](https://btcvps.com/new-server/VPS2?months=1), paste the one-line setup script into its root shell, enter the VPS IP in the HashGG UI.
4. Once connected, HashGG displays your **Mining Endpoint** — a public `stratum+tcp://host:port` address.
5. Point your miners at that endpoint.

# The Dashboard

HashGG has a simple web dashboard accessible from your StartOS UI. It shows:

- **Mining Endpoint** — the public address to put in your miners. Click **Copy** to copy the full `stratum+tcp://` URL.
- **Tunnel** — whether the tunnel is connected.
- **Datum Gateway** — whether Datum Gateway's stratum port is reachable.
- **Agent** — whether the tunnel agent (playit or SSH) is running.

Further down, an Advanced section appears if HashGG can see a Bitcoin node — see [Making Your Bitcoin Node Reachable](#making-your-bitcoin-node-reachable-optional).

# Setup Options

## Option 1: playit.gg (Claim Flow)

When HashGG starts fresh and you pick **playit.gg**, click **Start Setup** — HashGG generates a claim URL. Visit it in your browser, log in to playit.gg, and approve the connection. HashGG detects the approval automatically.

You can also paste an existing agent secret key via **"Enter secret key manually"**, or set it under HashGG's StartOS config → **playit > Secret Key**.

**playit.gg requires Premium** (~$3/month). The free tier only offers game-specific tunnel types that inspect protocol traffic at the relay and reject stratum. Sign up at [playit.gg/account/premium](https://playit.gg/account/premium).

## Option 2: VPS SSH Tunnel

HashGG can also tunnel through a small VPS you control, using a standard SSH reverse tunnel. This avoids dependency on a third-party tunnel service on the data path.

**Recommended provider: [BTCVPS](https://btcvps.com/new-server/VPS2?months=1)** — anonymous signup (email only), paid in Bitcoin, €6/month for a 1 vCPU / 2 GB server with 4 TB of monthly transfer. That link opens the €6 plan directly; the site's pricing page highlights the €12 one, which HashGG does not need. For privacy, pay with non-KYC Bitcoin. Any Debian / Ubuntu / RHEL-family VPS with root SSH will work, though.

The flow (all guided by the UI):

1. Pick **VPS Tunnel** on the tunnel-choice screen.
2. Read the setup tips, then enter your server's IP.
3. HashGG generates a setup script containing a fresh ED25519 public key. Copy it.
4. SSH into your VPS as root (the UI shows the exact `ssh root@<IP>` command) and paste the script. It creates a restricted `hashgg` user, installs the public key, and locks down sshd so the user can only do reverse port forwarding.
5. Click **Test Connection**. If it succeeds, click **Connect**.

HashGG then maintains a persistent `ssh -R` tunnel to the VPS, reconnecting automatically if it drops.

# Making Your Bitcoin Node Reachable (optional)

Separately from mining, HashGG can put your **Bitcoin node** on the public internet so other nodes can connect *to* you. Most home nodes only reach out — nothing can reach in, because that needs a public address and an open port.

It is off by default. Once HashGG can see a Bitcoin node, a **Make your Bitcoin node reachable** section appears on the dashboard.

## What it involves

Two things, and only the first is automatic:

1. **HashGG opens the door** — a public address on your VPS that forwards to your node.
2. **You put up the sign** — one line pasted into your Bitcoin node's own settings, telling it to advertise that address. A node that accepts connections but never advertises gets almost no peers, because nobody knows it exists. HashGG cannot write that line for you, so it gives you the line, a Copy button, and tells you where it goes.

HashGG then dials your own public address from the outside and completes a Bitcoin handshake, so you can see it worked.

## Before you turn it on

- **Your home IP stays private** — peers connect to your VPS, not to you.
- **It does not make your node anonymous.** Connections your node makes *out* still leave from your home connection, exactly as now. Inbound is hidden; outbound is not.
- **Expect roughly 100–300 GB a month of extra VPS traffic**, sometimes more when another node syncs history from you. Check your VPS plan's allowance; you can cap it with `maxuploadtarget`.
- **Every incoming peer looks like one local connection** to your node. That is how inbound Tor already works and is normal.

## Before you uninstall HashGG or change VPS

**Turn this off first, and remove the line from your Bitcoin node's settings.** Otherwise your node carries on telling the network to reach it at an address that no longer works. The dashboard shows you exactly what to remove when you switch it off.

## On StartOS

- **0.4.0** — StartOS does this natively, and better: it preserves each peer's real IP address. HashGG writes the setup commands for you instead of tunnelling. You will need a second VPS running StartTunnel, separate from any mining VPS.
- **0.3.5.1** — not possible. The Bitcoin package rewrites its configuration every time it starts and only ever advertises its Tor address, so nothing can tell it about a public one. HashGG explains this rather than offering something that would not work.

# Setting Up Your Miners

Point your miners to the **Mining Endpoint** shown in the HashGG dashboard. It will look like:

- playit.gg mode: `stratum+tcp://xx-xx-xx-xx.gl.joinplayit.gg:12345`
- VPS mode: `stratum+tcp://<your-vps-ip>:23335`

For **Username/Worker**, follow the same conventions as your Datum Gateway setup — typically a Bitcoin address, optionally with a worker name appended (e.g. `bc1q...address.worker1`).

**Password** can be left blank or set to `x`.

# Additional Miners (Advanced)

Want to expose a *second* stratum server — another miner backend on your network — through its own public tunnel? On the dashboard, expand **Advanced: additional miners**.

1. Click **+ Add another stratum**.
2. Enter a **Name**, the **Stratum IP / host**, and the **Stratum port** of the other server (it must be reachable from HashGG).
3. Click **Add**. HashGG creates a second tunnel and shows its own public endpoint.
   - **playit.gg:** the tunnel is created automatically (counts toward your playit.gg quota).
   - **VPS:** HashGG picks a public port and shows a one-line firewall command to run on your VPS so miners can reach it.

Each additional miner shows its own status (Active / Connecting / Stratum unreachable) and a Copy button for its endpoint. Use **Remove** to delete a connection and its tunnel.

> **VPS mode note:** adding or removing an additional miner restarts the shared SSH tunnel, so the primary Datum endpoint briefly reconnects (a few seconds) — make changes when a short interruption is OK. In playit.gg mode the primary endpoint is unaffected.

# Cleaning Up playit.gg (playit mode)

Reinstalling HashGG creates a new playit.gg agent and tunnel each time, so old ones can pile up and exhaust your account quota. On the dashboard, click **Clean up old playit.gg tunnels…**. HashGG scans your account, lists leftover HashGG tunnels that aren't in use, and (after a confirmation) deletes them. It never touches your active tunnel or non-HashGG tunnels.

playit.gg doesn't allow apps to delete *agents*, so HashGG names its agent **HashGG (…)** to make it identifiable and links you to [playit.gg/account/agents](https://playit.gg/account/agents) to remove any leftover agents yourself.

# Resetting

Click the **Reset** button in the dashboard to clear your configuration:

- playit.gg mode: clears your secret key and tunnel configuration.
- VPS mode: clears the VPS host, port, and SSH keypair.
- If you had made your Bitcoin node reachable, that is switched off too — and HashGG shows you the line to remove from your Bitcoin node's settings, because a reset cannot do that for you.

To also remove HashGG's footprint *on the VPS* (the `hashgg` user, SSH config, and firewall rule) — for example when switching providers — use **Remove HashGG from this VPS…** on the dashboard before resetting. It gives you a copy-paste teardown script to run on the VPS as root.

After a reset you'll be returned to the tunnel-choice screen.

# Troubleshooting

**"No Bitcoin node found" but my node is running (Linux, plain Docker).** The container reaches your node across the Docker bridge, and a default-deny firewall silently *drops* those packets rather than refusing them — so it looks like nothing is there. Run `bash host-setup/install-datum-gateway.sh open-firewall`, which opens both Datum's stratum port and Bitcoin's P2P port.

**Verify says nothing answered.** The tunnel can be up while the port is still closed on the VPS. Check step 2's firewall command ran, and that your provider's own firewall panel allows the port too.

**No inbound peers after a few hours.** The tunnel is only half of it — check the line really saved in your Bitcoin node's settings and that the node restarted afterwards. On Umbrel, HashGG can see this directly and will tell you whether your node is advertising the address.

**Tunnel shows "connecting"** — The tunnel agent is starting up. Wait 10–30 seconds. If it persists, check that your server (and VPS, if applicable) has internet access.

**Datum shows "unreachable"** — Datum Gateway may not be running or its stratum port may have changed. Verify Datum Gateway is started and check the port in HashGG's config under **advanced > Datum Stratum Port** (default: 23335).

**Playit claim flow times out** — The claim expires after 5 minutes. Click **Start Setup** again to generate a new one.

**VPS "Test Connection" fails with `Permission denied`** — The setup script may not have run successfully. Re-copy and re-run it on the VPS; check its final output for the "Verification" section. Most failures are caused by stale sshd_config or a home-directory mismatch — the latest setup script repairs both automatically.

**Miners can't connect** — Verify the Mining Endpoint is correct and the Tunnel status shows "Connected". Make sure your miner includes the full address *with* the port number.
