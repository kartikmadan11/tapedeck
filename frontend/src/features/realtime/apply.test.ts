import type { BlotterState, Position, ServerFrame, Trade } from '@tapedeck/shared'
import { position, trade } from '@tapedeck/shared'
import { describe, expect, it } from 'vitest'
import {
  apply,
  applyPositionsResponse,
  applyTradesResponse,
  emptyBlotter,
  hasGap,
} from './apply.js'

/** Parsed rather than cast, so a fixture that could not come off the wire fails here. */
function aTrade(overrides: Record<string, unknown> = {}): Trade {
  return trade.parse({
    tradeId: 'TRD-100001',
    symbol: 'VOD',
    side: 'BUY',
    quantity: 10_000,
    price: '72.465000',
    trader: 'k.madan',
    book: 'EQ-LDN-1',
    counterparty: 'GSIL',
    tradeTimestamp: '2026-10-02T09:15:00.000Z',
    status: 'ACTIVE',
    version: 1,
    updatedAt: '2026-10-02T09:15:00.000Z',
    ...overrides,
  })
}

function aPosition(overrides: Record<string, unknown> = {}): Position {
  return position.parse({
    symbol: 'VOD',
    netQuantity: 10_000,
    boughtQuantity: 10_000,
    soldQuantity: 0,
    netNotional: '724650.000000',
    tradeCount: 1,
    ...overrides,
  })
}

function stateOf(seq: number, trades: Trade[], positions: Position[] = []): BlotterState {
  return { seq, trades, positions }
}

const ids = (state: BlotterState): string[] => state.trades.map((t) => t.tradeId)

describe('apply: snapshot', () => {
  it('replaces the whole blotter and takes the cursor', () => {
    const frame: ServerFrame = {
      type: 'snapshot',
      seq: 615,
      trades: [aTrade()],
      positions: [aPosition()],
    }

    const next = apply(emptyBlotter, frame)

    expect(next.seq).toBe(615)
    expect(next.trades).toHaveLength(1)
    expect(next.positions).toHaveLength(1)
  })

  it('accepts a cursor of 0 from an empty database', () => {
    const next = apply(emptyBlotter, { type: 'snapshot', seq: 0, trades: [], positions: [] })
    expect(next).toEqual(emptyBlotter)
  })

  it('orders trades newest first regardless of the order received', () => {
    const older = aTrade({ tradeId: 'TRD-100001', tradeTimestamp: '2026-10-02T09:00:00.000Z' })
    const newer = aTrade({ tradeId: 'TRD-100002', tradeTimestamp: '2026-10-02T11:00:00.000Z' })

    const next = apply(emptyBlotter, {
      type: 'snapshot',
      seq: 2,
      trades: [older, newer],
      positions: [],
    })

    expect(ids(next)).toEqual(['TRD-100002', 'TRD-100001'])
  })

  it('breaks a timestamp tie on the trade id, descending', () => {
    const at = '2026-10-02T09:15:00.000Z'
    const next = apply(emptyBlotter, {
      type: 'snapshot',
      seq: 3,
      trades: [
        aTrade({ tradeId: 'TRD-100002', tradeTimestamp: at }),
        aTrade({ tradeId: 'TRD-100010', tradeTimestamp: at }),
        aTrade({ tradeId: 'TRD-100001', tradeTimestamp: at }),
      ],
      positions: [],
    })

    // Lexicographic on a zero-padded id is numeric, which is why the id is padded.
    expect(ids(next)).toEqual(['TRD-100010', 'TRD-100002', 'TRD-100001'])
  })

  it('ignores a snapshot older than the cursor already held', () => {
    const held = stateOf(10, [aTrade({ version: 2 })])

    // A reconnect handshake that lost the race with frames already applied.
    const next = apply(held, { type: 'snapshot', seq: 9, trades: [], positions: [] })

    expect(next).toBe(held)
  })

  it('accepts a snapshot at exactly the cursor held, since it carries the same state', () => {
    const held = stateOf(10, [])
    const next = apply(held, { type: 'snapshot', seq: 10, trades: [aTrade()], positions: [] })

    expect(next.seq).toBe(10)
    expect(ids(next)).toEqual(['TRD-100001'])
  })
})

describe('apply: trade deltas', () => {
  it('inserts a created trade and advances the cursor', () => {
    const next = apply(emptyBlotter, { type: 'trade.created', seq: 1, trade: aTrade() })

    expect(next.seq).toBe(1)
    expect(ids(next)).toEqual(['TRD-100001'])
  })

  it('places a newly created trade at the top when it is the most recent', () => {
    const held = stateOf(1, [aTrade({ tradeTimestamp: '2026-10-02T09:00:00.000Z' })])

    const next = apply(held, {
      type: 'trade.created',
      seq: 2,
      trade: aTrade({ tradeId: 'TRD-100002', tradeTimestamp: '2026-10-02T10:00:00.000Z' }),
    })

    expect(ids(next)).toEqual(['TRD-100002', 'TRD-100001'])
  })

  it('inserts a backdated trade in order rather than appending it', () => {
    const held = stateOf(1, [
      aTrade({ tradeId: 'TRD-100003', tradeTimestamp: '2026-10-02T12:00:00.000Z' }),
      aTrade({ tradeId: 'TRD-100001', tradeTimestamp: '2026-10-02T08:00:00.000Z' }),
    ])

    // Booked now, but with a trade timestamp between the two rows held.
    const next = apply(held, {
      type: 'trade.created',
      seq: 2,
      trade: aTrade({ tradeId: 'TRD-100002', tradeTimestamp: '2026-10-02T10:00:00.000Z' }),
    })

    expect(ids(next)).toEqual(['TRD-100003', 'TRD-100002', 'TRD-100001'])
  })

  it('replaces an amended trade in place, keeping its row position', () => {
    const held = stateOf(2, [
      aTrade({ tradeId: 'TRD-100002', tradeTimestamp: '2026-10-02T12:00:00.000Z' }),
      aTrade({ tradeId: 'TRD-100001' }),
    ])

    const next = apply(held, {
      type: 'trade.amended',
      seq: 3,
      trade: aTrade({ tradeId: 'TRD-100001', quantity: 5_000, price: '71.100000', version: 2 }),
    })

    expect(ids(next)).toEqual(['TRD-100002', 'TRD-100001'])
    expect(next.trades[1]).toMatchObject({ quantity: 5_000, price: '71.100000', version: 2 })
    expect(next.seq).toBe(3)
  })

  it('replaces a cancelled trade in place rather than removing it', () => {
    const held = stateOf(1, [aTrade()])

    const next = apply(held, {
      type: 'trade.cancelled',
      seq: 2,
      trade: aTrade({ status: 'CANCELLED', version: 2 }),
    })

    // The blotter strikes cancelled rows through, so the row has to stay.
    expect(next.trades).toHaveLength(1)
    expect(next.trades[0]).toMatchObject({ status: 'CANCELLED', version: 2 })
  })

  it('ignores a frame at the cursor already held, so a duplicate delivery is a no-op', () => {
    const held = stateOf(5, [aTrade({ version: 2 })])

    const next = apply(held, {
      type: 'trade.amended',
      seq: 5,
      trade: aTrade({ version: 9 }),
    })

    expect(next).toBe(held)
  })

  it('ignores a frame older than the cursor, so a replayed frame cannot revert state', () => {
    const held = stateOf(5, [aTrade({ quantity: 5_000, version: 2 })])

    const next = apply(held, {
      type: 'trade.amended',
      seq: 3,
      trade: aTrade({ quantity: 10_000, version: 1 }),
    })

    expect(next.trades[0]).toMatchObject({ quantity: 5_000, version: 2 })
  })

  it('keeps the later of two frames delivered out of order', () => {
    const chain: ServerFrame[] = [
      { type: 'trade.created', seq: 1, trade: aTrade() },
      { type: 'trade.amended', seq: 3, trade: aTrade({ version: 3, quantity: 1_000 }) },
      { type: 'trade.amended', seq: 2, trade: aTrade({ version: 2, quantity: 5_000 }) },
    ]

    const final = chain.reduce(apply, emptyBlotter)

    expect(final.seq).toBe(3)
    expect(final.trades[0]).toMatchObject({ version: 3, quantity: 1_000 })
  })

  it('walks a create, amend and cancel chain to the final version', () => {
    const chain: ServerFrame[] = [
      { type: 'trade.created', seq: 1, trade: aTrade() },
      { type: 'trade.amended', seq: 2, trade: aTrade({ version: 2, quantity: 5_000 }) },
      { type: 'trade.cancelled', seq: 3, trade: aTrade({ version: 3, status: 'CANCELLED' }) },
    ]

    const final = chain.reduce(apply, emptyBlotter)

    expect(final).toEqual({
      seq: 3,
      trades: [expect.objectContaining({ version: 3, status: 'CANCELLED' })],
      positions: [],
    })
  })
})

describe('apply: positions', () => {
  it('replaces positions and leaves the cursor untouched', () => {
    const held = stateOf(7, [aTrade()], [aPosition()])

    const next = apply(held, {
      type: 'positions',
      positions: [aPosition({ netQuantity: 4_000, tradeCount: 2 })],
    })

    // Advancing seq here would make the client discard trade frames between the
    // cursor and whatever the positions were computed at.
    expect(next.seq).toBe(7)
    expect(next.positions[0]).toMatchObject({ netQuantity: 4_000 })
  })

  it('leaves the trades array identical, not merely equal', () => {
    const held = stateOf(7, [aTrade()], [aPosition()])
    const next = apply(held, { type: 'positions', positions: [] })

    expect(next.trades).toBe(held.trades)
  })

  it('accepts an empty positions frame, which is a blotter with nothing active', () => {
    const held = stateOf(7, [aTrade()], [aPosition()])
    expect(apply(held, { type: 'positions', positions: [] }).positions).toEqual([])
  })
})

describe('apply: purity', () => {
  it('does not mutate the state it is given', () => {
    const trades = [aTrade()]
    const held = Object.freeze(stateOf(1, Object.freeze(trades) as Trade[]))

    apply(held, { type: 'trade.amended', seq: 2, trade: aTrade({ version: 2 }) })

    expect(held.seq).toBe(1)
    expect(held.trades[0]?.version).toBe(1)
  })

  it('does not mutate the array carried by a snapshot frame', () => {
    const incoming = [
      aTrade({ tradeId: 'TRD-100001', tradeTimestamp: '2026-10-02T08:00:00.000Z' }),
      aTrade({ tradeId: 'TRD-100002', tradeTimestamp: '2026-10-02T12:00:00.000Z' }),
    ]

    // Sorting in place would reorder the caller's array, which for a parsed
    // frame is the only copy of the payload.
    apply(emptyBlotter, { type: 'snapshot', seq: 2, trades: incoming, positions: [] })

    expect(incoming.map((t) => t.tradeId)).toEqual(['TRD-100001', 'TRD-100002'])
  })
})

describe('hasGap', () => {
  it('is false for the very next cursor', () => {
    expect(hasGap(stateOf(5, []), { type: 'trade.created', seq: 6, trade: aTrade() })).toBe(false)
  })

  it('is true when a cursor is skipped', () => {
    expect(hasGap(stateOf(5, []), { type: 'trade.created', seq: 8, trade: aTrade() })).toBe(true)
  })

  it('is false before anything has been applied, since there is no cursor to gap from', () => {
    expect(hasGap(emptyBlotter, { type: 'trade.created', seq: 900, trade: aTrade() })).toBe(false)
  })

  it('is false for a duplicate or replayed frame, which is not a gap', () => {
    expect(hasGap(stateOf(5, []), { type: 'trade.amended', seq: 5, trade: aTrade() })).toBe(false)
    expect(hasGap(stateOf(5, []), { type: 'trade.amended', seq: 2, trade: aTrade() })).toBe(false)
  })

  it('is detectable across a digit boundary, which a string cursor would miss', () => {
    // '10' > '9' is false, so a seq arriving as a string would hide this gap.
    expect(hasGap(stateOf(9, []), { type: 'trade.created', seq: 11, trade: aTrade() })).toBe(true)
    expect(hasGap(stateOf(9, []), { type: 'trade.created', seq: 10, trade: aTrade() })).toBe(false)
  })
})

describe('REST writers', () => {
  it('applies a trades response, keeping positions', () => {
    const held = stateOf(3, [], [aPosition()])

    const next = applyTradesResponse(held, { seq: 9, trades: [aTrade()] })

    expect(next.seq).toBe(9)
    expect(ids(next)).toEqual(['TRD-100001'])
    expect(next.positions).toBe(held.positions)
  })

  it('refuses a trades response staler than the cursor held', () => {
    const held = stateOf(9, [aTrade({ version: 2 })])

    // The refetch was issued before the frames that are already applied.
    const next = applyTradesResponse(held, { seq: 4, trades: [aTrade({ version: 1 })] })

    expect(next).toBe(held)
  })

  it('orders a trades response newest first', () => {
    const next = applyTradesResponse(emptyBlotter, {
      seq: 2,
      trades: [
        aTrade({ tradeId: 'TRD-100001', tradeTimestamp: '2026-10-02T08:00:00.000Z' }),
        aTrade({ tradeId: 'TRD-100002', tradeTimestamp: '2026-10-02T12:00:00.000Z' }),
      ],
    })

    expect(ids(next)).toEqual(['TRD-100002', 'TRD-100001'])
  })

  it('applies a positions response without advancing the cursor', () => {
    const held = stateOf(3, [aTrade()])

    const next = applyPositionsResponse(held, { seq: 9, positions: [aPosition()] })

    expect(next.seq).toBe(3)
    expect(next.positions).toHaveLength(1)
  })

  it('refuses a positions response staler than the cursor held', () => {
    const held = stateOf(9, [], [aPosition({ netQuantity: 4_000 })])

    const next = applyPositionsResponse(held, { seq: 4, positions: [aPosition()] })

    expect(next).toBe(held)
  })
})
