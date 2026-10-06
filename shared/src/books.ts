/**
 * In the contract, not the seed's reference data, because three things agree on it:
 * `createTradeInput` validates against it, the booking form is a picklist over it,
 * and the seed and the generated feed book from it. `as const` because z.enum needs
 * the literal union, which turns a mistyped book into a compile error, not a 400.
 */
export const BOOKS = ['EQ-LDN-01', 'EQ-LDN-02', 'EQ-LDN-ARB', 'EQ-NYC-01', 'EQ-PROP-DELTA'] as const

export type Book = (typeof BOOKS)[number]
