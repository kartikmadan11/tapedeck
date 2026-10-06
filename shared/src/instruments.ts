/**
 * The instruments a trade may be booked against, at indicative levels. In the
 * contract because the booking schema, the form, the seed and the feed all read
 * it. `as const` so z.enum gets the literal union, which makes a mistyped ticker
 * a compile error rather than a 400.
 */
export const INSTRUMENTS = [
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
] as const

export type Instrument = (typeof INSTRUMENTS)[number]

/** Every tradeable ticker, which is what the booking schema is an enum over. */
export const SYMBOLS = INSTRUMENTS.map((instrument) => instrument.symbol)

/** Ticker rather than Symbol, which is a built-in type name. */
export type Ticker = Instrument['symbol']
