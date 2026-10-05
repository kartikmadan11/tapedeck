import type { CreateTradeInput, DecimalString } from '@tapedeck/shared'
import { compareDecimal, formatDecimal, notional, toDecimal } from '@tapedeck/shared'

/**
 * The two checks that hold a booking back for a second press, kept out of the
 * form so the policy can be tested without rendering anything.
 *
 * Both are advisory, and deliberately so. They sit in the browser, which means
 * they catch the mistake they are aimed at and stop nothing determined; the
 * guarantee that a retry cannot double-book is the clientTradeId, which the
 * server enforces. A real desk reads these limits from a limits service, per
 * book and per trader, and checks them server-side as well. Stated in the README.
 */

/**
 * How long an identical ticket counts as a probable repeat.
 *
 * Long enough to cover a double-click and a moment's doubt, short enough that
 * working an order in clips is not interrupted: that is a sequence of deliberate
 * presses seconds apart, and a trader should not have to confirm each one.
 */
export const DUPLICATE_WINDOW_MS = 5_000

/**
 * The notional a booking has to be confirmed above.
 *
 * 250,000 rather than a round million, because the mistake being caught is an
 * extra digit and the number has to sit between the ticket and the typo. The
 * prefilled ticket is 72,500, so this clears it by 3.4x and a single extra zero
 * on the quantity trips it.
 */
export const NOTIONAL_LIMIT: DecimalString = toDecimal('250000')

/**
 * The economics of a ticket as one comparable string. Nothing identifying is in
 * it, which is the point: two tickets with the same signature would book the
 * same trade twice.
 */
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

/** The last booking this form made, as the duplicate check needs to see it. */
export interface LastBooking {
  signature: string
  tradeId: string
  at: number
}

/**
 * Why a press is being held. The signature is carried so the form can tell a
 * confirmation of this ticket from a first press of a different one.
 */
export interface Guard {
  kind: 'duplicate' | 'size'
  signature: string
  message: string
}

/**
 * The one guard a ticket has to clear, or null.
 *
 * Duplicate is tested before size. An oversized ticket was already confirmed for
 * its size when it was first booked, so on a repeat the repeat is the new
 * information and saying "above the limit" a second time would answer a question
 * nobody asked.
 *
 * `now` is a parameter so the window has a testable boundary rather than one
 * that can only be reached by waiting.
 */
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

/** What the held button says, by what is holding it. */
export const CONFIRM_LABEL: Record<Guard['kind'], string> = {
  duplicate: 'Confirm duplicate',
  size: 'Confirm size',
}

/**
 * A v4 uuid for one ticket.
 *
 * crypto.randomUUID is restricted to secure contexts, so it is absent when the
 * app is reached over plain http at anything but localhost, which is exactly how
 * a reviewer opening it on a LAN address would see it. getRandomValues carries no
 * such restriction, so the fallback is still cryptographically random rather than
 * dropping to Math.random.
 */
export function newTicketId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // Version 4 in the high nibble of byte 6, variant 1 in the top bits of byte 8,
  // per RFC 4122. Without these the string is random but not a valid uuid, and
  // the server's schema would reject it.
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
