import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_6_0_0 = VersionInfo.of({
  version: '0.6.0:0',
  releaseNotes: {
    en_US:
      'Additional miners: expose extra stratum servers through their own tunnels (playit.gg or VPS) from a new Advanced section, each with live status. Playit.gg cleanup: delete leftover tunnels from previous installs to reclaim your quota. VPS: one-click teardown script to cleanly remove HashGG from a VPS. Plus broad robustness hardening of the tunnel supervisor.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
