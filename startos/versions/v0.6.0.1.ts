import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_6_0_1 = VersionInfo.of({
  version: '0.6.0:1',
  releaseNotes: {
    en_US:
      'Fix a blank dashboard when a VPS tunnel is configured but not connected (e.g. a changed VPS host key) — the dashboard now always shows status and the Reset control. Includes the 0.6.0.0 features: additional miners, playit.gg cleanup, and VPS teardown.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
