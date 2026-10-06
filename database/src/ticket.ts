import { type DecimalString, fromMinorUnits, toDecimal, toMinorUnits } from '@tapedeck/shared'
import type { Rng } from './rng.js'

// What a plausible ticket looks like, shared by the seed and the live simulator,
// so historical and incoming rows cannot drift apart in granularity or size.

/**
 * Walks a reference price by up to 1.5 percent and snaps it to a tick. Scaled
 * integers only.
 *
 * Takes any decimal string, not only an instrument's reference, so an amendment
 * can drift from the trade's own current price.
 */
export function walkPrice(reference: string, rng: Rng): DecimalString {
  const base = toMinorUnits(toDecimal(reference))
  const driftBps = BigInt(rng.int(-150, 150))
  const drifted = base + (base * driftBps) / 10_000n
  // 1/100 of the quoted unit: plausible tick granularity.
  const tick = 10_000n
  const snapped = (drifted / tick) * tick
  return fromMinorUnits(snapped > 0n ? snapped : tick)
}

/** A multiple of the instrument's lot size. */
export function ticketSize(lotSize: number, rng: Rng): number {
  const lots = rng.int(1, 8)
  return lotSize * lots
}

/**
 * How much of a ticket one execution fills, in whole lots, since that is how
 * fills arrive. Stops short of the ticket where there are lots to stop short at,
 * so the caller gets a partial fill; a one-lot ticket fills in a single go.
 */
export function partialFill(quantity: number, lotSize: number, rng: Rng): number {
  const lots = Math.floor(quantity / lotSize)
  return lots > 1 ? lotSize * rng.int(1, lots - 1) : quantity
}
