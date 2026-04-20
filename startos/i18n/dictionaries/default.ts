export const DEFAULT_LANG = 'en_US'

const dict = {
  // main.ts
  'HashGG Dashboard': 0,
  'The HashGG dashboard is ready': 1,
  'The HashGG dashboard is not ready': 2,
  'Datum Gateway Reachable': 3,
  'Datum Gateway stratum port is reachable': 4,
  'Datum Gateway stratum port is not reachable': 5,

  // interfaces.ts
  'Web UI': 10,
  'The HashGG dashboard for managing the HashGG tunnel (playit.gg or VPS SSH)': 11,
} as const

export type LangDict = { [K in (typeof dict)[keyof typeof dict]]?: string }

export default dict
