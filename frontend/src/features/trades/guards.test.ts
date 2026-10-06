import type { CreateTradeInput } from '@tapedeck/shared'
import { describe, expect, it } from 'vitest'
import type { LastBooking } from './guards.js'
import {
  DUPLICATE_WINDOW_MS,
  guardFor,
  NOTIONAL_LIMIT,
  newTicketId,
  signatureOf,
} from './guards.js'

/** 1,000 at 72.50 is 72,500, under the limit, so nothing fires by default and each
 *  test turns on the one thing it is about. */
const TICKET: CreateTradeInput = {
  symbol: 'VOD',
  side: 'BUY',
  quantity: 1_000,
  price: '72.500000' as CreateTradeInput['price'],
  trader: 'k.madan',
  book: 'EQ-LDN-01',
  counterparty: 'HSBC',
}

const NOW = 1_800_000_000_000

function booked(overrides: Partial<LastBooking> = {}): LastBooking {
  return { signature: signatureOf(TICKET), tradeId: 'TRD-100001', at: NOW, ...overrides }
}

describe('the ticket signature', () => {
  it.each(['symbol', 'side', 'quantity', 'price', 'book', 'counterparty'] as const)(
    'changes when %s changes',
    (field) => {
      const changed = { ...TICKET, [field]: field === 'quantity' ? 2_000 : 'OTHER' }
      expect(signatureOf(changed as CreateTradeInput)).not.toBe(signatureOf(TICKET))
    },
  )

  // Including it would let one window's booking silence another's warning.
  it('ignores the trader', () => {
    expect(signatureOf({ ...TICKET, trader: 'j.okonkwo' })).toBe(signatureOf(TICKET))
  })
})

describe('the duplicate guard', () => {
  it('passes a first booking', () => {
    expect(guardFor(TICKET, null, NOW)).toBeNull()
  })

  it('holds an identical ticket inside the window and names the trade it repeats', () => {
    const guard = guardFor(TICKET, booked(), NOW + 1_400)
    expect(guard?.kind).toBe('duplicate')
    expect(guard?.message).toBe('Identical to TRD-100001, booked 1.4s ago')
  })

  // Both directions: an off-by-one either nags a trader working an order in clips
  // or lets a double-click through.
  it('holds at the last millisecond inside the window', () => {
    expect(guardFor(TICKET, booked(), NOW + DUPLICATE_WINDOW_MS - 1)?.kind).toBe('duplicate')
  })

  it('passes once the window has elapsed', () => {
    expect(guardFor(TICKET, booked(), NOW + DUPLICATE_WINDOW_MS)).toBeNull()
  })

  // A different clip is not a duplicate, however fast it follows.
  it('passes a different ticket inside the window', () => {
    expect(guardFor({ ...TICKET, quantity: 2_000 }, booked(), NOW + 10)).toBeNull()
  })
})

describe('the size guard', () => {
  /** One extra zero on the default ticket's quantity: 725,000 against 72,500. */
  const FAT_FINGERED: CreateTradeInput = { ...TICKET, quantity: 10_000 }

  it('catches an extra digit on the quantity', () => {
    const guard = guardFor(FAT_FINGERED, null, NOW)
    expect(guard?.kind).toBe('size')
    expect(guard?.message).toBe('725,000.00 is over the 250,000 booking limit')
  })

  it('passes the prefilled ticket, which is what keeps the guard meaningful', () => {
    expect(guardFor(TICKET, null, NOW)).toBeNull()
  })

  /** The boundary is one minor unit wide, since the comparison runs in minor units
   *  rather than on the strings. Strictly over, so exactly on the limit books. */
  it.each([
    ['exactly on the limit', '250000.000000', null],
    ['one minor unit over', '250000.000001', 'size'],
  ])('%s', (_label, price, expected) => {
    const guard = guardFor(
      { ...TICKET, quantity: 1, price: price as CreateTradeInput['price'] },
      null,
      NOW,
    )
    expect(guard?.kind ?? null).toBe(expected)
  })

  it('states the limit it is comparing against', () => {
    expect(NOTIONAL_LIMIT).toBe('250000')
  })
})

describe('precedence', () => {
  // The size was already confirmed on the first booking, so the repeat is the
  // new information.
  it('reports the duplicate rather than the size when a ticket is both', () => {
    const big = { ...TICKET, quantity: 10_000 }
    const guard = guardFor(big, booked({ signature: signatureOf(big) }), NOW + 100)
    expect(guard?.kind).toBe('duplicate')
  })
})

describe('the ticket id', () => {
  it('is a v4 uuid, which is what the server accepts', () => {
    expect(newTicketId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, newTicketId))
    expect(ids.size).toBe(500)
  })
})
