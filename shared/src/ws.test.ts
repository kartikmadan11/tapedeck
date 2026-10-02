import { describe, expect, it } from 'vitest'
import { toDecimal } from './money.js'
import type { Position, Trade } from './trade.js'
import { frameSequence, type SequencedFrame, type ServerFrame, serverFrame } from './ws.js'

const aTrade: Trade = {
  tradeId: 'TRD-100001',
  symbol: 'VOD',
  side: 'BUY',
  quantity: 10_000,
  price: toDecimal('142.750000'),
  trader: 'a.patel',
  book: 'EQ-LDN-01',
  counterparty: 'Barclays',
  tradeTimestamp: '2026-10-02T09:15:00.000Z',
  status: 'ACTIVE',
  version: 1,
  updatedAt: '2026-10-02T09:15:00.000Z',
}

const aPosition: Position = {
  symbol: 'VOD',
  netQuantity: 10_000,
  boughtQuantity: 10_000,
  soldQuantity: 0,
  netNotional: toDecimal('1427500.000000'),
  tradeCount: 1,
}

describe('frame parsing', () => {
  it.each<ServerFrame>([
    { type: 'snapshot', seq: 42, trades: [aTrade], positions: [aPosition] },
    { type: 'trade.created', seq: 43, trade: aTrade },
    { type: 'trade.amended', seq: 44, trade: { ...aTrade, version: 2 } },
    { type: 'trade.cancelled', seq: 45, trade: { ...aTrade, status: 'CANCELLED', version: 3 } },
    { type: 'positions', positions: [aPosition] },
  ])('round trips a $type frame through JSON', (frame) => {
    expect(serverFrame.parse(JSON.parse(JSON.stringify(frame)))).toEqual(frame)
  })

  it('allows a snapshot cursor of 0 for an empty database', () => {
    const empty = { type: 'snapshot', seq: 0, trades: [], positions: [] }
    expect(serverFrame.safeParse(empty).success).toBe(true)
  })

  it('refuses a delta at sequence 0, because events are numbered from 1', () => {
    expect(serverFrame.safeParse({ type: 'trade.created', seq: 0, trade: aTrade }).success).toBe(
      false,
    )
  })

  it('rejects an unknown frame type rather than ignoring it', () => {
    expect(serverFrame.safeParse({ type: 'trade.exploded', seq: 1 }).success).toBe(false)
  })
})

describe('the cursor contract', () => {
  it('reports the cursor for every ordered frame', () => {
    expect(frameSequence({ type: 'snapshot', seq: 42, trades: [], positions: [] })).toBe(42)
    expect(frameSequence({ type: 'trade.created', seq: 43, trade: aTrade })).toBe(43)
    expect(frameSequence({ type: 'trade.amended', seq: 44, trade: aTrade })).toBe(44)
    expect(frameSequence({ type: 'trade.cancelled', seq: 45, trade: aTrade })).toBe(45)
  })

  // Derived state carries no ordering, so one mutation never emits two frames
  // with the same seq.
  it('reports no cursor for a positions frame', () => {
    expect(frameSequence({ type: 'positions', positions: [aPosition] })).toBeNull()
  })

  it('does not carry a sequence number on the wire for positions', () => {
    const parsed = serverFrame.parse({
      type: 'positions',
      positions: [aPosition],
      seq: 99,
    })
    expect(parsed).not.toHaveProperty('seq')
  })

  it('narrows the sequenced frames to exactly the four ordered kinds', () => {
    const kinds: SequencedFrame['type'][] = [
      'snapshot',
      'trade.created',
      'trade.amended',
      'trade.cancelled',
    ]
    expect(kinds).toHaveLength(4)

    // @ts-expect-error a positions frame is not a SequencedFrame, so cursor
    // advancing code cannot reach it
    const invalid: SequencedFrame = { type: 'positions', positions: [] }
    expect(invalid).toBeDefined()
  })

  it('replays only the deltas a client has not seen', () => {
    const snapshotSeq = 43
    const buffered: ServerFrame[] = [
      { type: 'trade.created', seq: 42, trade: aTrade },
      { type: 'trade.amended', seq: 43, trade: aTrade },
      { type: 'trade.cancelled', seq: 44, trade: aTrade },
      { type: 'positions', positions: [aPosition] },
    ]

    const replayed = buffered.filter((frame) => {
      const seq = frameSequence(frame)
      return seq !== null && seq > snapshotSeq
    })

    expect(replayed).toEqual([{ type: 'trade.cancelled', seq: 44, trade: aTrade }])
  })
})
