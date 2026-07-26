import { i18n } from './i18n'
import { sdk } from './sdk'
import { uiPort } from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  console.info('Starting HashGG...')

  const mainSub = await sdk.SubContainer.of(
    effects,
    { imageId: 'main' },
    sdk.Mounts.of().mountVolume({
      volumeId: 'main',
      subpath: null,
      mountpoint: '/root',
      readonly: false,
    }),
    'hashgg-sub',
  )

  return sdk.Daemons.of(effects)
    .addDaemon('hashgg', {
      subcontainer: mainSub,
      exec: {
        command: ['docker_entrypoint.sh'],
        env: {
          DATUM_HOST: 'datum.startos',
          DATUM_STRATUM_PORT: '23334',
          LISTEN_PORT: '23335',
          DATUM_REMOTE_PORT: '23334',
          // Declared rather than inferred. Without it HashGG guesses the
          // platform, and a guess decides whether the Bitcoin reachability
          // feature offers the guided setup or hides itself.
          HASHGG_PLATFORM: 'startos-0.4',
          // Where Bitcoin Knots listens for peers. This is the PLAIN bind port:
          // 58334 is the whitebind listener, and forwarding that to the internet
          // would grant every anonymous peer whitelisted permissions on the
          // user's node. Declaring the right one is the protection; do not
          // replace this with a scan.
          BITCOIN_P2P_HOST: 'bitcoind.startos',
          BITCOIN_P2P_PORT: '58333',
          BITCOIN_P2P_WHITEBIND_PORT: '58334',
        },
      },
      ready: {
        display: i18n('HashGG Dashboard'),
        fn: () =>
          sdk.healthCheck.checkPortListening(effects, uiPort, {
            successMessage: i18n('The HashGG dashboard is ready'),
            errorMessage: i18n('The HashGG dashboard is not ready'),
          }),
      },
      requires: [],
    })
    .addHealthCheck('datum-reachable', {
      ready: {
        display: i18n('Datum Gateway Reachable'),
        fn: async () => {
          try {
            const { stdout } = await mainSub.exec([
              'sh',
              '-c',
              'nc -z -w2 datum.startos 23334',  // 0.4.0 datum-gateway uses 23334
            ])
            return {
              result: 'success',
              message: i18n('Datum Gateway stratum port is reachable'),
            }
          } catch (e) {
            return {
              result: 'failure',
              message: i18n('Datum Gateway stratum port is not reachable'),
            }
          }
        },
      },
      requires: ['hashgg'],
    })
})
