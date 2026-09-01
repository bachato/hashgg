import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_7_2_2 = VersionInfo.of({
  version: '0.7.2:2',
  releaseNotes: {
    en_US:
      'Corrects how the Companion build describes itself. It said it was for the BLAKE2b ' +
      'chain, which reads as though the ordinary HashGG is not, and that is wrong: HashGG ' +
      'works with whichever app holds the Datum Gateway slot, whatever chain that build ' +
      'follows. The difference between the two is which gateway they pair with. The ' +
      'Companion exists so a second gateway can be exposed alongside the first, not because ' +
      'it serves a different chain.\n\n' +
      'Nothing about either build changed, only what they say about themselves.',
  },
  // Nothing to migrate: this version changes description text and nothing that is
  // stored, read or acted upon.
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
