import type { Trade } from '@tapedeck/shared'
import { trade as tradeSchema } from '@tapedeck/shared'
import { describe, expect, it } from 'vitest'
import { filterChoices, suggestionsOf } from './suggestions.js'

function aTrade(overrides: Record<string, unknown> = {}): Trade {
  return tradeSchema.parse({
    tradeId: 'TRD-100001',
    symbol: 'VOD',
    side: 'BUY',
    quantity: 5_000,
    filledQuantity: 0,
    price: '144.930000',
    trader: 'k.madan',
    book: 'EQ-LDN-01',
    counterparty: 'Barclays',
    status: 'NEW',
    version: 1,
    tradeTimestamp: '2026-10-02T09:12:00.000Z',
    createdAt: '2026-10-02T09:12:00.000Z',
    updatedAt: '2026-10-02T09:12:00.000Z',
    ...overrides,
  })
}

describe('suggestionsOf', () => {
  it('offers each value once, in an order a list can be read down', () => {
    const lists = suggestionsOf([
      aTrade({ symbol: 'VOD' }),
      aTrade({ tradeId: 'TRD-100002', symbol: 'BARC' }),
      aTrade({ tradeId: 'TRD-100003', symbol: 'VOD' }),
    ])

    expect(lists.symbol).toEqual(['BARC', 'VOD'])
    expect(lists.trader).toEqual(['k.madan'])
  })

  it('offers the values on a cancelled row, since a filter still matches it', () => {
    const lists = suggestionsOf([
      aTrade(),
      aTrade({ tradeId: 'TRD-100002', book: 'EQ-LDN-ARB', status: 'CANCELLED' }),
    ])

    // Unlike an aggregate, which nets cancelled legs out: a cancelled row is on screen.
    expect(lists.book).toEqual(['EQ-LDN-01', 'EQ-LDN-ARB'])
  })

  it('offers nothing off an empty tape rather than a stale list', () => {
    expect(suggestionsOf([])).toEqual({
      symbol: [],
      trader: [],
      book: [],
      counterparty: [],
    })
  })
})

describe('filterChoices', () => {
  it('puts no filter first, then each value under its own name', () => {
    expect(filterChoices(['BARC', 'VOD'], '', 'All symbols')).toEqual([
      { value: '', label: 'All symbols' },
      { value: 'BARC', label: 'BARC' },
      { value: 'VOD', label: 'VOD' },
    ])
  })

  it('keeps the value in force when the tape does not hold it, in order', () => {
    const values = filterChoices(['BARC', 'VOD'], 'HSBA', 'All symbols').map((each) => each.value)

    expect(values).toEqual(['', 'BARC', 'HSBA', 'VOD'])
  })

  it('lists a value the tape holds once, not twice', () => {
    expect(filterChoices(['BARC', 'VOD'], 'VOD', 'All symbols')).toHaveLength(3)
  })
})
