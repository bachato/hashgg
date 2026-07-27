import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_7_0_0 = VersionInfo.of({
  version: '0.7.0:0',
  releaseNotes: {
    en_US:
      'Make your Bitcoin node reachable: a guided setup that gives your node a public address so other nodes can connect to it, without exposing your home internet connection. Written for people who have not used a terminal — where to get a small server, how to open a terminal, and exactly what to paste. HashGG sets the server up for you and then checks from the internet that your node really answers.',
  },
  // No state changes: the new fields are flat keys that back-fill from defaults
  // on load, and the feature starts switched off.
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
