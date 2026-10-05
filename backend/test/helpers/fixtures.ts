import type { DatabaseHandle } from '@tapedeck/database'
import { tradeEvents, trades } from '@tapedeck/database'
import type { Trade } from '@tapedeck/shared'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'

/**
 * Bodies are built as plain records, not CreateTradeInput, so a test can post a
 * deliberately invalid field and still compile.
 */
export function newTradeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: 'VOD',
    side: 'BUY',
    quantity: 10_000,
    price: '72.465000',
    trader: 'k.madan',
    book: 'EQ-LDN-1',
    counterparty: 'HSBC',
    tradeTimestamp: '2026-10-02T09:15:00.000Z',
    ...overrides,
  }
}

/** Books a trade over the real route and returns it. Fails loudly on non-201. */
export async function createTrade(
  app: FastifyInstance,
  overrides: Record<string, unknown> = {},
): Promise<Trade> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/trades',
    payload: newTradeBody(overrides),
  })

  if (response.statusCode !== 201) {
    throw new Error(
      `expected 201 from POST /api/trades, got ${response.statusCode}: ${response.body}`,
    )
  }
  return response.json()
}

/**
 * Puts `count` trades in the table in one statement, for the tests that need more
 * rows than the blotter window rather than more rows of a particular shape.
 *
 * Written straight to the table rather than over the route, because 500 posts are
 * 500 serialised transactions and this is one insert. The cost is that it writes
 * no audit events, so a test using it must not assert on `seq`.
 *
 * Timestamps descend by the minute from the base, so the rows have a definite
 * order and a windowed read has a right answer to get wrong.
 */
export async function fillTrades(handle: DatabaseHandle, count: number): Promise<void> {
  const base = Date.UTC(2026, 9, 2, 9, 0, 0)
  await handle.db.insert(trades).values(
    Array.from({ length: count }, (_unused, index) => ({
      symbol: 'VOD',
      side: 'BUY' as const,
      quantity: 10_000,
      price: '72.465000',
      trader: 'k.madan',
      book: 'EQ-LDN-1',
      counterparty: 'HSBC',
      tradeTimestamp: new Date(base - index * 60_000),
    })),
  )
}

export async function maxSeq(handle: DatabaseHandle): Promise<number> {
  const result = await handle.db.execute<{ seq: number }>(
    sql`select coalesce(max(seq), 0)::int as seq from ${tradeEvents}`,
  )
  return result.rows[0]?.seq ?? 0
}
