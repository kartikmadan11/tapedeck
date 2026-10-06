import type { Position } from '@tapedeck/shared'
import { fromMinorUnits, position as positionSchema, SYMBOLS } from '@tapedeck/shared'
import { describe, expect, it } from 'vitest'
import { pnlMinor } from './pnl.js'

function aPosition(overrides: Record<string, unknown> = {}): Position {
  return positionSchema.parse({
    symbol: 'VOD',
    netQuantity: 10_000,
    boughtQuantity: 10_000,
    soldQuantity: 0,
    netNotional: '684200.000000',
    tradeCount: 1,
    ...overrides,
  })
}

/** Throws rather than coercing, so a missing reference fails as itself instead of
 *  arriving in an assertion as a zero. */
function marked(overrides: Record<string, unknown> = {}): string {
  const position = aPosition(overrides)
  const pnl = pnlMinor(position)
  if (pnl === null) throw new Error(`no reference price for ${position.symbol}`)

  return fromMinorUnits(pnl)
}

describe('position P&L against the reference price', () => {
  it('reads a long bought under the reference as a gain', () => {
    // VOD references 68.42, so 10,000 shares mark at 684,200.
    expect(marked({ netNotional: '600000.000000' })).toBe('84200.000000')
  })

  it('reads a long bought over the reference as a loss', () => {
    expect(marked({ netNotional: '700000.000000' })).toBe('-15800.000000')
  })

  it('reads a short sold over the reference as a gain', () => {
    // Sold 4,000 BARC for 800,000, which marks at 192.35 to 769,400.
    expect(marked({ symbol: 'BARC', netQuantity: -4_000, netNotional: '-800000.000000' })).toBe(
      '30600.000000',
    )
  })

  it('reads a closed round trip as the cash it left behind', () => {
    // Nothing left to mark, so the whole figure is realised.
    expect(marked({ netQuantity: 0, netNotional: '-10000.000000' })).toBe('10000.000000')
  })

  it('subtracts exactly where float subtraction would drift', () => {
    // 684200 - 684199.99 as Number gives 0.010000000009313226.
    expect(marked({ netNotional: '684199.990000' })).toBe('0.010000')
  })

  it('prices every bookable symbol', () => {
    // One share held for nothing marks at the reference itself, so a ticker missing
    // from the table shows up here rather than as a zero on the panel.
    for (const symbol of SYMBOLS) {
      const pnl = pnlMinor(aPosition({ symbol, netQuantity: 1, netNotional: '0.000000' }))

      expect(pnl).toBeGreaterThan(0n)
    }
  })

  it('declines to mark a symbol the instrument master dropped', () => {
    // The read model takes any well-formed ticker, so this row is reachable.
    expect(pnlMinor(aPosition({ symbol: 'VOD.L' }))).toBeNull()
  })
})
