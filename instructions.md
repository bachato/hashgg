# Welcome to HashGG!

HashGG tunnels your Datum Gateway stratum port to the internet, letting miners connect from anywhere — no port forwarding, no VPN, no static IP needed. You choose between two tunnel options:

- **playit.gg** (~$3/month, fiat) — easiest setup, managed service
- **VPS SSH tunnel** (~€6/month, Bitcoin) — privacy-focused, full control

# Quick Start

1. Install and configure **Datum Gateway** on your StartOS server.
2. Start **HashGG** and open its dashboard.
3. On first launch, HashGG asks you to pick a tunnel method:
   - **playit.gg** — click **Start Setup**, approve the claim URL in your browser, done.
   - **VPS** — provision a VPS (we recommend [BTCVPS](https://btcvps.com/new-server/VPS2?months=1)), enter its address in the HashGG UI, and paste the setup script it gives you into the VPS.
4. Once connected, HashGG displays your **Mining Endpoint** — a public `stratum+tcp://host:port` address.
5. Point your miners at that endpoint.

# The Dashboard

HashGG has a simple web dashboard accessible from your StartOS UI. It shows:

- **Mining Endpoint** — the public address to put in your miners. Click **Copy** to copy the full `stratum+tcp://` URL.
- **Tunnel** — whether the tunnel is connected.
- **Datum Gateway** — whether Datum Gateway's stratum port is reachable.
- **Agent** — whether the tunnel agent (playit or SSH) is running.

Further down, a **Make your Bitcoin node reachable** section appears if HashGG can see a Bitcoin node — see [Making Your Bitcoin Node Reachable](#making-your-bitcoin-node-reachable-optional).

# Setup Options

## Option 1: playit.gg (Claim Flow)

When HashGG starts fresh and you pick **playit.gg**, click **Start Setup** — HashGG generates a claim URL. Visit it in your browser, log in to playit.gg, and approve the connection. HashGG detects the approval automatically.

You can also paste an existing agent secret key via **"Enter a secret key manually"**, or set it under HashGG's StartOS config → **playit > Secret Key**.

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

It is off by default. Once HashGG can see a Bitcoin node, a **Make your Bitcoin node reachable** section appears on the dashboard with a **Set this up** button. That opens a step-by-step guide written for people who have not used a terminal: where to get a small server, how to open a terminal on Windows or a Mac, and exactly what to paste.

You will need a **VPS** — a small rented Linux machine, about €6/month. If you already run one for your mining tunnel, it can usually carry this too at no extra cost, and the setup offers that as a one-click choice.

## What it involves

StartOS does this natively, and better than HashGG could — it preserves each peer's real IP address. So HashGG's job is to remove the work:

1. You paste one block into your new VPS. That gives HashGG a way in.
2. **HashGG sets the VPS up for you** — installing and configuring StartTunnel while you watch, and retrying by itself when something is slow.
3. You paste one command into a terminal on StartOS. That connects the two and switches the public address on.

There is no configuration line to add to your node: StartOS opens the port and tells the node what to advertise. HashGG finishes by dialling your public address from the outside and completing a Bitcoin handshake, so you can see for yourself that it worked, and then removes its own access to the VPS since it is no longer needed.

## Before you turn it on

- **Your home IP stays private** — peers connect to your VPS, not to you.
- **It does not make your node anonymous.** Connections your node makes *out* still leave from your home connection, exactly as now. Inbound is hidden; outbound is not.
- **Expect roughly 100–300 GB a month of extra VPS traffic**, sometimes more when another node syncs history from you. Check your VPS plan's allowance; you can cap it with `maxuploadtarget`.
- **Every incoming peer looks like one local connection** to your node. That is how inbound Tor already works and is normal.

## Starting again

The **Start over** button forgets the server HashGG is using for your Bitcoin node and stops the connection, so you can set it up from the beginning. Your mining is not affected. **Stop accepting connections** is not the same thing — it stops the connection but keeps the server, so setting up again would reuse it.

## Before you uninstall HashGG or change VPS

**Disconnect the VPS from StartOS *before* you destroy it or stop paying for it.** A server left connected to a VPS that has gone away stops being able to look up addresses on the internet, and that stops your mining as well — with nothing in the symptom pointing at the cause. Use **Start over**, which walks you through disconnecting it properly and checks that it worked.

## On StartOS 0.3.5.1

Not possible. The Bitcoin package rewrites its configuration every time it starts and only ever advertises its Tor address, so nothing can tell it about a public one. HashGG explains this rather than offering something that would not work. StartOS 0.4.0 supports it fully.

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

Click **Reset Connection** in the dashboard to clear your configuration:

- playit.gg mode: clears your secret key and tunnel configuration.
- VPS mode: clears the VPS host, port, and SSH keypair.
- If you had made your Bitcoin node reachable, that is switched off too — and HashGG shows you the line to remove from your Bitcoin node's settings, because a reset cannot do that for you.

To also remove HashGG's footprint *on the VPS* (the `hashgg` user, SSH config, and firewall rule) — for example when switching providers — use **Remove HashGG from this VPS…** on the dashboard before resetting. It gives you a copy-paste teardown script to run on the VPS as root.

After a reset you'll be returned to the tunnel-choice screen.

# Troubleshooting

**The check says your node did not answer.** The connection can be up while the port is still closed on the VPS. When the check fails, HashGG shows the command that opens it — run that on the VPS, and make sure your provider's own firewall page allows the same port.

**No inbound peers after a few hours.** Some patience is normal — other nodes have to learn your address before they connect, which usually takes a few hours. If a day passes with nothing, run the check again from **View details**; if it still answers, the address is reachable and the peers will come.

**Tunnel shows "connecting"** — The tunnel agent is starting up. Wait 10–30 seconds. If it persists, check that your server (and VPS, if applicable) has internet access.

**Datum shows "unreachable"** — Datum Gateway may not be running or its stratum port may have changed. Verify Datum Gateway is started and check the port in HashGG's config under **advanced > Datum Stratum Port** (default: 23335).

**Your mining endpoint went blank and nothing resolves (StartOS 0.4.0).** If you destroyed or stopped a VPS that was still connected to StartOS, the server keeps trying to reach it and name lookups stop working, which takes mining down with it. Disconnect it from StartOS — the Bitcoin setup has a step that does this and confirms it — and mining recovers within a minute.

**Playit claim flow times out** — The claim expires after 5 minutes. Click **Start Setup** again to generate a new one.

**VPS "Test Connection" fails with `Permission denied`** — The setup script may not have run successfully. Re-copy and re-run it on the VPS; check its final output for the "Verification" section. Most failures are caused by stale sshd_config or a home-directory mismatch — the latest setup script repairs both automatically.

**Miners can't connect** — Verify the Mining Endpoint is correct and the Tunnel status shows "Connected". Make sure your miner includes the full address *with* the port number.
