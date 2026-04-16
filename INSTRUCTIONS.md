# Welcome to HashGG!

HashGG tunnels your Datum Gateway stratum port to the internet via [playit.gg](https://playit.gg), letting miners connect from anywhere — no port forwarding, no VPN, no static IP needed.

# Quick Start

1. Sign up for a [playit.gg](https://playit.gg) account and **upgrade to Premium** (~$3/month) — see below for why this is required.
2. Install and configure **Datum Gateway** on your StartOS server.
3. Start **HashGG** and open its dashboard.
4. Click **Start Setup** and visit the claim URL that appears. Log in to your playit.gg account and approve the connection.
5. Once approved, HashGG will automatically configure the tunnel and display your **Mining Endpoint** — a public address.
6. Point your miners at that endpoint using `stratum+tcp://host:port`.

That's it. Your miners can now reach your Datum Gateway from anywhere on the internet.

# The Dashboard

HashGG has a simple web dashboard accessible from your StartOS UI. It shows:

- **Mining Endpoint** — the public address to put in your miners. Click **Copy** to copy the full `stratum+tcp://` URL.
- **Tunnel** — whether the playit.gg tunnel is connected.
- **Datum Gateway** — whether Datum Gateway's stratum port is reachable.
- **Agent** — whether the playit.gg agent process is running.

# Setup Options

## Option 1: Claim Flow (Recommended)

When HashGG starts for the first time (with no secret key configured), it shows a setup screen. Click **Start Setup** — HashGG will generate a claim URL. Visit that URL in your browser, log in to playit.gg, and approve the connection. HashGG detects the approval automatically and sets everything up.

## Option 2: Manual Secret Key

If you already have a playit.gg agent secret key, you can enter it directly:

1. Go to the HashGG dashboard and click **"Enter secret key manually"**.
2. Paste your secret key and submit.

You can also set the secret key in HashGG's StartOS config under **playit > Secret Key**.

# Setting Up Your Miners

Point your miners to the **Mining Endpoint** shown in the HashGG dashboard. It will look something like:

`stratum+tcp://xx-xx-xx-xx.gl.joinplayit.gg:12345`

For **Username/Worker**, follow the same conventions as your Datum Gateway setup — typically a Bitcoin address, optionally with a worker name appended (e.g. `bc1q...address.worker1`).

**Password** can be left blank or set to `x`.

# playit.gg Account

HashGG requires a **playit.gg Premium** account (~$3/month). You can sign up and upgrade at [playit.gg/account/premium](https://playit.gg/account/premium).

**Why Premium?** The free tier only offers game-specific tunnel types (Minecraft, Terraria, etc.) that inspect protocol traffic at the relay. Stratum mining traffic is rejected by these tunnels. Premium unlocks raw TCP tunnels, which forward traffic without inspection — exactly what mining needs.

At ~$3/month, playit.gg Premium is the simplest and cheapest way to expose a port through NAT/CGNAT without running your own VPS.

# Resetting

If you need to start fresh (e.g. to use a different playit.gg account), click the **Reset** button in the dashboard. This clears your secret key and tunnel configuration. You'll go through the claim flow again.

# Troubleshooting

**Tunnel Status shows "connecting"** — The playit agent is starting up. Wait 10–30 seconds. If it persists, check that your server has internet access.

**Datum Status shows "unreachable"** — Datum Gateway may not be running or its stratum port may have changed. Verify Datum Gateway is started and check the port in HashGG's config under **advanced > Datum Stratum Port** (default: 23335).

**Claim flow times out** — The claim expires after 5 minutes. Click **Start Setup** again to generate a new one.

**Miners can't connect** — Verify the Mining Endpoint is correct and the tunnel status shows "Connected". Make sure your miner is using the full address including the port number. If the endpoint looks correct but miners still can't reach it, try clicking **Reset** and going through setup again.
