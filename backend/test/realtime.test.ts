import type { DatabaseHandle } from '@tapedeck/database'
import { frameSequence, type ServerFrame } from '@tapedeck/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { listenTestApp } from './helpers/app.js'
import { resetDatabase, setupTestDatabase } from './helpers/db.js'
import { createTrade, maxSeq, newTradeBody } from './helpers/fixtures.js'
import { FrameClient } from './helpers/ws.js'

let handle: DatabaseHandle
let app: FastifyInstance
let url: string
let clients: FrameClient[] = []

beforeAll(async () => {
  handle = await setupTestDatabase()
  const listening = await listenTestApp()
  app = listening.app
  url = listening.url
})

afterAll(async () => {
  await app.close()
  await handle.close()
})

beforeEach(async () => {
  await resetDatabase(handle)
})

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()))
  clients = []
})

async function connect(): Promise<FrameClient> {
  const client = await FrameClient.connect(url)
  clients.push(client)
  return client
}

function amend(tradeId: string, version: number) {
  return app.inject({
    method: 'PATCH',
    url: `/api/trades/${tradeId}`,
    payload: { quantity: 5_000, price: '71.100000', version },
  })
}

/** The server's close bookkeeping is not synchronous with the client's close. */
async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`condition still false after ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function expectSnapshot(frame: ServerFrame) {
  if (frame.type !== 'snapshot') {
    throw new Error(`expected a snapshot first, got ${frame.type}`)
  }
  return frame
}

/**
 * Consumes the two frames a quiet connection opens with: the snapshot, then the
 * generated feed's state. Asserting the pair in one place means every test in
 * this file covers the handshake shape rather than only the ones that look at it.
 *
 * Quiet meaning nothing was published during the snapshot read. The feed state is
 * drained last, so a connection that raced a mutation receives the replay in
 * between and reads its frames directly instead.
 */
async function handshake(client: FrameClient) {
  const snapshot = expectSnapshot(await client.next())

  const simulation = await client.next()
  if (simulation.type !== 'simulation') {
    throw new Error(`expected the feed state after the snapshot, got ${simulation.type}`)
  }

  return snapshot
}

describe('the handshake', () => {
  it('opens with a snapshot carrying trades, positions and the cursor', async () => {
    await createTrade(app, { symbol: 'VOD', quantity: 1_000, price: '2.500000' })

    const snapshot = await handshake(await connect())

    expect(snapshot.seq).toBe(1)
    expect(snapshot.trades).toHaveLength(1)
    // Positions arrive with the snapshot, so the panel is populated on first
    // paint rather than waiting for someone to mutate.
    expect(snapshot.positions).toEqual([
      expect.objectContaining({ symbol: 'VOD', netQuantity: 1_000, netNotional: '2500.000000' }),
    ])
  })

  it('carries cursor 0 against an empty database', async () => {
    const snapshot = await handshake(await connect())
    expect(snapshot.seq).toBe(0)
    expect(snapshot.trades).toEqual([])
  })

  it('does not replay frames the snapshot already contains', async () => {
    await createTrade(app)
    const client = await connect()

    expect((await handshake(client)).seq).toBe(1)
    // Nothing follows: the create is in the snapshot, not also on the stream.
    await expect(client.next(300)).rejects.toThrow(/no frame/)
  })

  it('delivers no gap and no duplicate when a mutation lands mid-handshake', async () => {
    await createTrade(app)

    // The connect and the mutation are deliberately racing: the frame may land
    // before the snapshot read, between the read and the subscribe, or after.
    const connecting = connect()
    const mutating = createTrade(app, { symbol: 'HSBA' })
    const [client] = await Promise.all([connecting, mutating])

    const expected = await maxSeq(handle)
    expect(expected).toBe(2)

    // Not handshake(): this connection is racing a write, so the frame after the
    // snapshot may be the replay rather than the feed state. The loop skips
    // unsequenced frames anyway, which is what makes the order irrelevant here.
    let cursor = expectSnapshot(await client.next()).seq
    while (cursor < expected) {
      const seq = frameSequence(await client.next())
      if (seq === null) {
        continue
      }
      // Strictly the next one: a gap or a repeat fails here.
      expect(seq).toBe(cursor + 1)
      cursor = seq
    }

    expect(cursor).toBe(expected)
  })
})

describe('broadcast', () => {
  it('sends one mutation to both connected clients with the same cursor', async () => {
    const [first, second] = await Promise.all([connect(), connect()])
    if (!first || !second) {
      throw new Error('expected two clients')
    }
    await handshake(first)
    await handshake(second)

    const created = await createTrade(app, { symbol: 'BARC' })

    for (const client of [first, second]) {
      const delta = await client.next()
      expect(delta).toMatchObject({
        type: 'trade.created',
        seq: 1,
        trade: { tradeId: created.tradeId, symbol: 'BARC' },
      })

      const positions = await client.next()
      expect(positions).toMatchObject({ type: 'positions' })
    }
  })

  /**
   * A replay wrote nothing, so there is nothing to broadcast: no event means no
   * seq to put on a frame, and a second trade.created would flash a row every
   * client already has. The positions frame is covered by the same assertion,
   * since a replay moved no row.
   */
  it('publishes nothing when a booking is replayed', async () => {
    const KEY = 'a1b2c3d4-e5f6-4789-ab01-23456789abcd'
    const client = await connect()
    await handshake(client)

    const first = await app.inject({
      method: 'POST',
      url: '/api/trades',
      payload: newTradeBody({ clientTradeId: KEY }),
    })
    expect(first.statusCode).toBe(201)
    expect(await client.next()).toMatchObject({ type: 'trade.created', seq: 1 })
    expect(await client.next()).toMatchObject({ type: 'positions' })

    const replay = await app.inject({
      method: 'POST',
      url: '/api/trades',
      payload: newTradeBody({ clientTradeId: KEY }),
    })
    expect(replay.statusCode).toBe(200)

    await expect(client.next(300)).rejects.toThrow(/no frame/)
  })

  it('numbers create, amend and cancel consecutively', async () => {
    const client = await connect()
    await handshake(client)

    const created = await createTrade(app)
    await amend(created.tradeId, 1)
    await app.inject({
      method: 'POST',
      url: `/api/trades/${created.tradeId}/cancel`,
      payload: { version: 2 },
    })

    const deltas: ServerFrame[] = []
    while (deltas.length < 3) {
      const frame = await client.next()
      if (frame.type !== 'positions') {
        deltas.push(frame)
      }
    }

    expect(deltas.map((frame) => frame.type)).toEqual([
      'trade.created',
      'trade.amended',
      'trade.cancelled',
    ])
    expect(deltas.map(frameSequence)).toEqual([1, 2, 3])
  })

  it('sends seq as a number, not the string pg returns for int8', async () => {
    const client = await connect()
    await handshake(client)
    await createTrade(app)

    // The frame is read off the socket before the shared schema sees it, so this
    // asserts the JSON on the wire rather than a coercion in the parser.
    const delta = await client.next()
    if (delta.type !== 'trade.created') {
      throw new Error(`expected trade.created, got ${delta.type}`)
    }
    expect(typeof delta.seq).toBe('number')
  })

  it('omits seq from positions frames so they cannot advance a cursor', async () => {
    const client = await connect()
    await handshake(client)
    await createTrade(app)

    const delta = await client.next()
    expect(frameSequence(delta)).not.toBeNull()

    const positions = await client.next()
    expect(positions.type).toBe('positions')
    expect(frameSequence(positions)).toBeNull()

    // Asserted against the raw payload: the schema would quietly strip a seq the
    // server should not have sent.
    const raw = client.raw.at(-1)
    expect(raw).toContain('"type":"positions"')
    expect(raw).not.toContain('"seq"')
  })

  it('stops sending to a client that has disconnected', async () => {
    const staying = await connect()
    const leaving = await connect()
    await handshake(staying)
    await handshake(leaving)
    expect(app.hub.clientCount).toBe(2)

    await leaving.close()
    await createTrade(app)

    expect(await staying.next()).toMatchObject({ type: 'trade.created' })
    await waitFor(() => app.hub.clientCount === 1)
  })

  it('recovers the full state on reconnect after frames were missed', async () => {
    const first = await connect()
    await handshake(first)
    await createTrade(app)
    await first.close()

    // Mutations while nobody is listening.
    const second = await createTrade(app, { symbol: 'HSBA' })
    await amend(second.tradeId, 1)

    const reconnected = await connect()
    const snapshot = await handshake(reconnected)

    expect(snapshot.seq).toBe(3)
    expect(snapshot.trades).toHaveLength(2)
  })

  it('tells every client when the feed is toggled, without moving a cursor', async () => {
    const one = await connect()
    const two = await connect()
    const cursor = (await handshake(one)).seq
    await handshake(two)

    try {
      app.simulator.start()

      // Both windows agree about the feed. A per-window toggle would leave the
      // second client believing the blotter is idle while it is being written to.
      for (const client of [one, two]) {
        const frame = await client.next()
        expect(frame).toMatchObject({ type: 'simulation', running: true })
        // Unsequenced, like positions: advancing the cursor here would make the
        // client discard the trade frames the feed is about to produce.
        expect(frameSequence(frame)).toBeNull()
      }
    } finally {
      app.simulator.stop()
    }

    expect(cursor).toBe(0)
  })
})
