import { z } from 'zod'

// Money is an exact base-10 string end to end, matching numeric(18, 6) in
// Postgres. Arithmetic goes through toMinorUnits (bigint); Number() is for
// display only.
export const DECIMAL_SCALE = 6

/** Up to 12 integer digits and 6 fractional digits, matching `numeric(18, 6)`. */
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/

export const decimalString = z
  .string()
  .regex(DECIMAL_PATTERN, {
    error: 'expected a decimal string with up to 12 integer digits and 6 decimal places',
  })
  .brand<'DecimalString'>()

/** Branded, so an unvalidated string cannot reach a price field. */
export type DecimalString = z.infer<typeof decimalString>

/** Zero and negative prices are not tradeable. */
export const priceString = decimalString.refine((value) => toMinorUnits(value) > 0n, {
  error: 'price must be greater than zero',
})

/** For boundaries not already covered by a zod schema: seed data, tests. */
export function toDecimal(value: string): DecimalString {
  return decimalString.parse(value)
}

/** `'1.5'` at scale 6 becomes `1500000n`. */
export function toMinorUnits(value: DecimalString): bigint {
  const negative = value.startsWith('-')
  const magnitude = negative ? value.slice(1) : value
  const separator = magnitude.indexOf('.')
  const whole = separator === -1 ? magnitude : magnitude.slice(0, separator)
  const fraction = separator === -1 ? '' : magnitude.slice(separator + 1)
  const scaled = BigInt(whole + fraction.padEnd(DECIMAL_SCALE, '0'))
  return negative ? -scaled : scaled
}

/** Renders at the canonical scale, so results match what Postgres returns. */
export function fromMinorUnits(units: bigint): DecimalString {
  const negative = units < 0n
  const digits = (negative ? -units : units).toString().padStart(DECIMAL_SCALE + 1, '0')
  const boundary = digits.length - DECIMAL_SCALE
  const whole = digits.slice(0, boundary)
  const fraction = digits.slice(boundary)
  return `${negative ? '-' : ''}${whole}.${fraction}` as DecimalString
}

/** Exact `quantity * price`. */
export function notional(quantity: number, price: DecimalString): DecimalString {
  return fromMinorUnits(BigInt(quantity) * toMinorUnits(price))
}

/**
 * Orders by value. Required because the default string comparator puts
 * '10.000000' before '9.000000'.
 */
export function compareDecimal(a: DecimalString, b: DecimalString): number {
  const left = toMinorUnits(a)
  const right = toMinorUnits(b)
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/** Display only. The one sanctioned crossing into float. */
export function formatDecimal(value: DecimalString, fractionDigits = 2): string {
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(value))
}
