'use strict';

// Which build of HashGG this is, and everything that must differ because of it.
//
//   flagship  — the original app. Pairs with the official Datum Gateway and, on
//               StartOS, makes the `bitcoind` package reachable.
//   companion — installs and runs *beside* the flagship. Pairs with the BLAKE2b
//               Datum Gateway and makes a companion node reachable instead.
//
// One codebase, two packages. The Datum endpoint already came from the
// environment (DATUM_HOST / DATUM_STRATUM_PORT / DATUM_REMOTE_PORT), so the
// packaging layer could always point a build at a different gateway without a
// code change. What could not vary, and is why this file exists, is the two
// things below: the playit.gg tunnel names and which node StartTunnel exposes.
// Both were constants, and both are actively wrong for a second installation.

const VARIANT = (process.env.HASHGG_VARIANT || 'flagship').trim().toLowerCase();

const IS_COMPANION = VARIANT === 'companion';

/**
 * The names this build gives its playit.gg tunnels.
 *
 * THESE MUST NOT OVERLAP BETWEEN VARIANTS, and the reason is worse than cosmetic.
 * An agent-key is account-scoped for tunnels: `POST /tunnels/list` returns every
 * tunnel in the user's account, not just this agent's. Cleanup then walks that
 * list, keeps anything whose name is not ours, keeps the one tunnel belonging to
 * our own agent, and calls everything else an orphan from a previous install.
 *
 * Every install mints its own agent. So with shared names, two installations on
 * one playit.gg account each see the other's *live* tunnel as an orphan and
 * offer it to the user for deletion, described as leftover from an old install.
 * Following that advice breaks a working setup, and the app said to do it.
 *
 * Distinct names make the two invisible to each other, because each cleanup only
 * ever considers names in its own set. Note this needs no change to an already
 * released flagship: it filters on its own names and has never heard of these.
 */
const TUNNEL_NAMES = IS_COMPANION
  ? { primary: 'hashgg-companion-stratum', extra: 'hashgg-companion-extra' }
  : { primary: 'hashgg-stratum', extra: 'hashgg-extra' };

/**
 * The nodes this build can make reachable from the internet on StartOS 0.4.0.
 *
 * `peerInternalPort` is the port the peer binding is registered under inside the
 * package, which is what `start-cli package host <id> binding peer` is keyed by.
 * It is not the external port and it is not the same across packages, so it
 * travels with the id rather than being defaulted at the call site.
 *
 * The flagship exposes `bitcoind`, which is the official Bitcoin package and also
 * the id Retropex's builds take. The companion must never expose that: its whole
 * purpose is the other chain, and advertising the wrong node is not a cosmetic
 * error. It offers the two companion nodes instead, and the caller picks whichever
 * is actually installed.
 */
const NODE_TARGETS = IS_COMPANION
  ? [
      {
        id: 'knots-blake2b',
        peerInternalPort: 18444,
        title: 'Bitcoin Knots (BLAKE2b) Companion',
      },
      {
        id: 'knots-prerdts',
        peerInternalPort: 58333,
        title: 'Bitcoin Knots (pre-RDTS)',
      },
    ]
  : [
      {
        id: 'bitcoind',
        peerInternalPort: 58333,
        title: 'Bitcoin',
      },
    ];

/**
 * How this build identifies itself in text a user reads on their own machines:
 * the playit.gg agent name and the comment on the SSH key it puts in a VPS's
 * authorized_keys. Both end up in lists where a user has to tell two
 * installations apart, and `hashgg@hashgg` twice tells them nothing.
 */
const IDENTITY = IS_COMPANION
  ? { agentLabel: 'HashGG Companion', sshKeyComment: 'hashgg-companion@hashgg' }
  : { agentLabel: 'HashGG', sshKeyComment: 'hashgg@hashgg' };

/** Every tunnel name this build owns, for cleanup's "is this one of mine" test. */
function ownTunnelNames() {
  return new Set([TUNNEL_NAMES.primary, TUNNEL_NAMES.extra]);
}

/** The node target for an id, or null if this build does not offer it. */
function nodeTarget(id) {
  return NODE_TARGETS.find((n) => n.id === id) || null;
}

module.exports = {
  VARIANT,
  IS_COMPANION,
  TUNNEL_NAMES,
  NODE_TARGETS,
  IDENTITY,
  ownTunnelNames,
  nodeTarget,
};
