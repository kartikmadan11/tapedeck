import type { Position } from '@tapedeck/shared'
import { INSTRUMENTS, toDecimal, toMinorUnits } from '@tapedeck/shared'

/** Indexed once, so a row's mark is a lookup rather than a scan of twelve. */
const REFERENCE = new Map<string, bigint>(
  INSTRUMENTS.map((instrument) => [
    instrument.symbol,
    toMinorUnits(toDecimal(instrument.referencePrice)),
  ]),
)

/**
 * Mark at the instrument's reference price, less what the book paid. The reference
 * is a static level, so this moves when the book moves, not when the market does.
 *
 * Null when the master does not carry the symbol, which the read model allows: a
 * zero there would read as a position that happens to be flat.
 */
export function pnlMinor(position: Position): bigint | null {
  const reference = REFERENCE.get(position.symbol)
  if (reference === undefined) return null

  return BigInt(position.netQuantity) * reference - toMinorUnits(position.netNotional)
}

/** Zero is a position that happens to be flat, so it is not coloured as a gain,
 *  and neither is a symbol with no reference to mark against. */
export function pnlTone(minor: bigint | null): string {
  if (minor === null || minor === 0n) return 'text-tape-muted'

  return minor < 0n ? 'text-tape-sell' : 'text-tape-buy'
}
