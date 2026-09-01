/**
 * Which package this build produces, and everything the packaging layer must
 * change because of it.
 *
 * The counterpart of `app/backend/variant.js`, which handles what the running
 * application must change. Both read the same `HASHGG_VARIANT`, but they read it
 * at different times: this one at pack time, to decide what goes in the manifest,
 * and that one at run time. The Dockerfile carries the value across.
 *
 *   flagship  — `hashgg`, paired with the official Datum Gateway.
 *   companion — `hashgg-companion`, installed beside it and paired with the
 *               BLAKE2b Datum Gateway.
 *
 * Two packages, one repo. Keeping them here rather than in a forked tree is the
 * point: a fix to the tunnel logic, the VPS flow or the UI lands once.
 */

export type Variant = 'flagship' | 'companion'

export const VARIANT: Variant =
  (process.env.HASHGG_VARIANT || '').trim().toLowerCase() === 'companion'
    ? 'companion'
    : 'flagship'

export const IS_COMPANION = VARIANT === 'companion'

/**
 * The Datum Gateway this build pairs with.
 *
 * `host` follows from `id`: StartOS gives every package a `<id>.startos` name on
 * the internal network, so the two cannot drift.
 *
 * `stratumPort` differs and is not a detail. The BLAKE2b gateway deliberately
 * sits on 23336 so it can run beside the official one on 23334; pointing a build
 * at the right host and the wrong port reaches a port nothing is listening on.
 *
 * `versionRange` for the companion starts at 1.0.0:40, which is the version that
 * added the `stratum-interface` health check named below. An earlier one would
 * satisfy the range and then fail the health requirement, since StartOS treats a
 * check id that does not exist exactly like one that is failing.
 *
 * The flagship's range carries a second term for the `pow` flavor, because a
 * flavored version never satisfies an unflavored range and Retropex's BLAKE2b
 * build of the official gateway declares no `satisfies` list to bridge it.
 */
export const DATUM = IS_COMPANION
  ? {
      id: 'datum-blake2b',
      host: 'datum-blake2b.startos',
      stratumPort: 23336,
      versionRange: '>=1.0.0:40',
      title: 'Datum Gateway (BLAKE2b) Companion',
    }
  : {
      id: 'datum',
      host: 'datum.startos',
      stratumPort: 23334,
      versionRange: '>=0.4.1:3 || >=#pow:0.4.1:3',
      title: 'Datum Gateway',
    }

/**
 * The health check required of that gateway.
 *
 * The same id for both, which is why `stratum-interface` was added to the BLAKE2b
 * gateway rather than this depending on whatever that package happened to expose.
 * It answers the only question this app cares about: can a miner connect.
 */
export const DATUM_HEALTH_CHECKS = ['stratum-interface']

/** Package identity. */
export const PACKAGE = IS_COMPANION
  ? { id: 'hashgg-companion', title: 'HashGG Companion' }
  : { id: 'hashgg', title: 'HashGG' }

/**
 * The Bitcoin node this build declares as its peer target.
 *
 * The flagship has one answer, `bitcoind`, which is the official package and also
 * the id Retropex's builds take. The companion must never expose that: its whole
 * purpose is the other chain, and advertising the wrong node is not cosmetic.
 *
 * Only the primary lives here. The companion's full candidate list, which the
 * backend probes at run time, is in `app/backend/variant.js`.
 */
export const NODE_PRIMARY = IS_COMPANION
  ? { id: 'knots-blake2b', peerPort: 18444 }
  : { id: 'bitcoind', peerPort: 58333 }
