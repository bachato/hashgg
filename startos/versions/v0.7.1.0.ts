import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_7_1_0 = VersionInfo.of({
  version: '0.7.1:0',
  releaseNotes: {
    en_US:
      'Fixes for running HashGG alongside Bitcoin on macOS, and clearer setup instructions. No change to how the app itself works.',
  },
  // Nothing to migrate: this release changes host-side helper scripts and
  // documentation, not anything the app stores.
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
