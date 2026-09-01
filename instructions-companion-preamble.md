# HashGG Companion

This is HashGG, pointed at the BLAKE2b side of your setup. Everything below the next heading is the ordinary HashGG guide and applies unchanged; this section is the only part that differs.

## What is different

It pairs with **Datum Gateway (BLAKE2b) Companion**, not the ordinary Datum Gateway. That is the only gateway it will connect to, and it is listed as a requirement, so StartOS will tell you if it is missing.

It **installs beside the ordinary HashGG** rather than replacing it. Both can run at once, each exposing its own gateway. They keep separate settings, separate playit.gg tunnels, and separate access to any VPS they share, so setting one up never disturbs the other. If you run both, the tile with **COMPANION** across the bottom of the icon is this one.

If you use the **make your Bitcoin node reachable** feature, this one offers your companion node: the BLAKE2b node, or the pre-RDTS node, whichever you have running. It never touches the main Bitcoin package. The ordinary HashGG is the one that does that, which is why the two do not collide.

## A note on the first sync

Until your companion node has finished syncing, the gateway cannot produce work, and this app will show its Datum requirement as unsatisfied. That is expected and needs no action. A Datum Gateway does not open its stratum port until it has its first block template, and it cannot get one from a node that is still catching up. On a fresh node that wait is hours. Both the gateway and this app say they are waiting rather than reporting a fault.

---

