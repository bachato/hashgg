import { setupManifest } from '@start9labs/start-sdk'
import { short, long, datumDescription } from './i18n'
import { PACKAGE, DATUM } from '../variant'

export const manifest = setupManifest({
  id: PACKAGE.id,
  title: PACKAGE.title,
  license: 'mit',
  packageRepo: 'https://github.com/paulscode/hashgg',
  upstreamRepo: 'https://github.com/playit-cloud/playit-agent',
  marketingUrl: 'https://github.com/paulscode/hashgg',
  donationUrl: null,
  docsUrls: [],
  description: { short, long },
  volumes: ['main'],
  images: {
    main: {
      source: {
        dockerBuild: {
          dockerfile: 'Dockerfile',
          workdir: '.',
        },
      },
      arch: ['x86_64', 'aarch64'],
    },
  },
  alerts: {
    install: null,
    update: null,
    uninstall: null,
    restore: null,
    start: null,
    stop: null,
  },
  dependencies: {
    [DATUM.id]: {
      description: datumDescription,
      optional: false,
      metadata: {
        title: DATUM.title,
        icon: 'https://raw.githubusercontent.com/Start9Labs/datum-gateway-startos/next/icon.svg',
      },
    },
  },
})
