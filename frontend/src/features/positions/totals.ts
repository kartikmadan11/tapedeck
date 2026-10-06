import type { Position } from '@tapedeck/shared'
import { toMinorUnits } from '@tapedeck/shared'
import { pnlMinor } from './pnl.js'

export type BookTotals = {
  /** Every symbol's exposure, unsigned, so a short does not cancel a long. */
  grossMinor: bigint
  netMinor: bigint
  /** Over the rows that carry a reference price, so it adds up the column shown. */
  pnlMinor: bigint
  activeTrades: number
}

/** Minor units, because floats summed here stop agreeing with the column above them.
 *  Over positions, never the tape: positions are the whole book and the tape is the
 *  newest 500, so a count off the rows would pin at 500 as the book grew. */
export function bookTotals(positions: readonly Position[]): BookTotals {
  let grossMinor = 0n
  let netMinor = 0n
  let pnlTotal = 0n
  let activeTrades = 0

  for (const position of positions) {
    const minor = toMinorUnits(position.netNotional)
    netMinor += minor
    grossMinor += minor < 0n ? -minor : minor
    activeTrades += position.tradeCount

    const pnl = pnlMinor(position)
    if (pnl !== null) pnlTotal += pnl
  }

  return { grossMinor, netMinor, pnlMinor: pnlTotal, activeTrades }
}
