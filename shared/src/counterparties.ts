/**
 * The counterparties a trade may be booked against.
 *
 * Part of the contract rather than of the seed's reference data, because three
 * things have to agree on it: `createTradeInput` validates against it, the
 * booking form is a picklist over it, and the generated feed books from it. A
 * second copy anywhere would be a list that drifts out of the one that rejects.
 *
 * It stands in for a counterparty master, which in a real build is a
 * reference-data service rather than a constant, and which keys each entity by
 * LEI with the display name as an attribute. Display names are used here because
 * they read as a blotter should; the shape of the lookup is the part worth
 * modelling at this size.
 *
 * `as const` rather than `readonly string[]`: z.enum needs the literal union, and
 * that union is what turns a mistyped counterparty in a caller into a compile
 * error rather than a runtime 400.
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
