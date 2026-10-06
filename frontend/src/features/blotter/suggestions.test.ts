import type { Trade } from '@tapedeck/shared'
import { trade as tradeSchema } from '@tapedeck/shared'
import { describe, expect, it } from 'vitest'
import { suggestionsOf } from './suggestions.js'

function aTrade(overrides: Record<string, unknown> = {}): Trade {
  return tradeSchema.parse({
    tradeId: 'TRD-100001',
    symbol: 'VOD',
    side: 'BUY',
    quantity: 5_000,
    price: '144.930000',
    trader: 'k.madan',
    book: 'EQ-LDN-01',
    counterparty: 'Barclays',
    status: 'ACTIVE',
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

    // Unlike an aggregate, which nets the cancelled leaf out. A filter is about
    // which rows are on screen, and a cancelled row is one of them.
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
