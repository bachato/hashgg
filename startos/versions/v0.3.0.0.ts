import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_3_0_0 = VersionInfo.of({
  version: '0.3.0:0',
  releaseNotes: {
    en_US: 'Add VPS SSH tunnel option as a privacy-focused alternative to playit.gg (Bitcoin-funded via BitLaunch, no fiat required). Existing playit.gg users are unaffected — tunnel mode migrates automatically.',
  },
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
