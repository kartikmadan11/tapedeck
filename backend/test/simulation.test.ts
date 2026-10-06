import { Rng } from '@tapedeck/database'
import {
  type AmendTradeInput,
  type CancelTradeInput,
  type CreateTradeInput,
  createTradeInput,
  type ServerFrame,
  type Trade,
  versionConflict,
} from '@tapedeck/shared'
import type { FastifyBaseLogger } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { createBus } from '../src/bus.js'
import { nextAction } from '../src/simulation/nextAction.js'
import { createSimulator, SIMULATOR_ACTOR } from '../src/simulation/simulator.js'

/** No database and no app: the generator is pure and the writes are callbacks. */

function aTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    tradeId: 'TRD-100001',
    symbol: 'VOD',
    side: 'BUY',
    quantity: 10_000,
    price: '72.465000' as Trade['price'],
    trader: 'k.madan',
    book: 'EQ-LDN-01',
    counterparty: 'HSBC',
    tradeTimestamp: '2026-10-03T09:15:00.000Z',
    status: 'ACTIVE',
    version: 1,
    updatedAt: '2026-10-03T09:15:00.000Z',
    ...overrides,
  }
}

/** Silent, so a deliberately failing tick does not print during the run. */
function fakeLog(): FastifyBaseLogger {
  const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return log as unknown as FastifyBaseLogger
}

type Writes = {
  create: ReturnType<typeof vi.fn>
  amend: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function buildSimulator(
  active: Trade[],
  overrides: { seed?: number; maxTrades?: number; create?: () => Promise<Trade> } = {},
) {
  const writes: Writes = {
    create: vi.fn(overrides.create ?? (() => Promise.resolve(aTrade()))),
    amend: vi.fn(() => Promise.resolve(aTrade({ version: 2 }))),
    cancel: vi.fn(() => Promise.resolve(aTrade({ status: 'CANCELLED', version: 2 }))),
  }
  const bus = createBus()
  const frames: ServerFrame[] = []
  bus.subscribe((frame) => frames.push(frame))

  const simulator = createSimulator({
    intervalMs: 50,
    maxTrades: overrides.maxTrades ?? 900,
    rng: new Rng(overrides.seed ?? 1),
    log: fakeLog(),
    bus,
    listActive: () => Promise.resolve(active),
    create: writes.create as unknown as (i: CreateTradeInput, a: string) => Promise<Trade>,
    amend: writes.amend as unknown as (t: string, i: AmendTradeInput, a: string) => Promise<Trade>,
    cancel: writes.cancel as unknown as (
      t: string,
      i: CancelTradeInput,
      a: string,
    ) => Promise<Trade>,
  })

  return { simulator, writes, frames }
}

describe('nextAction', () => {
  it('books when there is nothing to amend or cancel', () => {
    const action = nextAction([], 900, new Rng(7))
    expect(action.kind).toBe('create')
  })

  it('produces a create that satisfies the API contract', () => {
    // Parsed against the same schema the route uses, so a generated trade cannot
    // be something the real endpoint would reject.
    for (let seed = 1; seed <= 50; seed += 1) {
      const action = nextAction([], 900, new Rng(seed))
      if (action.kind !== 'create') {
        continue
      }
      expect(() => createTradeInput.parse(action.input)).not.toThrow()
    }
  })

  it('stops booking at the cap and only amends or cancels', () => {
    const active = [aTrade({ tradeId: 'TRD-100001' }), aTrade({ tradeId: 'TRD-100002' })]

    // Many seeds, because the point is that no seed can reach the create branch.
    for (let seed = 1; seed <= 200; seed += 1) {
      const action = nextAction(active, active.length, new Rng(seed))
      expect(action.kind).not.toBe('create')
    }
  })

  it('targets a real trade at its current version', () => {
    const active = [
      aTrade({ tradeId: 'TRD-100001', version: 3 }),
      aTrade({ tradeId: 'TRD-100002', version: 7 }),
    ]
    const versions = new Map(active.map((trade) => [trade.tradeId, trade.version]))

    for (let seed = 1; seed <= 200; seed += 1) {
      const action = nextAction(active, active.length, new Rng(seed))
      if (action.kind === 'create') {
        throw new Error('unreachable at the cap')
      }
      // A stale version would be rejected as a conflict on every tick, so the
      // feed would appear to run while writing nothing.
      expect(versions.get(action.tradeId)).toBe(action.input.version)
    }
  })

  it('never amends symbol or side', () => {
    const active = [aTrade()]
    for (let seed = 1; seed <= 100; seed += 1) {
      const action = nextAction(active, active.length, new Rng(seed))
      if (action.kind !== 'amend') {
        continue
      }
      // amendTradeInput is a strictObject, so an extra key would be rejected.
      expect(Object.keys(action.input).sort()).toEqual(['price', 'quantity', 'version'])
    }
  })

  it('produces all three kinds across a run', () => {
    const active = [aTrade({ tradeId: 'TRD-100001' }), aTrade({ tradeId: 'TRD-100002' })]
    const rng = new Rng(42)
    const kinds = new Set<string>()
    for (let i = 0; i < 300; i += 1) {
      kinds.add(nextAction(active, 900, rng).kind)
    }
    expect([...kinds].sort()).toEqual(['amend', 'cancel', 'create'])
  })

  it('keeps the quantity when the symbol is not in the reference data', () => {
    const active = [aTrade({ symbol: 'WEIRD', quantity: 1234 })]
    for (let seed = 1; seed <= 100; seed += 1) {
      const action = nextAction(active, active.length, new Rng(seed))
      if (action.kind === 'amend') {
        expect(action.input.quantity).toBe(1234)
      }
    }
  })
})

describe('simulator', () => {
  it('writes through the service under the simulator actor', async () => {
    const { simulator, writes } = buildSimulator([])
    await simulator.runOnce()

    expect(writes.create).toHaveBeenCalledOnce()
    // The actor is what the audit trail records.
    expect(writes.create.mock.calls[0]?.[1]).toBe(SIMULATOR_ACTOR)
  })

  it('books under a real trader even though the actor is the simulator', async () => {
    const { simulator, writes } = buildSimulator([])
    await simulator.runOnce()

    const input = writes.create.mock.calls[0]?.[0] as CreateTradeInput
    expect(input.trader).not.toBe(SIMULATOR_ACTOR)
    expect(input.trader.length).toBeGreaterThan(0)
  })

  it('amends or cancels an existing trade when at the cap', async () => {
    const { simulator, writes } = buildSimulator([aTrade()], { maxTrades: 1 })
    await simulator.runOnce()

    expect(writes.create).not.toHaveBeenCalled()
    expect(writes.amend.mock.calls.length + writes.cancel.mock.calls.length).toBe(1)
  })

  it('publishes nothing of its own: frames come from the write path', async () => {
    const { simulator, frames } = buildSimulator([])
    await simulator.runOnce()

    // The fake writes publish nothing, so an empty list proves nothing was
    // fabricated.
    expect(frames).toEqual([])
  })

  it('survives a rejected write and keeps ticking', async () => {
    const { simulator, writes } = buildSimulator([], {
      create: () => Promise.reject(versionConflict('TRD-100001', 1, 2)),
    })

    simulator.start()

    // More than one attempt is the proof: if the rejection escaped, the first
    // failure would stop the feed for good.
    await vi.waitFor(() => {
      expect(writes.create.mock.calls.length).toBeGreaterThanOrEqual(3)
    })
    expect(simulator.state.running).toBe(true)
    simulator.stop()
  })

  it('reports and broadcasts its state on a real transition only', () => {
    const { simulator, frames } = buildSimulator([])

    expect(simulator.state).toEqual({ running: false, intervalMs: 50 })

    simulator.start()
    expect(simulator.state.running).toBe(true)

    // A second start is not a transition, so it must not publish again.
    simulator.start()
    simulator.stop()
    simulator.stop()

    expect(frames).toEqual([
      { type: 'simulation', running: true, intervalMs: 50 },
      { type: 'simulation', running: false, intervalMs: 50 },
    ])
  })

  it('leaves no timer behind after stop', async () => {
    const { simulator, writes } = buildSimulator([])
    simulator.start()
    simulator.stop()

    // Longer than the interval. A surviving timer would tick in this window and
    // keep writing after the feed was switched off.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(writes.create).not.toHaveBeenCalled()
  })

  it('ticks on the timer while running', async () => {
    const { simulator, writes } = buildSimulator([])
    simulator.start()
    await vi.waitFor(() => {
      expect(writes.create.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    simulator.stop()
  })
})
