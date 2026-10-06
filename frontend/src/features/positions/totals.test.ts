import type { Position } from '@tapedeck/shared'
import { fromMinorUnits, position as positionSchema, SYMBOLS } from '@tapedeck/shared'
import { describe, expect, it } from 'vitest'
import { bookTotals } from './totals.js'

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

describe('what the positions panel adds up to', () => {
  it('nets a short against a long and still counts both in the gross', () => {
    const totals = bookTotals([
      aPosition({ netNotional: '500000.000000' }),
      aPosition({ symbol: 'BARC', netQuantity: -4_000, netNotional: '-300000.000000' }),
    ])

    expect(fromMinorUnits(totals.netMinor)).toBe('200000.000000')
    expect(fromMinorUnits(totals.grossMinor)).toBe('800000.000000')
  })

  it('reports a flat book as zero net against a real gross', () => {
    // Why both figures are on the band: long and short the same money is not a
    // book with nothing in it.
    const totals = bookTotals([
      aPosition({ netNotional: '750000.000000' }),
      aPosition({ symbol: 'BARC', netQuantity: -4_000, netNotional: '-750000.000000' }),
    ])

    expect(totals.netMinor).toBe(0n)
    expect(fromMinorUnits(totals.grossMinor)).toBe('1500000.000000')
  })

  it('sums exactly where float addition would drift', () => {
    const totals = bookTotals(
      SYMBOLS.map((symbol) => aPosition({ symbol, netNotional: '0.070000' })),
    )

    // Twelve of these added as Number give 0.8400000000000003.
    expect(fromMinorUnits(totals.grossMinor)).toBe('0.840000')
  })

  it('counts trades rather than symbols', () => {
    const totals = bookTotals([
      aPosition({ tradeCount: 31 }),
      aPosition({ symbol: 'BARC', tradeCount: 342 }),
    ])

    expect(totals.activeTrades).toBe(373)
  })

  it('adds the P&L of the rows it is standing under', () => {
    // VOD references 68.42, so 10,000 marks at 684,200 against the 600,000 paid.
    // BARC references 192.35, so the short marks at -769,400 against -800,000 taken.
    const totals = bookTotals([
      aPosition({ netNotional: '600000.000000' }),
      aPosition({ symbol: 'BARC', netQuantity: -4_000, netNotional: '-800000.000000' }),
    ])

    expect(fromMinorUnits(totals.pnlMinor)).toBe('114800.000000')
  })

  it('leaves an unmarkable row out of the P&L rather than calling it flat', () => {
    const totals = bookTotals([
      aPosition({ netNotional: '600000.000000' }),
      aPosition({ symbol: 'VOD.L', netNotional: '600000.000000' }),
    ])

    // One row of the two carries a reference, so the figure is that row's alone.
    expect(fromMinorUnits(totals.pnlMinor)).toBe('84200.000000')
    expect(fromMinorUnits(totals.grossMinor)).toBe('1200000.000000')
  })

  it('reads an empty book as zero', () => {
    expect(bookTotals([])).toEqual({
      grossMinor: 0n,
      netMinor: 0n,
      pnlMinor: 0n,
      activeTrades: 0,
    })
  })
})
