import { IS_COMPANION } from '../variant'

/**
 * Descriptions, per variant.
 *
 * The companion is the same application pointed at a different gateway, so these
 * say what differs rather than restating what HashGG is. The one thing worth being
 * explicit about is that it installs *beside* the flagship rather than replacing
 * it, because two tiles with the same logo is otherwise a puzzle.
 */

export const short = IS_COMPANION
  ? {
      en_US:
        'Expose the BLAKE2b Datum Gateway to the internet, alongside HashGG',
    }
  : {
      en_US: 'Expose Datum Gateway to the internet via playit.gg',
    }

export const long = IS_COMPANION
  ? {
      en_US:
        'HashGG Companion connects the stratum port of Datum Gateway (BLAKE2b) Companion to the public internet through playit.gg tunneling. No port forwarding or static IP required. Miners anywhere can connect using the public endpoint shown in the dashboard.\n\n' +
        'It installs and runs beside the ordinary HashGG rather than replacing it, so one server can expose both gateways at once. The two keep separate settings, separate tunnels and separate access to any VPS they share.\n\n' +
        'It can also make a companion Bitcoin node reachable from the internet, either the BLAKE2b node or the pre-RDTS one, whichever you have running. The ordinary HashGG does that for the main Bitcoin package, and this one deliberately never touches it.',
    }
  : {
      en_US:
        'HashGG connects your Datum Gateway stratum port to the public internet through playit.gg tunneling. No port forwarding or static IP required. Miners anywhere can connect to your gateway using the public endpoint displayed in the dashboard.',
    }

export const datumDescription = IS_COMPANION
  ? {
      en_US:
        'Datum Gateway (BLAKE2b) Companion provides the stratum server that this exposes to the internet.',
    }
  : {
      en_US:
        'Datum Gateway provides the stratum server that HashGG exposes to the internet.',
    }
