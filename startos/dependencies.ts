import { sdk } from './sdk'

export const setDependencies = sdk.setupDependencies(async ({ effects }) => {
  return {
    datum: {
      kind: 'running',
      // Two terms, because a flavored version never satisfies an unflavored range.
      //
      // `>=0.4.1:3` alone is scoped to the null flavor: a range with no flavor term
      // normalizes to `#`, so `#pow:0.4.1:17` reads as out of range and the
      // dependency shows as unsatisfied with nothing wrong. That is what Retropex's
      // BLAKE2b fork ships as, and it declares no `satisfies` list to be accepted as
      // an unflavored version instead, so nothing else can bridge it.
      //
      // The floor is repeated inside the flavor rather than writing a bare `#pow`,
      // which would accept any pow version including one below the minimum. `&&`
      // cannot combine the two: `#pow && >=0.4.1:3` is an empty set, since the
      // second term is already scoped to unflavored.
      //
      // Nothing here endorses a chain. HashGG's whole use of Datum is a hostname,
      // port 23334 and a TCP reachability check, so it is indifferent to which chain
      // the gateway builds for.
      versionRange: '>=0.4.1:3 || >=#pow:0.4.1:3',
      healthChecks: ['stratum-interface'],
    },
  }
})
