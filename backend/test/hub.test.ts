import type { ServerFrame } from '@tapedeck/shared'
import type { FastifyBaseLogger } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { createBus } from '../src/bus.js'
import { createHub } from '../src/ws/hub.js'

/**
 * The handshake drain, driven directly rather than over a real socket:
 * readSnapshot publishes into the window between the read starting and the
 * subscription being handed over, which makes that race deterministic.
 */

function fakeLog(): FastifyBaseLogger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger
}

/** Records what was written, and reports itself as open throughout. */
function fakeSocket(): { socket: WebSocket; sent: ServerFrame[] } {
  const sent: ServerFrame[] = []
  const socket = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: (payload: string) => sent.push(JSON.parse(payload) as ServerFrame),
    on: () => undefined,
    ping: () => undefined,
    terminate: () => undefined,
    close: () => undefined,
  }
  return { socket: socket as unknown as WebSocket, sent }
}

/**
 * A hub whose snapshot read publishes `during` before it resolves, and which
 * reports the feed as `running` when asked at handshake time.
 */
function hubPublishing(during: ServerFrame[], running = false) {
  const bus = createBus()
  const hub = createHub({
    bus,
    log: fakeLog(),
    pingIntervalMs: 60_000,
    readSimulation: () => ({ running, intervalMs: 2_000 }),
    readSnapshot: async () => {
      for (const frame of during) {
        bus.publish(frame)
      }
      return { seq: 5, trades: [], positions: [] }
    },
  })
  return { hub, bus }
}

const simulationFrames = (sent: ServerFrame[]): ServerFrame[] =>
  sent.filter((frame) => frame.type === 'simulation')

describe('the handshake', () => {
  it('tells a connecting client the feed is running, with no toggle involved', async () => {
    const { hub } = hubPublishing([], true)
    const { socket, sent } = fakeSocket()

    await hub.attach(socket)
    hub.close()

    // This is what makes a reconnect a resync.
    expect(sent).toEqual([
      { type: 'snapshot', seq: 5, trades: [], positions: [] },
      { type: 'simulation', running: true, intervalMs: 2_000 },
    ])
  })

  it('reports a stopped feed just as explicitly, rather than saying nothing', async () => {
    const { hub } = hubPublishing([], false)
    const { socket, sent } = fakeSocket()

    await hub.attach(socket)
    hub.close()

    expect(simulationFrames(sent)).toEqual([
      { type: 'simulation', running: false, intervalMs: 2_000 },
    ])
  })
})

describe('the handshake drain', () => {
  it('prefers a simulation frame published during the snapshot read', async () => {
    // The read observed a running feed; it was stopped while the read was in
    // flight. The buffered frame is strictly newer, so it must win.
    const { hub } = hubPublishing([{ type: 'simulation', running: false, intervalMs: 2_000 }], true)
    const { socket, sent } = fakeSocket()

    await hub.attach(socket)
    hub.close()

    expect(simulationFrames(sent)).toEqual([
      { type: 'simulation', running: false, intervalMs: 2_000 },
    ])
  })

  it('sends only the last simulation frame when the feed was toggled twice', async () => {
    const { hub } = hubPublishing([
      { type: 'simulation', running: true, intervalMs: 2_000 },
      { type: 'simulation', running: false, intervalMs: 2_000 },
    ])
    const { socket, sent } = fakeSocket()

    await hub.attach(socket)
    hub.close()

    // Unsequenced state, so the latest supersedes.
    expect(simulationFrames(sent)).toEqual([
      { type: 'simulation', running: false, intervalMs: 2_000 },
    ])
  })

  it('still drops sequenced frames the snapshot already contains', async () => {
    const { hub } = hubPublishing([
      // At the snapshot cursor, so already included and not to be replayed.
      { type: 'trade.created', seq: 5, trade: aTrade() },
      { type: 'trade.amended', seq: 6, trade: aTrade({ version: 2 }) },
      { type: 'simulation', running: true, intervalMs: 2_000 },
    ])
    const { socket, sent } = fakeSocket()

    await hub.attach(socket)
    hub.close()

    // The simulation drain must not weaken the cursor filter next to it.
    expect(sent.map((frame) => frame.type)).toEqual(['snapshot', 'trade.amended', 'simulation'])
  })
})

function aTrade(overrides: Record<string, unknown> = {}) {
  return {
    tradeId: 'TRD-100001',
    symbol: 'VOD',
    side: 'BUY' as const,
    quantity: 10_000,
    filledQuantity: 0,
    price: '72.465000',
    trader: 'k.madan',
    book: 'EQ-LDN-01',
    counterparty: 'HSBC',
    tradeTimestamp: '2026-10-03T09:15:00.000Z',
    status: 'NEW' as const,
    version: 1,
    updatedAt: '2026-10-03T09:15:00.000Z',
    ...overrides,
  } as never
}
