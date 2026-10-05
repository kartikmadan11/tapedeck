import type { DatabaseHandle } from '@tapedeck/database'
import type { Trade } from '@tapedeck/shared'
import { apiError, BLOTTER_LIMIT } from '@tapedeck/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'
import { resetDatabase, setupTestDatabase } from './helpers/db.js'
import { createTrade, fillTrades, maxSeq, newTradeBody } from './helpers/fixtures.js'

let handle: DatabaseHandle
let app: FastifyInstance

beforeAll(async () => {
  handle = await setupTestDatabase()
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
  await handle.close()
})

beforeEach(async () => {
  await resetDatabase(handle)
})

describe('POST /api/trades', () => {
  it('books a trade with a readable id, version 1 and the price unchanged', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trades',
      payload: newTradeBody({ price: '72.465000' }),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      tradeId: 'TRD-100001',
      symbol: 'VOD',
      status: 'ACTIVE',
      version: 1,
      // Not 72.465: the string the client sent is the string the client gets.
      price: '72.465000',
    })
  })

  it('returns timestamps as UTC ISO, not a Postgres literal', async () => {
    const trade = await createTrade(app, { tradeTimestamp: '2026-10-02T09:15:00.000Z' })

    // A Postgres timestamptz rendered as a string would be
    // '2026-10-02 09:15:00+00', whose offset follows the server's timezone
    // setting. The format must not depend on a database session variable.
    expect(trade).toMatchObject({ tradeTimestamp: '2026-10-02T09:15:00.000Z' })
    expect(trade.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('refuses a trade timestamp that is not UTC ISO', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trades',
      payload: newTradeBody({ tradeTimestamp: '2026-10-02 09:15:00+01' }),
    })

    expect(response.statusCode).toBe(400)
  })

  it('uppercases the symbol through the shared schema', async () => {
    const trade = await createTrade(app, { symbol: 'vod.l' })
    expect(trade).toMatchObject({ symbol: 'VOD.L' })
  })

  it('rejects a price of zero', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trades',
      payload: newTradeBody({ price: '0' }),
    })

    expect(response.statusCode).toBe(400)
    const error = apiError.parse(response.json())
    expect(error.code).toBe('VALIDATION_FAILED')
  })

  it('rejects a fractional quantity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trades',
      payload: newTradeBody({ quantity: 1.5 }),
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a price carrying more than six decimal places', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trades',
      payload: newTradeBody({ price: '72.4650001' }),
    })

    expect(response.statusCode).toBe(400)
  })

  it('rejects a counterparty that is not on the list', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trades',
      payload: newTradeBody({ counterparty: 'UBSf' }),
    })

    // One character off a real name. Length validation cannot tell the two
    // apart, which is why the field is a list and not a string.
    expect(response.statusCode).toBe(400)
    const error = apiError.parse(response.json())
    if (error.code !== 'VALIDATION_FAILED') {
      throw new Error(`expected VALIDATION_FAILED, got ${error.code}`)
    }
    expect(error.details.issues.map((issue) => issue.path)).toContain('counterparty')
  })

  it('rejects server-assigned fields in the body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trades',
      payload: newTradeBody({ version: 7, status: 'CANCELLED' }),
    })

    expect(response.statusCode).toBe(400)
    const error = apiError.parse(response.json())
    if (error.code !== 'VALIDATION_FAILED') {
      throw new Error(`expected VALIDATION_FAILED, got ${error.code}`)
    }
    expect(error.details.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['version', 'status']),
    )
  })

  it('returns a validation error for a malformed JSON body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/trades',
      headers: { 'content-type': 'application/json' },
      payload: '{"symbol":',
    })

    expect(response.statusCode).toBe(400)
    expect(apiError.parse(response.json()).code).toBe('VALIDATION_FAILED')
  })

  /**
   * The guarantee: a client that retries a booking it never got an answer to
   * does not end up with two trades. Everything else in the feature is a
   * convenience; this is the part that has to be true.
   */
  describe('the idempotency key', () => {
    const KEY = '3f2a8c1e-5b47-4d9a-8e21-0c6f4b7d9a35'

    function post(body: Record<string, unknown>) {
      return app.inject({ method: 'POST', url: '/api/trades', payload: newTradeBody(body) })
    }

    async function tradeCount(): Promise<number> {
      const response = await app.inject({ method: 'GET', url: '/api/trades' })
      return (response.json() as { trades: Trade[] }).trades.length
    }

    it('books once and replays thereafter, answering 201 then 200', async () => {
      const first = await post({ clientTradeId: KEY })
      const second = await post({ clientTradeId: KEY })

      expect(first.statusCode).toBe(201)
      expect(second.statusCode).toBe(200)

      // The same trade, not merely an equal one: the second request created
      // nothing, so there is no second id for it to have returned.
      expect(second.json()).toEqual(first.json())
      expect(await tradeCount()).toBe(1)
    })

    // Ten presses is the case this was built for, and it is why the client mints
    // the key once per ticket rather than once per press.
    it('survives a key sent ten times', async () => {
      const responses = []
      for (let attempt = 0; attempt < 10; attempt += 1) {
        responses.push(await post({ clientTradeId: KEY }))
      }

      expect(responses.map((response) => response.statusCode)).toEqual([
        201, 200, 200, 200, 200, 200, 200, 200, 200, 200,
      ])
      expect(await tradeCount()).toBe(1)
    })

    /**
     * The audit trail is the reason a replay cannot just re-run the insert and
     * let the constraint fail. One booking is one CREATED event, so a replay that
     * appended a second would make version disagree with the event count, which
     * the whole concurrency model rests on.
     */
    it('appends no second event for a replay', async () => {
      const first = await post({ clientTradeId: KEY })
      const { tradeId } = first.json() as Trade
      const before = await maxSeq(handle)

      await post({ clientTradeId: KEY })

      expect(await maxSeq(handle)).toBe(before)
      const events = await app.inject({ method: 'GET', url: `/api/trades/${tradeId}/events` })
      expect((events.json() as { events: unknown[] }).events).toHaveLength(1)
    })

    /**
     * The workflow a blanket confirmation would have broken. Identical economics
     * under two keys are two deliberate bookings, which is what working an order
     * in clips looks like, and the server must not collapse them.
     */
    it('books both when identical economics carry different keys', async () => {
      const first = await post({ clientTradeId: KEY })
      const second = await post({ clientTradeId: '9c8b7a65-4321-4fed-ba98-7654321fedcb' })

      expect(first.statusCode).toBe(201)
      expect(second.statusCode).toBe(201)
      expect((second.json() as Trade).tradeId).not.toBe((first.json() as Trade).tradeId)
      expect(await tradeCount()).toBe(2)
    })

    /**
     * Nulls are distinct in the unique index, which is what lets the seed, the
     * simulator and an un-updated client keep booking. A NULLS NOT DISTINCT index
     * would let the first keyless trade block every one after it.
     */
    it('still books repeatedly when no key is sent', async () => {
      expect((await post({})).statusCode).toBe(201)
      expect((await post({})).statusCode).toBe(201)
      expect(await tradeCount()).toBe(2)
    })

    it('rejects a key that is not a uuid, rather than storing it', async () => {
      const response = await post({ clientTradeId: 'ticket-1' })

      expect(response.statusCode).toBe(400)
      const error = apiError.parse(response.json())
      if (error.code !== 'VALIDATION_FAILED') {
        throw new Error(`expected VALIDATION_FAILED, got ${error.code}`)
      }
      expect(error.details.issues.map((issue) => issue.path)).toContain('clientTradeId')
    })

    // It identifies the request, not the trade. Returning it would put a value a
    // client chose into the read model every other client parses.
    it('is absent from the trade it books', async () => {
      const trade = (await post({ clientTradeId: KEY })).json() as Record<string, unknown>
      expect(trade).not.toHaveProperty('clientTradeId')
    })
  })
})

describe('GET /api/trades', () => {
  it('carries the stream cursor alongside the rows', async () => {
    await createTrade(app)
    await createTrade(app, { symbol: 'HSBA' })

    const response = await app.inject({ method: 'GET', url: '/api/trades' })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.trades).toHaveLength(2)
    // One event per mutation, so the cursor equals the number of mutations.
    expect(body.seq).toBe(2)
  })

  it('filters by symbol, side and status', async () => {
    await createTrade(app, { symbol: 'VOD', side: 'BUY' })
    await createTrade(app, { symbol: 'HSBA', side: 'SELL' })

    const bySymbol = await app.inject({ method: 'GET', url: '/api/trades?symbol=HSBA' })
    expect(bySymbol.json().trades).toHaveLength(1)
    expect(bySymbol.json().trades[0]).toMatchObject({ symbol: 'HSBA' })

    const bySide = await app.inject({ method: 'GET', url: '/api/trades?side=BUY' })
    expect(bySide.json().trades).toHaveLength(1)
    expect(bySide.json().trades[0]).toMatchObject({ side: 'BUY' })

    const cancelled = await app.inject({ method: 'GET', url: '/api/trades?status=CANCELLED' })
    expect(cancelled.json().trades).toHaveLength(0)
  })

  it('rejects an unknown filter rather than ignoring it', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/trades?sybmol=VOD' })
    expect(response.statusCode).toBe(400)
  })

  it('keeps the most recent rows when the caller names a limit', async () => {
    await createTrade(app, { symbol: 'VOD', tradeTimestamp: '2026-10-02T09:00:00.000Z' })
    await createTrade(app, { symbol: 'HSBA', tradeTimestamp: '2026-10-02T09:30:00.000Z' })
    await createTrade(app, { symbol: 'BARC', tradeTimestamp: '2026-10-02T10:00:00.000Z' })

    const response = await app.inject({ method: 'GET', url: '/api/trades?limit=2' })

    const { trades } = response.json()
    // Which two is the assertion, not how many. A limit applied before the order
    // by would return whichever rows the scan happened to reach first.
    expect(trades.map((row: Trade) => row.symbol)).toEqual(['BARC', 'HSBA'])
  })

  it('windows to the blotter limit when the caller names none', async () => {
    await fillTrades(handle, BLOTTER_LIMIT + 25)

    const response = await app.inject({ method: 'GET', url: '/api/trades' })

    // The default is the point: cancelled trades stay on the tape, so the book
    // only grows, and an unbounded read must not be reachable by forgetting to
    // ask for a bounded one.
    expect(response.json().trades).toHaveLength(BLOTTER_LIMIT)
  })

  it('refuses a limit outside the range a client may ask for', async () => {
    for (const limit of ['0', '-1', '5001', 'all']) {
      const response = await app.inject({ method: 'GET', url: `/api/trades?limit=${limit}` })
      expect(response.statusCode, `limit=${limit}`).toBe(400)
    }
  })
})

describe('GET /api/trades/:tradeId', () => {
  it('returns one trade', async () => {
    const created = await createTrade(app)
    const response = await app.inject({ method: 'GET', url: `/api/trades/${created.tradeId}` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ tradeId: created.tradeId })
  })

  it('returns 404 with the id in details for an unknown trade', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/trades/TRD-999999' })

    expect(response.statusCode).toBe(404)
    const error = apiError.parse(response.json())
    if (error.code !== 'NOT_FOUND') {
      throw new Error(`expected NOT_FOUND, got ${error.code}`)
    }
    expect(error.details.tradeId).toBe('TRD-999999')
  })

  it('returns 400 for an id that is not a trade id', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/trades/not-a-trade' })
    expect(response.statusCode).toBe(400)
  })
})

describe('PATCH /api/trades/:tradeId', () => {
  it('amends quantity and price and bumps the version', async () => {
    const created = await createTrade(app)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/trades/${created.tradeId}`,
      payload: { quantity: 5_000, price: '71.100000', version: 1 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      quantity: 5_000,
      price: '71.100000',
      // Unchanged, and asserted rather than assumed: this is the field an
      // amendment must not be able to move.
      counterparty: created.counterparty,
      version: 2,
      status: 'ACTIVE',
    })
  })

  it('refuses an amendment carrying a counterparty, rather than ignoring it', async () => {
    const created = await createTrade(app)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/trades/${created.tradeId}`,
      payload: { quantity: 5_000, price: '71.100000', counterparty: 'UBS', version: 1 },
    })

    // A 400 and not a silent drop. Accepting the body and discarding the field
    // would tell the caller their rebooking instruction had been carried out.
    expect(response.statusCode).toBe(400)
    const error = apiError.parse(response.json())
    if (error.code !== 'VALIDATION_FAILED') {
      throw new Error(`expected VALIDATION_FAILED, got ${error.code}`)
    }
    expect(error.details.issues.map((issue) => issue.path)).toContain('counterparty')

    const after = await app.inject({ method: 'GET', url: `/api/trades/${created.tradeId}` })
    expect(after.json()).toMatchObject({ counterparty: created.counterparty, version: 1 })
  })

  it('rejects an attempt to amend the symbol', async () => {
    const created = await createTrade(app)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/trades/${created.tradeId}`,
      payload: { quantity: 5_000, price: '71.100000', version: 1, symbol: 'HSBA' },
    })

    expect(response.statusCode).toBe(400)
    const error = apiError.parse(response.json())
    if (error.code !== 'VALIDATION_FAILED') {
      throw new Error(`expected VALIDATION_FAILED, got ${error.code}`)
    }
    expect(error.details.issues.map((issue) => issue.path)).toContain('symbol')

    const after = await app.inject({ method: 'GET', url: `/api/trades/${created.tradeId}` })
    expect(after.json()).toMatchObject({ symbol: 'VOD', version: 1 })
  })

  it('rejects an attempt to amend the side', async () => {
    const created = await createTrade(app)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/trades/${created.tradeId}`,
      payload: { quantity: 5_000, price: '71.100000', version: 1, side: 'SELL' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('requires a version', async () => {
    const created = await createTrade(app)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/trades/${created.tradeId}`,
      payload: { quantity: 5_000, price: '71.100000' },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('POST /api/trades/:tradeId/cancel', () => {
  it('cancels an active trade and bumps the version', async () => {
    const created = await createTrade(app)

    const response = await app.inject({
      method: 'POST',
      url: `/api/trades/${created.tradeId}/cancel`,
      payload: { version: 1 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'CANCELLED', version: 2 })
  })

  it('does not accept a status in the body', async () => {
    const created = await createTrade(app)

    const response = await app.inject({
      method: 'POST',
      url: `/api/trades/${created.tradeId}/cancel`,
      payload: { version: 1, status: 'ACTIVE' },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('GET /api/trades/:tradeId/events', () => {
  it('returns the full chain oldest first, with before null on creation', async () => {
    const created = await createTrade(app)
    await app.inject({
      method: 'PATCH',
      url: `/api/trades/${created.tradeId}`,
      payload: { quantity: 5_000, price: '71.100000', version: 1 },
    })
    await app.inject({
      method: 'POST',
      url: `/api/trades/${created.tradeId}/cancel`,
      payload: { version: 2 },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/trades/${created.tradeId}/events`,
    })

    expect(response.statusCode).toBe(200)
    const { events } = response.json()
    expect(events.map((event: { eventType: string }) => event.eventType)).toEqual([
      'CREATED',
      'AMENDED',
      'CANCELLED',
    ])
    expect(events[0].before).toBeNull()
    expect(events[1].before).toMatchObject({ version: 1, quantity: 10_000 })
    expect(events[1].after).toMatchObject({ version: 2, quantity: 5_000 })
    expect(events[2].after).toMatchObject({ status: 'CANCELLED', version: 3 })

    // The audit trail is the sequence source, so its seqs are the stream's.
    expect(events.map((event: { seq: number }) => event.seq)).toEqual([1, 2, 3])
  })

  it('returns 404 for an unknown trade', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/trades/TRD-999999/events' })
    expect(response.statusCode).toBe(404)
  })
})

describe('GET /api/positions', () => {
  it('nets exposure per symbol in exact decimal and excludes cancelled trades', async () => {
    await createTrade(app, { symbol: 'VOD', side: 'BUY', quantity: 1_000, price: '2.500000' })
    await createTrade(app, { symbol: 'VOD', side: 'SELL', quantity: 400, price: '2.000000' })
    const doomed = await createTrade(app, {
      symbol: 'VOD',
      side: 'BUY',
      quantity: 9_999,
      price: '3.000000',
    })
    await app.inject({
      method: 'POST',
      url: `/api/trades/${doomed.tradeId}/cancel`,
      payload: { version: 1 },
    })

    const response = await app.inject({ method: 'GET', url: '/api/positions' })

    expect(response.statusCode).toBe(200)
    const { positions, seq } = response.json()
    expect(seq).toBe(4)
    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({
      symbol: 'VOD',
      netQuantity: 600,
      boughtQuantity: 1_000,
      soldQuantity: 400,
      // 1000 * 2.5 - 400 * 2.0, exact, not 1699.9999999999998.
      netNotional: '1700.000000',
      tradeCount: 2,
    })
  })
})

describe('routing and health', () => {
  it('reports healthy when the database answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok' })
  })

  it('returns a JSON 404 for an unknown api route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toContain('application/json')
    expect(apiError.parse(response.json()).code).toBe('NOT_FOUND')
  })

  it('returns a JSON 404 for a non-api route when no frontend is mounted', async () => {
    const response = await app.inject({ method: 'GET', url: '/blotter' })
    expect(response.statusCode).toBe(404)
    expect(apiError.parse(response.json()).code).toBe('NOT_FOUND')
  })
})

describe('the simulation control', () => {
  afterEach(() => {
    // The feed writes trades, so leaving it running would leak rows into the
    // next test in this file.
    app.simulator.stop()
  })

  it('reports the feed as stopped under the test config', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/simulation' })

    expect(response.statusCode).toBe(200)
    // buildApp() creates the simulator but never starts it, which is what keeps
    // every other test in this suite free of trades it did not book.
    expect(response.json()).toEqual({ running: false, intervalMs: 2_000 })
  })

  it('starts and stops the feed and reports the new state', async () => {
    const started = await app.inject({
      method: 'POST',
      url: '/api/simulation',
      payload: { running: true },
    })
    expect(started.statusCode).toBe(200)
    expect(started.json()).toMatchObject({ running: true })

    const stopped = await app.inject({
      method: 'POST',
      url: '/api/simulation',
      payload: { running: false },
    })
    expect(stopped.json()).toMatchObject({ running: false })
  })

  it('rejects a body that does not carry running', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/simulation',
      payload: { enabled: true },
    })

    expect(response.statusCode).toBe(400)
    expect(apiError.parse(response.json()).code).toBe('VALIDATION_FAILED')
  })

  it('refuses to let a client set the cadence', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/simulation',
      payload: { running: true, intervalMs: 1 },
    })

    // A strictObject, so asking the server to write as fast as it can is a 400
    // rather than something it quietly ignores.
    expect(response.statusCode).toBe(400)
  })
})
