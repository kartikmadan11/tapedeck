import { type DecimalString, fromMinorUnits, toDecimal, toMinorUnits } from '@tapedeck/shared'
import type { Rng } from './rng.js'

// What a plausible ticket looks like, shared by the seed and the live simulator.
// Two copies of this would let the historical rows and the incoming ones drift
// apart in price granularity and size, which reads as a bug in the blotter.

/**
 * Walks a reference price by up to 1.5 percent and snaps it to a tick, so the
 * blotter shows a spread rather than identical rows. Scaled integers only.
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
