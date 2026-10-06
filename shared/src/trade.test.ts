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
    // The whole point of the picklist: a near miss for a real name is still a
    // different counterparty, and length validation cannot tell them apart.
    ['a counterparty off the list', { counterparty: 'UBSf' }],
    ['empty book', { book: '' }],
    // The near miss that was live: the form prefilled this against EQ-LDN-01.
    ['a book off the list', { book: 'EQ-LDN-1' }],
    ['bad ticker', { symbol: 'VOD LN' }],
  ])('rejects %s', (_label, patch) => {
    expect(createTradeInput.safeParse({ ...validCreate, ...patch }).success).toBe(false)
  })

  describe('the idempotency key', () => {
    const KEY = '3f2a8c1e-5b47-4d9a-8e21-0c6f4b7d9a35'

    it('accepts a uuid', () => {
      expect(createTradeInput.parse({ ...validCreate, clientTradeId: KEY }).clientTradeId).toBe(KEY)
    })

    // Optional on purpose: the seed and the simulator book without one, and a
    // client that sends none still books, it just forfeits the guarantee.
    it('is optional', () => {
      expect(createTradeInput.parse(validCreate).clientTradeId).toBeUndefined()
    })

    // A bound on the key as well as a format. Without it the column is an
    // arbitrary string a caller chooses, so one client could collide with
    // another's booking by sending 'ticket-1'.
    it.each(['', 'ticket-1', KEY.slice(0, -1), `${KEY} `])('rejects %o', (value) => {
      expect(createTradeInput.safeParse({ ...validCreate, clientTradeId: value }).success).toBe(
        false,
      )
    })
  })
})

describe('amending a trade', () => {
  const validAmend = {
    quantity: 12_000,
    price: '143.000000',
    version: 1,
  }

  it('accepts the two amendable fields plus the concurrency token', () => {
    expect(amendTradeInput.parse(validAmend)).toEqual(validAmend)
  })

  it('requires the version, so a blind overwrite is impossible', () => {
    const { version: _omitted, ...withoutVersion } = validAmend
    expect(amendTradeInput.safeParse(withoutVersion).success).toBe(false)
  })

  // These are economic terms of an executed trade: changing one is a different
  // trade, not an amendment.
  //
  // counterparty is in the list for a related but separate reason, argued in the
  // README: a mis-booking is cancelled and rebooked, and moving the exposure for
  // real is a novation the incoming party has to agree to.
  it.each([
    'symbol',
    'side',
    'trader',
    'book',
    'counterparty',
    'tradeId',
    'status',
    'tradeTimestamp',
  ])('refuses to amend %s', (field) => {
    const result = amendTradeInput.safeParse({ ...validAmend, [field]: 'SOMETHING' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain(field)
    }
  })
})

describe('cancelling a trade', () => {
  it('carries only the concurrency token', () => {
    expect(cancelTradeInput.parse({ version: 3 })).toEqual({ version: 3 })
    expect(cancelTradeInput.safeParse({ version: 3, status: 'CANCELLED' }).success).toBe(false)
  })
})
