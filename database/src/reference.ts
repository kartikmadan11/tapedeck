// Real FTSE tickers at indicative levels, so the blotter looks like a blotter
// rather than like fixtures. The seed walks each price to produce a spread.

export interface Instrument {
  symbol: string
  name: string
  /** Indicative level as quoted, as an exact decimal string. */
  referencePrice: string
  /** Typical ticket size, used to scale quantities. */
  lotSize: number
}

export const INSTRUMENTS: readonly Instrument[] = [
  { symbol: 'VOD', name: 'Vodafone Group', referencePrice: '68.420000', lotSize: 50_000 },
  { symbol: 'BARC', name: 'Barclays', referencePrice: '192.350000', lotSize: 25_000 },
  { symbol: 'HSBA', name: 'HSBC Holdings', referencePrice: '648.700000', lotSize: 10_000 },
  { symbol: 'BP', name: 'BP', referencePrice: '412.150000', lotSize: 15_000 },
  { symbol: 'SHEL', name: 'Shell', referencePrice: '2714.500000', lotSize: 2_000 },
  { symbol: 'AZN', name: 'AstraZeneca', referencePrice: '10842.000000', lotSize: 500 },
  { symbol: 'GSK', name: 'GSK', referencePrice: '1456.800000', lotSize: 5_000 },
  { symbol: 'ULVR', name: 'Unilever', referencePrice: '4538.000000', lotSize: 1_500 },
  { symbol: 'RIO', name: 'Rio Tinto', referencePrice: '4821.500000', lotSize: 1_500 },
  { symbol: 'LLOY', name: 'Lloyds Banking Group', referencePrice: '54.280000', lotSize: 100_000 },
  { symbol: 'TSCO', name: 'Tesco', referencePrice: '338.900000', lotSize: 20_000 },
  { symbol: 'NG', name: 'National Grid', referencePrice: '1024.500000', lotSize: 7_500 },
]

export const TRADERS: readonly string[] = [
  'a.patel',
  'j.okonkwo',
  'm.lindqvist',
  's.fernandes',
  'r.chatterjee',
  'd.okafor',
  'l.moreau',
  'k.yamamoto',
]

/** Re-exported, not declared: a second copy drifts out of the one that rejects. */
export { BOOKS } from '@tapedeck/shared'

/** Recorded on seeded events, so seeded history is distinguishable. */
export const SEED_ACTOR = 'seed'
