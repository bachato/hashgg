import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_7_0_0 = VersionInfo.of({
  version: '0.7.0:0',
  releaseNotes: {
    en_US:
      'Make your Bitcoin node reachable: a new Advanced section that gives your Bitcoin node a public address so other nodes can connect to it, without exposing your home IP. On StartOS, HashGG writes the StartTunnel setup commands for you and checks the result from the internet.',
  },
  // No state changes: the new fields are flat keys that back-fill from defaults
  // on load, and the feature starts switched off.
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
