import type { DatabaseHandle } from '@tapedeck/database'
import type { Trade } from '@tapedeck/shared'
import { apiError } from '@tapedeck/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'
import { resetDatabase, setupTestDatabase } from './helpers/db.js'
import { createTrade, newTradeBody } from './helpers/fixtures.js'

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

function amend(tradeId: string, version: number, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'PATCH',
    url: `/api/trades/${tradeId}`,
    payload: { quantity: 5_000, price: '71.100000', ...overrides, version },
  })
}

function cancel(tradeId: string, version: number) {
  return app.inject({
    method: 'POST',
    url: `/api/trades/${tradeId}/cancel`,
    payload: { version },
  })
}

describe('optimistic concurrency', () => {
  it('rejects a second amend at the same version with the current version in details', async () => {
    const created = await createTrade(app)

    const first = await amend(created.tradeId, 1, { quantity: 5_000 })
    expect(first.statusCode).toBe(200)

    const second = await amend(created.tradeId, 1, { quantity: 9_000 })

    expect(second.statusCode).toBe(409)
    const error = apiError.parse(second.json())
    if (error.code !== 'VERSION_CONFLICT') {
      throw new Error(`expected VERSION_CONFLICT, got ${error.code}`)
    }
    expect(error.details).toMatchObject({
      tradeId: created.tradeId,
      expectedVersion: 1,
      currentVersion: 2,
    })

    // The loser changed nothing.
    const after = await app.inject({ method: 'GET', url: `/api/trades/${created.tradeId}` })
    expect(after.json()).toMatchObject({ version: 2, quantity: 5_000 })
  })

  it('lets exactly one of two simultaneous amends win', async () => {
    const created = await createTrade(app)

    // Both in flight at once, so they contend for the advisory lock rather than
    // taking it in turn.
    const responses = await Promise.all([
      amend(created.tradeId, 1, { quantity: 5_000 }),
      amend(created.tradeId, 1, { quantity: 9_000 }),
    ])

    const codes = responses.map((response) => response.statusCode).sort()
    expect(codes).toEqual([200, 409])

    const conflict = responses.find((response) => response.statusCode === 409)
    if (!conflict) {
      throw new Error('expected one conflict')
    }
    const error = apiError.parse(conflict.json())
    if (error.code !== 'VERSION_CONFLICT') {
      throw new Error(`expected VERSION_CONFLICT, got ${error.code}`)
    }
    expect(error.details.currentVersion).toBe(2)

    // One winner means one amendment: version 2, and two events, not three.
    const after = await app.inject({ method: 'GET', url: `/api/trades/${created.tradeId}` })
    expect(after.json()).toMatchObject({ version: 2 })
    const events = await app.inject({ method: 'GET', url: `/api/trades/${created.tradeId}/events` })
    expect(events.json().events).toHaveLength(2)
  })

  it('rejects a cancel at a stale version', async () => {
    const created = await createTrade(app)
    await amend(created.tradeId, 1)

    const response = await cancel(created.tradeId, 1)

    expect(response.statusCode).toBe(409)
    expect(apiError.parse(response.json()).code).toBe('VERSION_CONFLICT')
  })
})

describe('invalid state', () => {
  it('rejects an amend of a cancelled trade with INVALID_STATE, not a version conflict', async () => {
    const created = await createTrade(app)
    expect((await cancel(created.tradeId, 1)).statusCode).toBe(200)

    const response = await amend(created.tradeId, 2)

    expect(response.statusCode).toBe(409)
    const error = apiError.parse(response.json())
    if (error.code !== 'INVALID_STATE') {
      throw new Error(`expected INVALID_STATE, got ${error.code}`)
    }
    expect(error.details).toMatchObject({ tradeId: created.tradeId, status: 'CANCELLED' })
  })

  it('reports INVALID_STATE for a cancelled trade even when the version is also stale', async () => {
    const created = await createTrade(app)
    await cancel(created.tradeId, 1)

    // Status is diagnosed before version: "this trade is cancelled" is the more
    // useful of the two true statements.
    const response = await amend(created.tradeId, 1)
    expect(apiError.parse(response.json()).code).toBe('INVALID_STATE')
  })

  it('rejects cancelling a cancelled trade', async () => {
    const created = await createTrade(app)
    await cancel(created.tradeId, 1)

    const response = await cancel(created.tradeId, 2)

    expect(response.statusCode).toBe(409)
    expect(apiError.parse(response.json()).code).toBe('INVALID_STATE')
  })
})

describe('unknown trades', () => {
  it('returns 404 for an amend of an id that does not exist', async () => {
    const response = await amend('TRD-999999', 1)

    expect(response.statusCode).toBe(404)
    expect(apiError.parse(response.json()).code).toBe('NOT_FOUND')
  })

  it('returns 404 for a cancel of an id that does not exist', async () => {
    const response = await cancel('TRD-999999', 1)
    expect(response.statusCode).toBe(404)
  })
})

describe('the serialised write path', () => {
  it('numbers concurrent writes gap-free past a digit boundary', async () => {
    // Twelve crosses seq 9 to 10, which is where a string-typed cursor would
    // start comparing '10' < '9'.
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createTrade(app, { symbol: 'VOD', quantity: 1_000 + index }),
      ),
    )

    expect(new Set(created.map((trade) => trade.tradeId)).size).toBe(12)

    const response = await app.inject({ method: 'GET', url: '/api/trades' })
    expect(response.json().seq).toBe(12)

    const seqs = await Promise.all(
      created.map(async (trade) => {
        const events = await app.inject({
          method: 'GET',
          url: `/api/trades/${trade.tradeId}/events`,
        })
        const [event] = events.json().events
        expect(typeof event.seq).toBe('number')
        return event.seq as number
      }),
    )

    expect([...seqs].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  /**
   * The claim the write lock makes about the idempotency key. The repository
   * reads for an earlier booking and then inserts, which is a check-then-act and
   * would be a race on its own; it is safe only because one create runs at a
   * time. Ten at once is the test of that, and it would also catch the insert
   * being moved out from under the lock later.
   */
  it('books once when the same key arrives concurrently ten times', async () => {
    const KEY = '5d4c3b2a-1098-4765-ba43-210fedcba987'

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/trades',
          payload: newTradeBody({ clientTradeId: KEY }),
        }),
      ),
    )

    const codes = responses.map((response) => response.statusCode).sort((a, b) => a - b)
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201])

    // Every reply names the same trade, so the nine that lost the race still
    // answered the question the caller asked rather than an error.
    const ids = new Set(responses.map((response) => (response.json() as Trade).tradeId))
    expect(ids.size).toBe(1)

    const listed = await app.inject({ method: 'GET', url: '/api/trades' })
    expect((listed.json() as { trades: Trade[] }).trades).toHaveLength(1)
  })

  it('keeps version equal to the event count under concurrent amends', async () => {
    const created = await createTrade(app)

    // Ten contenders, all at version 1: one wins, nine conflict.
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        amend(created.tradeId, 1, { quantity: 1_000 + index }),
      ),
    )
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1)

    const trade = await app.inject({ method: 'GET', url: `/api/trades/${created.tradeId}` })
    const events = await app.inject({ method: 'GET', url: `/api/trades/${created.tradeId}/events` })
    expect(events.json().events).toHaveLength(trade.json().version)
  })
})
