<p align="center">
  <img src="logo.png" alt="HashGG" width="200">
</p>

# HashGG

**Sovereign hash routing for StartOS. No port forwarding. No static IP. No middleman.**

HashGG exposes your [Datum Gateway](https://github.com/ocean-xyz/datum-gateway) stratum port to the public internet — so any miner, anywhere, can connect to *your* node and mine blocks *you* built. Choose between two tunnel options:

- **playit.gg** (~$3/month, fiat) — easiest setup, managed service
- **VPS SSH tunnel** (~$11/month, Bitcoin) — privacy-focused, full control, no third-party dependency on the data path

---

## Why "GG"?

"GG" — short for *good game* — is what players say when a match is over. Not as trash talk. As a statement of fact: the outcome is clear, the deciding move already happened, and everyone at the table knows it.

That's the energy here.

Centralized mining pools have been the dominant strategy for over a decade — convenient, default, and seemingly unassailable. But the dominance was never about superiority. It was about friction. Running your own mining infrastructure was hard, and pointing real hashpower at it was harder.

Those barriers are falling. Datum Gateway lets you build your own block templates. OCEAN pays you non-custodially. Braiins Hashpower lets you rent petahashes on demand. The only piece missing was making your stratum port reachable from the outside world without being a network engineer.

HashGG is that piece. And once the friction is gone, the incentives do the rest. When anyone can easily route hashpower through their own node — choosing their own transactions, their own signaling, their own policies — the old centralized model stops being the default. It becomes *optional*. And that's when the game changes.

Not with a bang. Just a quiet recognition that the dominant strategy isn't dominant anymore.

Pool centralization: *gg.*

---

## What It Does

HashGG is a [StartOS](https://start9.com) service that runs alongside Datum Gateway on your Start9 server. It:

1. Manages a tunnel between your Datum Gateway stratum port and the public internet — via either [playit.gg](https://playit.gg) or an SSH reverse tunnel to a VPS you control
2. Supervises the tunnel agent and reconnects automatically
3. Gives you a public `stratum+tcp://` endpoint you can hand to any miner

No router configuration. No dynamic DNS. No VPN. Works behind NAT, double NAT, CGNAT — whatever your ISP throws at you.

### How it works

**playit.gg mode:**
```
Your miners ──→ playit.gg relay ──→ HashGG tunnel ──→ Datum Gateway ──→ OCEAN pool
  (anywhere)      (internet)       (your Start9)     (your Start9)     (non-custodial payout)
```

**VPS SSH tunnel mode:**
```
Your miners ──→ your VPS ──→ SSH reverse tunnel ──→ Datum Gateway ──→ OCEAN pool
  (anywhere)     (public IP)     (your Start9)      (your Start9)     (non-custodial payout)
```

Your Start9 server builds its own block templates using your own Bitcoin node. Datum Gateway serves those templates to miners via the stratum protocol. HashGG punches a hole through your NAT so miners can reach it from anywhere — without touching your router.

## Requirements

HashGG runs two ways — pick the one that matches your setup:

- **On StartOS** (primary): a [Start9](https://start9.com) server running **StartOS 0.3.5.1** or **0.4.0**. Follow [Quick Start (StartOS)](#quick-start-startos) below.
- **On your own computer** running Bitcoin Knots directly — Linux or macOS: run [`./start-hashgg.sh`](#running-hashgg-on-your-own-computer-without-startos), which sets up everything for you.

Either path, you'll also need:

- **[Datum Gateway](https://github.com/ocean-xyz/datum-gateway)** running alongside Bitcoin Knots.
- One of:
  - A [playit.gg](https://playit.gg) account with **Premium** (~$3/month) — [why?](#why-premium), **or**
  - A VPS with root SSH access (any Debian, Ubuntu, or RHEL-family distro). We recommend [BitLaunch](https://app.bitlaunch.io/signup) (~$11/month, funded with Bitcoin, anonymous signup).

## Quick Start (StartOS)

1. Install **Datum Gateway** on your StartOS server (requires Bitcoin Knots)
2. Install **HashGG** from the StartOS marketplace (or sideload the `.s9pk`)
3. Open the HashGG dashboard and pick your tunnel method:
   - **playit.gg** — approve a one-time claim URL in your browser, then you're done
   - **VPS** — provision a VPS, paste one setup script into its root shell, enter its IP in the HashGG UI
4. Copy your public mining endpoint
5. Point your miners to it

That's it. Your miners can now connect to your Datum Gateway from anywhere on the internet.

---

## Running HashGG on your own computer (without StartOS)

If you run Bitcoin Knots directly — say `bitcoin-qt` on a Linux Mint desktop or a Mac — you can run HashGG on the same machine. Datum Gateway sits between your node and your miners, and HashGG runs in Docker alongside it.

### Quick start — one script

```bash
git clone https://github.com/paulscode/hashgg.git
cd hashgg
./start-hashgg.sh
```

That's the whole thing. The script walks the entire chain and asks before anything that changes your system:

1. checks for Docker, curl and jq
2. finds Bitcoin Knots — including when `bitcoin-qt` uses a data directory you picked yourself — and audits `bitcoin.conf`
3. installs, configures and starts Datum Gateway if it isn't already
4. starts HashGG, then confirms it can actually reach Datum before telling you it worked

It's safe to re-run: each step detects what's already done and skips it.

When it finishes it prints the three addresses you need:

| | | |
| --- | --- | --- |
| **Datum Gateway** | `http://127.0.0.1:7152` | payout address, coinbase tags, pool or solo |
| **HashGG** | `http://localhost:3000` | tunnel setup and your public mining endpoint |
| **Stratum (local)** | `127.0.0.1:23335` | for miners on this machine or your LAN |

Start with **Datum Gateway** — set your payout address and coinbase tag there first — then use **HashGG** to pick a tunnel (**playit.gg** or **VPS**) and point your miners at the public endpoint it gives you.

> **Saving settings in Datum's dashboard.** Datum refuses to save from its web UI unless its config has *both* an admin password and `modify_conf` enabled — miss either and the form is read-only with no obvious explanation. The script checks for this and offers to turn it on, generating a password and showing it once (it lives in `~/.config/datum_gateway/datum_gateway.json` as `api.admin_password`). The username is `admin`. Datum's dashboard binds to `127.0.0.1` only, so it's reachable from that machine and nowhere else.

**It never edits `bitcoin.conf`.** That file belongs to your node, so when a setting is missing the script prints the exact lines and waits while you paste them in and restart Knots.

Other commands:

```bash
./start-hashgg.sh status      # what's running
./start-hashgg.sh logs        # follow HashGG's logs ('logs datum' for Datum)
./start-hashgg.sh down        # stop HashGG and Datum; your node is left alone
./start-hashgg.sh help        # all options
```

Useful environment overrides:

| Variable | Purpose |
| --- | --- |
| `HASHGG_IMAGE` | Run a different image — e.g. `paulscode/hashgg:latest` after `make docker-build-local` |
| `HASHGG_UI_PORT` | Dashboard port (default `3000`) |
| `HASHGG_STATE_DIR` | Where generated files live (default `~/.local/state/hashgg`) |

### Prerequisites

- **Bitcoin Knots** (as `bitcoin-qt` or `bitcoind`) already installed and running.
- **Docker** — Docker Engine + the Compose v2 plugin on Linux (`sudo apt install docker.io docker-compose-v2`, then add yourself to the `docker` group and log out/in), or Docker Desktop on macOS.
- **curl, jq and git.** On Linux: `sudo apt install curl jq git`. On macOS: `brew install jq` (curl and git ship with Xcode's command line tools).
- **Linux:** a Debian-based distribution for the automatic Datum build — tested on Linux Mint, and fine on Debian, Ubuntu, Zorin and relatives. RHEL/Fedora/Arch/openSUSE users can still run everything, but Datum has to be installed with your own distro's tooling first; the build step here is apt-based.

> **Before you start — wallet note.** Datum Gateway gets full RPC access to whatever Bitcoin Knots node it points at. If that Knots has a loaded wallet with real funds, **a compromise of Datum is a compromise of the wallet**. Either use a dedicated Knots instance with `disablewallet=1` for mining, or confirm no meaningful funds live on this node before continuing.

### A note for macOS

macOS works, with one wrinkle worth knowing up front.

Datum Gateway **cannot be built natively on macOS** — it uses Linux's `epoll` and glibc's `argp`, and upstream ships no macOS build path. So on a Mac the script runs Datum in Docker instead, building the image from the pinned upstream release the first time (a few minutes).

The consequence: Datum then reaches your node across Docker's virtual network rather than over loopback, so Bitcoin's RPC has to accept it. The script detects this and prints the exact `bitcoin.conf` lines — but understand what they do. **Your node's RPC stops being loopback-only**, which means anything that can reach your Mac on the RPC port can attempt to authenticate. Keep the macOS firewall on, and prefer a mining node with `disablewallet=1`.

On Linux none of this applies: Datum runs natively on the host and RPC stays on loopback.

### Doing it by hand

The script is a wrapper — every step is available separately if you'd rather drive it yourself. See [`host-setup/README.md`](host-setup/README.md) for the individual Datum Gateway commands (`check-knots`, `build`, `configure`, `open-firewall`, `run`, `install-daemon`), and the repo's `docker-compose.yml` for a plain HashGG container.

`install-daemon` is worth knowing about if you run `bitcoind` as a service: it turns the Datum install into a systemd unit instead of a background process, so it survives reboots.

### Managing tunnels

The dashboard has a few extras once you're connected:

- **Additional miners (Advanced)** — expose a second (or more) stratum server through its own tunnel, in either mode. Enter the other server's IP/port; HashGG provisions a separate tunnel and shows its endpoint and live status.
- **Clean up old playit.gg tunnels** (playit mode) — reinstalling creates fresh playit.gg agents/tunnels each time; this finds and deletes the leftover *tunnels* from previous installs (it never touches your active tunnel or non-HashGG tunnels), and points you to the playit dashboard to remove leftover *agents* (which only that site can delete).
- **Remove HashGG from this VPS** (VPS mode) — a copy-paste teardown script that removes the `hashgg` user, SSH config, and firewall rule from a VPS you're decommissioning.

### Security notes

- HashGG's web UI ships with **no authentication**. The default compose binding is loopback-only for that reason. Don't expose port 3000 to the LAN without a reverse proxy + auth in front.
- Datum's admin API is bound to `127.0.0.1:7152` by our config generator — reachable from the host, not from the LAN. (On macOS, where Datum runs in a container, it listens on all interfaces *inside* that container but is only published to `127.0.0.1` on your Mac, which comes to the same thing.)
- **Linux:** the Docker bridge → Datum firewall rule uses `172.16.0.0/12` (the full RFC1918 range Docker allocates bridge networks from). Any container on your Docker daemon can therefore reach Datum's stratum port. On a single-user workstation that's fine; on a shared host it's a consideration.
- **macOS:** running Datum in a container means Bitcoin's RPC has to accept connections from Docker's network rather than loopback alone. That is a real widening — keep the macOS firewall on, and prefer a mining node with `disablewallet=1`. See [A note for macOS](#a-note-for-macos) above.
- The VPS SSH private key (VPS mode) and the playit secret (playit mode) are stored in the `hashgg-data` named Docker volume. Back them up like credentials.

---

### Why Premium?

playit.gg's free tier only offers game-specific tunnel types (Minecraft, Terraria, etc.) that inspect traffic at the relay and reject anything that isn't the expected game protocol. Mining stratum traffic gets rejected by these tunnels. Premium unlocks raw TCP tunnels that forward traffic without inspection — exactly what mining needs. At ~$3/month, it's the cheapest way to expose a port through NAT without running your own VPS.

---

## Why This Matters

### Block template sovereignty

When you mine through a centralized pool, the pool decides what goes in your blocks — which transactions to include, which soft forks to signal for, which policies to enforce. You provide the hashpower; they make all the decisions.

Datum Gateway flips this. It lets you build your own block templates with your own Bitcoin node, then submit them to [OCEAN](https://ocean.xyz) for non-custodial payout. You choose the transactions. You choose the signaling. The pool just coordinates the work.

But Datum Gateway has a problem: it listens on a local port. If your Start9 is behind a home router (and it almost certainly is), miners outside your local network can't reach it.

**HashGG solves that.** It tunnels your stratum port to the internet so any miner can connect — whether it's your Bitaxe in the garage, an S21 at a friend's house, or petahashes of rented hashpower from a marketplace.

### Rented hashpower changes the scale

Home miners running a Bitaxe or a few ASICs bring sovereignty but limited hashrate. A top-of-the-line Bitaxe tops out around 2 TH/s. That's real mining, and it matters for decentralization — but it won't move the hashrate distribution chart.

[Braiins Hashpower](https://hashpower.braiins.com/) changes the calculus. It's a real-time hashrate marketplace where anyone can rent SHA-256 mining power — starting at 1 PH/s — and point it at any stratum endpoint. Including yours.

**Any stratum endpoint. Including the one HashGG gives you.**

The gross cost isn't trivial, but mining earns most of it back. You're paying for the *delta* — the net cost after block rewards — which can be single-digit percentages of the gross. The hashrate nearly pays for itself; what you're really buying is *control*.

Here's the pipeline:

1. **Your Bitcoin node** builds block templates with the transactions and signaling you choose
2. **Datum Gateway** serves those templates to miners via the stratum protocol
3. **HashGG** punches the stratum port through to the internet — no router config needed
4. **Braiins Hashpower** delivers PH/s-scale hashrate to your endpoint on demand
5. **OCEAN** coordinates the mining and pays you directly, non-custodially

The result: a sovereign operator at home, commanding petahashes of mining power — all of it building blocks *they* designed, with transactions *they* selected, signaling for the consensus rules *they* support.

### The big picture

Centralized pools have held the dominant position for years because they're convenient and the alternatives weren't practical. HashGG eliminates one of the last friction points — network accessibility — making it trivial to route real hashpower through your own node.

When enough people can easily point hashpower at their own block templates, the game theory that sustains pool centralization starts to unravel. Not all at once. But inevitably.

gg

---

## Status

Beta. All core functionality works — HashGG has been tested end-to-end with real ASIC miners connecting through the tunnel and receiving work from Datum Gateway. The aarch64 (ARM) build exists but has not been tested on ARM hardware.

## License

MIT
