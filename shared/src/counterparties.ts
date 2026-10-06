/**
 * The counterparties a trade may be booked against. Part of the contract rather
 * than of the seed's reference data, because three things have to agree on it:
 * `createTradeInput` validates against it, the booking form is a picklist over
 * it, and the generated feed books from it.
 *
 * `as const` rather than `readonly string[]`: z.enum needs the literal union,
 * which turns a mistyped counterparty into a compile error, not a runtime 400.
 */
export const COUNTERPARTIES = [
  'Barclays',
  'HSBC',
  'Goldman Sachs',
  'Morgan Stanley',
  'JP Morgan',
  'UBS',
  'Deutsche Bank',
  'BNP Paribas',
  'Jane Street',
  'Citadel Securities',
] as const

export type Counterparty = (typeof COUNTERPARTIES)[number]
