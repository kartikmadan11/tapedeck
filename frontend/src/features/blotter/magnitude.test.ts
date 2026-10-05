import { describe, expect, it } from 'vitest'
import { barScale, barWidth } from './magnitude.js'

describe('barScale', () => {
  it('has nothing to scale against when there is nothing on the tape', () => {
    expect(barScale(0n)).toBe(0n)
  })

  it('leaves an exact 1, 2 or 5 where it is', () => {
    // The point of this case: the largest trade on the tape draws a bar that
    // reaches the end of the cell, rather than one that stops just short of it
    // because the scale was rounded past it.
    expect(barScale(1_000_000n)).toBe(1_000_000n)
    expect(barScale(2_000_000n)).toBe(2_000_000n)
    expect(barScale(5_000_000n)).toBe(5_000_000n)
  })

  it('raises anything else to the next 1, 2 or 5', () => {
    const steps: [bigint, bigint][] = [
      [1n, 1n],
      [3n, 5n],
      [6n, 10n],
      [1_500_000n, 2_000_000n],
      [4_000_000n, 5_000_000n],
      // 724,650.00 of notional, which is what a 10,000 lot of a 72-pound stock
      // comes to, scales against a round million.
      [724_650_000_000n, 1_000_000_000_000n],
    ]

    for (const [max, scale] of steps) {
      expect(barScale(max)).toBe(scale)
    }
  })
})

describe('barWidth', () => {
  it('is a proportion of the scale', () => {
    expect(barWidth(10n, 10n)).toBe(100)
    expect(barWidth(5n, 10n)).toBe(50)
    expect(barWidth(0n, 10n)).toBe(0)
  })

  it('truncates rather than carrying a fraction of a pixel', () => {
    expect(barWidth(1n, 3n)).toBe(33)
  })

  it('draws nothing when there is no scale', () => {
    // Division by zero in bigint throws rather than giving Infinity, so this is
    // a guard and not a tidiness.
    expect(barWidth(5n, 0n)).toBe(0)
  })
})
