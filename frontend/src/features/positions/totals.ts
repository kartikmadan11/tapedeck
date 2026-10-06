import type { Position } from '@tapedeck/shared'
import { toMinorUnits } from '@tapedeck/shared'

export type BookTotals = {
  /** Every symbol's exposure, unsigned, so a short does not cancel a long. */
  grossMinor: bigint
  netMinor: bigint
  activeTrades: number
}

/**
 * What the panel's rows add up to. Minor units, because twelve floats summed in
 * the browser would stop agreeing with the column they sit under.
 *
 * Over positions, never over the tape: positions are the whole book and the
 * tape is the newest 500, so a count taken from the rows would pin at 500 while
 * the book kept growing.
 */
export function bookTotals(positions: readonly Position[]): BookTotals {
  let grossMinor = 0n
  let netMinor = 0n
  let activeTrades = 0

  for (const position of positions) {
    const minor = toMinorUnits(position.netNotional)
    netMinor += minor
    grossMinor += minor < 0n ? -minor : minor
    activeTrades += position.tradeCount
  }

  return { grossMinor, netMinor, activeTrades }
}
