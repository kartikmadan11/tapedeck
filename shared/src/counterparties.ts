/**
 * In the contract, not the seed's reference data, because three things agree on it:
 * `createTradeInput` validates against it, the booking form is a picklist over it,
 * and the generated feed books from it. `as const` rather than `readonly string[]`:
 * z.enum needs the literal union, which makes a mistyped name a compile error.
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
