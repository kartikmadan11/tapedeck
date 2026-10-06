import type { DatabaseHandle, SeedSummary } from '@tapedeck/database'
import { seed, seedIfEmpty, tradeEvents, trades } from '@tapedeck/database'
import { position, trade } from '@tapedeck/shared'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'
import { resetDatabase, setupTestDatabase } from './helpers/db.js'

let handle: DatabaseHandle
let app: FastifyInstance
let summary: SeedSummary

// Seeded once for the whole file: 500 trades through the real write path is the
// expensive part, and every assertion here is read-only.
beforeAll(async () => {
  handle = await setupTestDatabase()
  await resetDatabase(handle)
  summary = await seed(handle)
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
  await handle.close()
})

describe('the seeded dataset', () => {
  it('is deterministic, so the README can quote its counts', () => {
    expect(summary).toEqual({ trades: 500, amended: 83, cancelled: 32, events: 615 })
    expect(summary.events).toBe(summary.trades + summary.amended + summary.cancelled)
  })

  it('gives every trade a version equal to its event count', async () => {
    const result = await handle.db.execute<{ offenders: number }>(sql`
      select count(*)::int as offenders
      from ${trades} t
      where t.version <> (
        select count(*) from ${tradeEvents} e where e.trade_id = t.trade_id
      )
    `)

    // Holds because nothing writes status or version directly.
    expect(result.rows[0]?.offenders).toBe(0)
  })

  it('gives every trade exactly one CREATED event', async () => {
    const result = await handle.db.execute<{ offenders: number }>(sql`
      select count(*)::int as offenders
      from ${trades} t
      where (
        select count(*) from ${tradeEvents} e
        where e.trade_id = t.trade_id and e.event_type = 'CREATED'
      ) <> 1
    `)

    expect(result.rows[0]?.offenders).toBe(0)
  })

  it('gives every cancelled trade a CANCELLED event', async () => {
    const result = await handle.db.execute<{ offenders: number }>(sql`
      select count(*)::int as offenders
      from ${trades} t
      where t.status = 'CANCELLED' and not exists (
        select 1 from ${tradeEvents} e
        where e.trade_id = t.trade_id and e.event_type = 'CANCELLED'
      )
    `)

    expect(result.rows[0]?.offenders).toBe(0)
  })

  it('numbers events gap-free from 1', async () => {
    const result = await handle.db.execute<{ rows: number; lowest: number; highest: number }>(sql`
      select count(*)::int as rows, min(seq)::int as lowest, max(seq)::int as highest
      from ${tradeEvents}
    `)
    const row = result.rows[0]

    // Gap-free only because every write took the advisory lock: a bigserial on
    // its own leaves holes wherever a transaction rolled back.
    expect(row).toMatchObject({ rows: 615, lowest: 1, highest: 615 })
  })

  it('issues contiguous readable ids from TRD-100001', async () => {
    const result = await handle.db.execute<{ lowest: string; highest: string; unique_ids: number }>(
      sql`select min(trade_id) as lowest, max(trade_id) as highest,
                 count(distinct trade_id)::int as unique_ids
          from ${trades}`,
    )

    expect(result.rows[0]).toMatchObject({
      lowest: 'TRD-100001',
      highest: 'TRD-100500',
      unique_ids: 500,
    })
  })

  it('stores price as numeric, returned as a string at full scale', async () => {
    const result = await handle.db.execute<{ kind: string; price: unknown }>(
      sql`select pg_typeof(price)::text as kind, price from ${trades} limit 1`,
    )
    const row = result.rows[0]

    expect(row?.kind).toBe('numeric')
    // A number here would mean pg was coercing numeric, and prices would drift.
    expect(typeof row?.price).toBe('string')
    expect(row?.price).toMatch(/^\d+\.\d{6}$/)
  })

  it('returns event seq as a number through drizzle, not the string pg sends for int8', async () => {
    const rows = await handle.db
      .select({ seq: tradeEvents.seq })
      .from(tradeEvents)
      .orderBy(tradeEvents.seq)
      .limit(12)

    for (const row of rows) {
      expect(typeof row.seq).toBe('number')
    }
    // Crosses the digit boundary where a string cursor compares '10' < '9'.
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('does not seed a second time', async () => {
    expect(await seedIfEmpty(handle)).toBeNull()
  })
})

describe('the seeded dataset over the API', () => {
  it('satisfies the shared trade contract for all 500 rows', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/trades' })
    const body = response.json()

    expect(body.seq).toBe(615)
    expect(body.trades).toHaveLength(500)
    // Parsed, not spot-checked: one bad row fails here.
    for (const row of body.trades) {
      trade.parse(row)
    }
  })

  it('exposes positions that satisfy the shared contract', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/positions' })
    const { positions } = response.json()

    expect(positions.length).toBeGreaterThan(0)
    for (const row of positions) {
      position.parse(row)
    }
  })

  it('counts only active trades in positions', async () => {
    const [active] = await handle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(trades)
      .where(sql`status = 'ACTIVE'`)

    const response = await app.inject({ method: 'GET', url: '/api/positions' })
    const { positions } = response.json()
    const counted = positions.reduce(
      (total: number, row: { tradeCount: number }) => total + row.tradeCount,
      0,
    )

    expect(counted).toBe(active?.count)
  })
})
