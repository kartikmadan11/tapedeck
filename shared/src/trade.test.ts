import { describe, expect, it } from 'vitest'
import {
  amendTradeInput,
  type CreateTradeInput,
  cancelTradeInput,
  createTradeInput,
} from './trade.js'

const validCreate: CreateTradeInput = {
  symbol: 'VOD',
  side: 'BUY',
  quantity: 10_000,
  price: '142.750000' as CreateTradeInput['price'],
  trader: 'a.patel',
  book: 'EQ-LDN-01',
  counterparty: 'Barclays',
}

describe('creating a trade', () => {
  it('accepts a well formed booking', () => {
    expect(createTradeInput.parse(validCreate)).toMatchObject({ symbol: 'VOD', quantity: 10_000 })
  })

  it('normalises the ticker to upper case', () => {
    expect(createTradeInput.parse({ ...validCreate, symbol: ' vod.l ' }).symbol).toBe('VOD.L')
  })

  it.each(['tradeId', 'status', 'version', 'updatedAt'])(
    'refuses a server assigned field: %s',
    (field) => {
      const result = createTradeInput.safeParse({ ...validCreate, [field]: 'anything' })
      expect(result.success).toBe(false)
    },
  )

  it.each([
    ['zero quantity', { quantity: 0 }],
    ['negative quantity', { quantity: -5 }],
    ['fractional quantity', { quantity: 1.5 }],
    ['zero price', { price: '0' }],
    ['negative price', { price: '-1.5' }],
    ['float price', { price: 142.75 }],
    ['empty counterparty', { counterparty: '' }],
    ['bad ticker', { symbol: 'VOD LN' }],
  ])('rejects %s', (_label, patch) => {
    expect(createTradeInput.safeParse({ ...validCreate, ...patch }).success).toBe(false)
  })
})

describe('amending a trade', () => {
  const validAmend = {
    quantity: 12_000,
    price: '143.000000',
    counterparty: 'HSBC',
    version: 1,
  }

  it('accepts the three amendable fields plus the concurrency token', () => {
    expect(amendTradeInput.parse(validAmend)).toEqual(validAmend)
  })

  it('requires the version, so a blind overwrite is impossible', () => {
    const { version: _omitted, ...withoutVersion } = validAmend
    expect(amendTradeInput.safeParse(withoutVersion).success).toBe(false)
  })

  // These are economic terms of an executed trade: changing one is a different
  // trade, not an amendment.
  it.each(['symbol', 'side', 'trader', 'book', 'tradeId', 'status', 'tradeTimestamp'])(
    'refuses to amend %s',
    (field) => {
      const result = amendTradeInput.safeParse({ ...validAmend, [field]: 'SOMETHING' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain(field)
      }
    },
  )
})

describe('cancelling a trade', () => {
  it('carries only the concurrency token', () => {
    expect(cancelTradeInput.parse({ version: 3 })).toEqual({ version: 3 })
    expect(cancelTradeInput.safeParse({ version: 3, status: 'CANCELLED' }).success).toBe(false)
  })
})
