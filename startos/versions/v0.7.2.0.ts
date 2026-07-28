import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_7_2_0 = VersionInfo.of({
  version: '0.7.2:0',
  releaseNotes: {
    en_US:
      'You can now make your Bitcoin node reachable without setting up mining. It is offered on the first screen alongside the tunnel choices, and if you stop there the dashboard treats mining as a choice you have not made rather than something wrong. One VPS can carry both jobs whichever order you set them up in, and a second HashGG installation can share the same server without disturbing the first.',
  },
  // Nothing to migrate: "is HashGG set up" is inferred from the two records
  // that already exist rather than stored, so there is no new field and no
  // stored value whose meaning has changed.
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
