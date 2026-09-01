import { i18n } from './i18n'
import { sdk } from './sdk'
import { uiPort } from './utils'
import { DATUM, NODE_PRIMARY, PACKAGE, VARIANT } from './variant'

export const main = sdk.setupMain(async ({ effects }) => {
  console.info(`Starting ${PACKAGE.title}...`)

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

  /**
   * The node this build declares as its Bitcoin peer target.
   *
   * Only the primary is declared here. The backend keeps an ordered candidate
   * list and probes it (`app/backend/bitcoin-p2p.js`), and the companion's second
   * node is added to that list from `app/backend/variant.js`, so which one is
   * actually reachable is decided at run time rather than guessed at pack time.
   * A node can be installed and stopped, which only a probe can tell.
   *
   * THE PORT IS THE PLAIN BIND, NEVER THE WHITEBIND. knots-blake2b binds peers on
   * 18444 and whitebinds on 18445; knots-prerdts uses 58333 and 58334. Forwarding
   * a whitebind listener to the internet would hand every anonymous peer the noban
   * and download permissions that listener exists to grant trusted local services.
   */
  const node = NODE_PRIMARY

  return sdk.Daemons.of(effects)
    .addDaemon('hashgg', {
      subcontainer: mainSub,
      exec: {
        command: ['docker_entrypoint.sh'],
        env: {
          DATUM_HOST: DATUM.host,
          DATUM_STRATUM_PORT: String(DATUM.stratumPort),
          LISTEN_PORT: '23335',
          DATUM_REMOTE_PORT: String(DATUM.stratumPort),
          // Declared rather than inferred. Without it HashGG guesses the
          // platform, and a guess decides whether the Bitcoin reachability
          // feature offers the guided setup or hides itself.
          HASHGG_PLATFORM: 'startos-0.4',
          // Read by app/backend/variant.js for the tunnel names and node targets.
          HASHGG_VARIANT: VARIANT,
          // Where Bitcoin Knots listens for peers. This is the PLAIN bind port:
          // 58334 is the whitebind listener, and forwarding that to the internet
          // would grant every anonymous peer whitelisted permissions on the
          // user's node. Declaring the right one is the protection; do not
          // replace this with a scan.
          BITCOIN_P2P_HOST: `${node.id}.startos`,
          BITCOIN_P2P_PORT: String(node.peerPort),
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
