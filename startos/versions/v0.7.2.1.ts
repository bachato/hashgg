import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_7_2_1 = VersionInfo.of({
  version: '0.7.2:1',
  releaseNotes: {
    en_US:
      'Accepts the BLAKE2b build of Datum Gateway as the Datum it depends on. Installing that ' +
      'build left HashGG reporting its dependency as the wrong version, and no version of either ' +
      'would have satisfied it.\n\n' +
      'The cause was in how the requirement was written rather than in either app. StartOS treats ' +
      'a version carrying a variant name as a separate line from the ordinary one, and a ' +
      'requirement that does not mention a variant matches only versions that have none. The ' +
      'requirement now covers both, with the same minimum version applied to each.\n\n' +
      'Nothing else changes, and this does not tie HashGG to one chain or the other. All HashGG ' +
      'asks of Datum is an address and a port to forward, so which chain the gateway builds for ' +
      'is not something it has an opinion about.',
  },
  // Nothing to migrate: this changes only the version range HashGG accepts for
  // its Datum dependency, which is evaluated live and stored nowhere.
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
