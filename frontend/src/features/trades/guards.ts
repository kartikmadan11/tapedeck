import type { CreateTradeInput, DecimalString } from '@tapedeck/shared'
import { compareDecimal, formatDecimal, notional, toDecimal } from '@tapedeck/shared'

/** The two checks that hold a booking back for a second press. Both are advisory:
 *  the guarantee against a double-book is the clientTradeId, enforced server-side. */

export const DUPLICATE_WINDOW_MS = 5_000

/** The notional a booking has to be confirmed above. The prefilled ticket is
 *  72,500, so this clears it by 3.4x and one extra zero on the quantity trips it. */
export const NOTIONAL_LIMIT: DecimalString = toDecimal('250000')

/** The economics of a ticket as one comparable string. Nothing identifying is in
 *  it: two tickets with the same signature would book the same trade twice. */
export function signatureOf(values: CreateTradeInput): string {
  return [
    values.symbol,
    values.side,
    values.quantity,
    values.price,
    values.book,
    values.counterparty,
  ].join('|')
}

export interface LastBooking {
  signature: string
  tradeId: string
  at: number
}

/** Why a press is being held. The signature is carried so the form can tell a
 *  confirmation of this ticket from a first press of a different one. */
export interface Guard {
  kind: 'duplicate' | 'size'
  signature: string
  message: string
}

/** Duplicate is tested before size: on a repeat, the repeat is the new
 *  information. `now` is a parameter so the boundary is testable without waiting. */
export function guardFor(
  values: CreateTradeInput,
  last: LastBooking | null,
  now: number = Date.now(),
): Guard | null {
  const signature = signatureOf(values)
  const since = last === null ? Number.POSITIVE_INFINITY : now - last.at

  if (last !== null && last.signature === signature && since < DUPLICATE_WINDOW_MS) {
    return {
      kind: 'duplicate',
      signature,
      message: `Identical to ${last.tradeId}, booked ${(since / 1000).toFixed(1)}s ago`,
    }
  }

  const value = notional(values.quantity, values.price)
  if (compareDecimal(value, NOTIONAL_LIMIT) > 0) {
    return {
      kind: 'size',
      signature,
      message: `${formatDecimal(value)} is over the ${formatDecimal(NOTIONAL_LIMIT, 0)} booking limit`,
    }
  }

  return null
}

export const CONFIRM_LABEL: Record<Guard['kind'], string> = {
  duplicate: 'Confirm duplicate',
  size: 'Confirm size',
}

/** crypto.randomUUID needs a secure context, so it is absent over plain http away
 *  from localhost. getRandomValues has no such restriction, which keeps the
 *  fallback cryptographically random. */
export function newTicketId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // Version 4 in the high nibble of byte 6, variant 1 in the top bits of byte 8,
  // per RFC 4122. Without them the string is random but not a uuid, and the
  // server's schema rejects it.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
