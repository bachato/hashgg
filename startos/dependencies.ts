import { sdk } from './sdk'
import { DATUM, DATUM_HEALTH_CHECKS } from './variant'

export const setDependencies = sdk.setupDependencies(async ({ effects }) => {
  return {
    [DATUM.id]: {
      kind: 'running',
      // Both the id above and this range come from the variant, because the two
      // builds pair with different gateways.
      //
      // The flagship's range carries two terms. A flavored version never satisfies
      // an unflavored range: `>=0.4.1:3` normalizes to the null flavor, so
      // `#pow:0.4.1:17`, which is what Retropex's BLAKE2b build of the official
      // gateway installs as, reads as out of range with nothing wrong. Normally a
      // flavored package bridges that with a `satisfies` list; that one declares
      // none, so the second term has to be here. The floor is repeated inside the
      // flavor rather than writing a bare `#pow`, which would accept a version
      // below the minimum, and `&&` cannot express it because `#pow && >=0.4.1:3`
      // is an empty set.
      //
      // The companion's range starts at the version that added the health check
      // below. Satisfying the range and then failing the health requirement is a
      // worse failure than not matching at all, because it presents as the
      // dependency being broken rather than being too old.
      versionRange: DATUM.versionRange,
      healthChecks: DATUM_HEALTH_CHECKS,
    },
  }
})
