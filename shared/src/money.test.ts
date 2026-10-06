import { describe, expect, it } from 'vitest'
import type { PricedLeg } from './money.js'
import {
  compareDecimal,
  decimalString,
  formatDecimal,
  fromMinorUnits,
  netNotional,
  netQuantity,
  notional,
  priceString,
  toDecimal,
  toMinorUnits,
  vwap,
} from './money.js'

function leg(side: 'BUY' | 'SELL', quantity: number, price: string): PricedLeg {
  return { side, quantity, price: toDecimal(price) }
}

describe('decimal validation', () => {
  it.each(['0', '1', '1.5', '0.000001', '142.75', '999999999999.999999', '-12.5'])(
    'accepts %s',
    (value) => {
      expect(decimalString.parse(value)).toBe(value)
    },
  )

  it.each([
    ['1.2345678', 'more than six decimal places'],
    ['.5', 'no leading digit'],
    ['01.5', 'redundant leading zero'],
    ['1e5', 'exponent notation'],
    ['1,000', 'thousands separator'],
    ['1.', 'trailing separator'],
    ['', 'empty'],
    ['abc', 'not a number'],
    ['1000000000000', 'thirteen integer digits'],
  ])('rejects %s (%s)', (value) => {
    expect(decimalString.safeParse(value).success).toBe(false)
  })

  it('rejects a zero or negative price, which is not tradeable', () => {
    expect(priceString.safeParse('0').success).toBe(false)
    expect(priceString.safeParse('0.000000').success).toBe(false)
    expect(priceString.safeParse('-1.5').success).toBe(false)
    expect(priceString.safeParse('0.000001').success).toBe(true)
  })
})

describe('scaling to minor units', () => {
  it.each([
    ['1', 1_000_000n],
    ['1.5', 1_500_000n],
    ['0.000001', 1n],
    ['142.75', 142_750_000n],
    ['-12.5', -12_500_000n],
    ['0', 0n],
  ])('%s scales to %s', (value, expected) => {
    expect(toMinorUnits(toDecimal(value))).toBe(expected)
  })

  it.each([
    ['1', '1.000000'],
    ['1.5', '1.500000'],
    ['0.000001', '0.000001'],
    ['142.75', '142.750000'],
    ['-12.5', '-12.500000'],
    // Eighteen significant digits. A double holds about sixteen, so routing
    // this through a float at any point corrupts it.
    ['999999999999.999999', '999999999999.999999'],
  ])('round trips %s to the canonical scale', (value, expected) => {
    expect(fromMinorUnits(toMinorUnits(toDecimal(value)))).toBe(expected)
  })

  it('survives a value that a double cannot represent', () => {
    const exact = '999999999999.999999'
    // Eighteen significant digits against a double's sixteen.
    expect(Number(exact).toFixed(6)).not.toBe(exact)
    expect(fromMinorUnits(toMinorUnits(toDecimal(exact)))).toBe(exact)
  })

  it('renders at a fixed scale so values match what Postgres returns', () => {
    expect(fromMinorUnits(1_500_000n)).toBe('1.500000')
    expect(fromMinorUnits(1n)).toBe('0.000001')
    expect(fromMinorUnits(0n)).toBe('0.000000')
    expect(fromMinorUnits(-12_500_000n)).toBe('-12.500000')
  })
})

describe('notional is exact where float arithmetic is not', () => {
  it('computes 3 x 0.1 as exactly 0.3', () => {
    // The float answer is 0.30000000000000004.
    expect(0.1 * 3).not.toBe(0.3)
    expect(notional(3, toDecimal('0.1'))).toBe('0.300000')
  })

  it('computes 100 x 1.005 as exactly 100.5', () => {
    // The float answer is 100.49999999999999, which rounds down to 100.49.
    expect(1.005 * 100).not.toBe(100.5)
    expect(notional(100, toDecimal('1.005'))).toBe('100.500000')
  })

  it('stays exact at institutional size', () => {
    expect(notional(5_000_000, toDecimal('137.425'))).toBe('687125000.000000')
  })

  it('is exact for a price with full precision', () => {
    expect(notional(1_000_000, toDecimal('0.000001'))).toBe('1.000000')
  })
})

describe('aggregating a group of trades', () => {
  it('nets quantity by side', () => {
    expect(netQuantity([leg('BUY', 10_000, '72.465'), leg('SELL', 4_000, '73.1')])).toBe(6_000)
    expect(netQuantity([])).toBe(0)
  })

  it('nets exposure signed, and stays exact at institutional size', () => {
    expect(netNotional([leg('BUY', 5_000_000, '137.425'), leg('SELL', 2_000_000, '137.425')])).toBe(
      '412275000.000000',
    )
  })

  it('reports a net short as negative, matching the positions panel', () => {
    expect(netNotional([leg('BUY', 1_000, '10'), leg('SELL', 3_000, '10')])).toBe('-20000.000000')
  })

  it('computes a VWAP the float path gets wrong', () => {
    // The float answer is 0.15000000000000002.
    expect((3 * 0.1 + 3 * 0.2) / 6).not.toBe(0.15)
    expect(vwap([leg('BUY', 3, '0.1'), leg('BUY', 3, '0.2')])).toBe('0.150000')
  })

  it('still reports an average price for a book that is flat', () => {
    const flat = [leg('BUY', 1_000, '10'), leg('SELL', 1_000, '20')]

    // Netting the weights would make the denominator zero.
    expect(netQuantity(flat)).toBe(0)
    expect(vwap(flat)).toBe('15.000000')
  })

  it('lands between the prices that were dealt', () => {
    const average = vwap([leg('BUY', 10_000, '72.465'), leg('SELL', 5_000, '73.1')])
    if (average === null) {
      throw new Error('expected an average price')
    }

    expect(average).toBe('72.676667')
    expect(compareDecimal(average, toDecimal('72.465'))).toBeGreaterThan(0)
    expect(compareDecimal(average, toDecimal('73.1'))).toBeLessThan(0)
  })

  // Typed rather than inline, because it.each over heterogeneous tuples widens
  // every parameter to the union of the column types.
  const rounding: [string, PricedLeg[], string][] = [
    // Exactly half a minor unit, which truncation would round down to 0.000001.
    ['half rounds up', [leg('BUY', 1, '0.000001'), leg('BUY', 1, '0.000002')], '0.000002'],
    ['below half rounds down', [leg('BUY', 1, '0.000002'), leg('BUY', 2, '0.000001')], '0.000001'],
    ['above half rounds up', [leg('BUY', 1, '0.000003'), leg('BUY', 2, '0.000001')], '0.000002'],
  ]

  it.each(rounding)('rounds the last place half up: %s', (_label, legs, expected) => {
    expect(vwap(legs)).toBe(expected)
  })

  it('has no average price to report for an empty group', () => {
    // null and not '0.000000', so the cell can render a dash.
    expect(vwap([])).toBeNull()
  })
})

describe('comparison', () => {
  it('orders by value, not lexicographically', () => {
    // The trap: as plain strings, '10.000000' sorts before '9.000000'.
    expect('10.000000' < '9.000000').toBe(true)
    expect(compareDecimal(toDecimal('10'), toDecimal('9'))).toBeGreaterThan(0)
  })

  it('treats differently written equal values as equal', () => {
    expect(compareDecimal(toDecimal('1.5'), toDecimal('1.500000'))).toBe(0)
  })

  it('sorts a column correctly', () => {
    const prices = ['9.5', '10.25', '100', '1.05', '9.05'].map(toDecimal)
    expect([...prices].sort(compareDecimal)).toEqual(['1.05', '9.05', '9.5', '10.25', '100'])
  })
})

describe('display formatting', () => {
  it('formats for humans without feeding the result back into arithmetic', () => {
    expect(formatDecimal(toDecimal('1234.5'))).toBe('1,234.50')
    expect(formatDecimal(toDecimal('0.125'), 3)).toBe('0.125')
  })
})
