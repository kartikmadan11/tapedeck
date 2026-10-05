import type { Database, Queryable } from '@tapedeck/database'
import { toTrade, toTradeEvent, tradeEvents, trades } from '@tapedeck/database'
import {
  type AmendTradeInput,
  type CreateTradeInput,
  invalidState,
  notFound,
  type Position,
  type Trade,
  type TradeEvent,
  type TradeEventType,
  type TradeQuery,
  versionConflict,
} from '@tapedeck/shared'
import { and, asc, desc, eq, sql } from 'drizzle-orm'

// The advisory lock key. Arbitrary but stable across processes, and
// recognisable in pg_locks.
const WRITE_LOCK_KEY = 8_427_301

/**
 * Serialises every mutation, which is what makes max(seq) a valid high-water
 * mark.
 *
 * bigserial allocates before commit, so seq 7 can commit before seq 6. A reader
 * can then observe max(seq) = 7 while 6 is uncommitted; 6 commits, broadcasts,
 * and a reconnecting client's drain filter asks `6 > 7` and discards it, losing
 * that trade until the next reconnect. Serialising makes the sequence gap-free
 * and commit-ordered, and removes any need for SELECT ... FOR UPDATE.
 *
 * The cost is a serial write path, noted in the README as the throughput
 * ceiling. At scale it would be replaced by broker-side ordering or an outbox
 * reading this same table. The lock releases at commit or rollback.
 */
async function acquireWriteLock(tx: Queryable): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK_KEY})`)
}

/** The result of a mutation: the new state plus the seq the event was written at. */
export interface MutationResult {
  trade: Trade
  seq: number
  eventType: TradeEventType
}

/**
 * A booking either happened or had already happened.
 *
 * A union rather than a MutationResult with a `replayed` flag, because a replay
 * has no seq and no event: nothing was written, so there is no cursor to carry
 * and a flag would need a seq invented to sit beside it.
 */
export type CreateResult =
  | { replayed: false; result: MutationResult }
  | { replayed: true; trade: Trade }

export interface ConsistentSnapshot {
  seq: number
  trades: Trade[]
  positions: Position[]
}

export class TradeRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  /**
   * Reads trades, positions and the high-water seq in one repeatable-read
   * transaction. A snapshot holding trades at seq 100 and positions at seq 103
   * would show a panel that disagrees with its own blotter.
   */
  async readSnapshot(query: TradeQuery = {}): Promise<ConsistentSnapshot> {
    return this.db.transaction(
      async (tx) => {
        // Sequential, not Promise.all: a transaction is one connection, so pg
        // would queue the queries anyway and warns about the overlap.
        const seq = await readHighWaterSeq(tx)
        const tradeRows = await selectTrades(tx, query)
        const positionRows = await selectPositions(tx)
        return { seq, trades: tradeRows, positions: positionRows }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  }

  async listTrades(query: TradeQuery = {}): Promise<{ seq: number; trades: Trade[] }> {
    return this.db.transaction(
      async (tx) => {
        const seq = await readHighWaterSeq(tx)
        return { seq, trades: await selectTrades(tx, query) }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  }

  async listPositions(): Promise<{ seq: number; positions: Position[] }> {
    return this.db.transaction(
      async (tx) => {
        const seq = await readHighWaterSeq(tx)
        return { seq, positions: await selectPositions(tx) }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  }

  async findTrade(tradeId: string): Promise<Trade | null> {
    const [row] = await this.db.select().from(trades).where(eq(trades.tradeId, tradeId)).limit(1)
    return row ? toTrade(row) : null
  }

  /** The audit trail for one trade, oldest first. 404 if it does not exist. */
  async listEvents(tradeId: string): Promise<TradeEvent[]> {
    const trade = await this.findTrade(tradeId)
    if (!trade) {
      throw notFound(tradeId)
    }

    const rows = await this.db
      .select()
      .from(tradeEvents)
      .where(eq(tradeEvents.tradeId, tradeId))
      .orderBy(asc(tradeEvents.seq))

    return rows.map(toTradeEvent)
  }

  /**
   * Books a trade, or returns the one an earlier request with the same
   * clientTradeId already booked.
   *
   * The check reads rather than relying on the unique index to raise: a
   * constraint violation aborts the transaction, so answering the replay would
   * need a second one, and the lock would have to be taken again to make that
   * read consistent. Reading first is also the only way to return the earlier
   * trade, which is what the caller asked for.
   *
   * Safe against a concurrent duplicate because the write lock is already held:
   * one create runs at a time, so no insert can land between this read and the
   * insert below. Without the lock this would be a textbook check-then-act race
   * and the index would be doing the work alone.
   */
  async createTrade(input: CreateTradeInput, actor: string): Promise<CreateResult> {
    return this.db.transaction(async (tx) => {
      await acquireWriteLock(tx)

      if (input.clientTradeId !== undefined) {
        const existing = await findByClientTradeId(tx, input.clientTradeId)
        if (existing) {
          return { replayed: true, trade: existing }
        }
      }

      const [row] = await tx
        .insert(trades)
        .values({
          symbol: input.symbol,
          side: input.side,
          quantity: input.quantity,
          price: input.price,
          trader: input.trader,
          book: input.book,
          counterparty: input.counterparty,
          tradeTimestamp: new Date(input.tradeTimestamp ?? Date.now()),
          // ?? null rather than the bare value: the column is nullable and
          // exactOptionalPropertyTypes means undefined is not assignable to it.
          clientTradeId: input.clientTradeId ?? null,
        })
        .returning()

      if (!row) {
        throw new Error('insert returned no row')
      }

      const trade = toTrade(row)
      const seq = await appendEvent(tx, 'CREATED', null, trade, actor)
      return { replayed: false, result: { trade, seq, eventType: 'CREATED' } }
    })
  }

  /**
   * Amends under optimistic concurrency, diagnosing the three-way outcome inside
   * the lock rather than by interpreting a zero-row UPDATE. A follow-up read
   * after a failed UPDATE is not atomic with it under READ COMMITTED, so the
   * currentVersion it reported could already be stale.
   */
  async amendTrade(
    tradeId: string,
    input: AmendTradeInput,
    actor: string,
  ): Promise<MutationResult> {
    return this.db.transaction(async (tx) => {
      await acquireWriteLock(tx)

      const current = await requireTrade(tx, tradeId)
      if (current.status === 'CANCELLED') {
        throw invalidState(tradeId, current.status)
      }
      if (current.version !== input.version) {
        throw versionConflict(tradeId, input.version, current.version)
      }

      const [row] = await tx
        .update(trades)
        .set({
          quantity: input.quantity,
          price: input.price,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(trades.tradeId, tradeId))
        .returning()

      if (!row) {
        throw new Error('update returned no row despite holding the write lock')
      }

      const trade = toTrade(row)
      const seq = await appendEvent(tx, 'AMENDED', current, trade, actor)
      return { trade, seq, eventType: 'AMENDED' }
    })
  }

  /**
   * Cancelling a cancelled trade is an explicit INVALID_STATE, not a silent
   * success, so a user clicking a struck-through row is told why.
   */
  async cancelTrade(tradeId: string, version: number, actor: string): Promise<MutationResult> {
    return this.db.transaction(async (tx) => {
      await acquireWriteLock(tx)

      const current = await requireTrade(tx, tradeId)
      if (current.status === 'CANCELLED') {
        throw invalidState(tradeId, current.status)
      }
      if (current.version !== version) {
        throw versionConflict(tradeId, version, current.version)
      }

      const [row] = await tx
        .update(trades)
        .set({
          status: 'CANCELLED',
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(trades.tradeId, tradeId))
        .returning()

      if (!row) {
        throw new Error('update returned no row despite holding the write lock')
      }

      const trade = toTrade(row)
      const seq = await appendEvent(tx, 'CANCELLED', current, trade, actor)
      return { trade, seq, eventType: 'CANCELLED' }
    })
  }
}

/** Null rather than a throw: no earlier booking is the ordinary case here. */
async function findByClientTradeId(tx: Queryable, clientTradeId: string): Promise<Trade | null> {
  const [row] = await tx
    .select()
    .from(trades)
    .where(eq(trades.clientTradeId, clientTradeId))
    .limit(1)
  return row ? toTrade(row) : null
}

async function requireTrade(tx: Queryable, tradeId: string): Promise<Trade> {
  const [row] = await tx.select().from(trades).where(eq(trades.tradeId, tradeId)).limit(1)
  if (!row) {
    throw notFound(tradeId)
  }
  return toTrade(row)
}

/**
 * Appends one event and returns its seq, which becomes the frame's cursor.
 * Exactly one event per mutation, which is what makes version == count(events).
 */
async function appendEvent(
  tx: Queryable,
  eventType: TradeEventType,
  before: Trade | null,
  after: Trade,
  actor: string,
): Promise<number> {
  const [event] = await tx
    .insert(tradeEvents)
    .values({ tradeId: after.tradeId, eventType, before, after, actor })
    .returning({ seq: tradeEvents.seq })

  if (!event) {
    throw new Error('event insert returned no row')
  }
  return event.seq
}

/**
 * Returns 0 for an empty database, which is why a snapshot may carry cursor 0
 * and a delta may not: no event can ever be numbered 0.
 */
async function readHighWaterSeq(tx: Queryable): Promise<number> {
  const result = await tx.execute<{ seq: number }>(
    sql`select coalesce(max(seq), 0)::int as seq from ${tradeEvents}`,
  )
  return result.rows[0]?.seq ?? 0
}

function selectTrades(tx: Queryable, query: TradeQuery): Promise<Trade[]> {
  const filters = [
    query.symbol ? eq(trades.symbol, query.symbol) : undefined,
    query.side ? eq(trades.side, query.side) : undefined,
    query.status ? eq(trades.status, query.status) : undefined,
    query.trader ? eq(trades.trader, query.trader) : undefined,
    query.book ? eq(trades.book, query.book) : undefined,
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== undefined)

  const ordered = tx
    .select()
    .from(trades)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(trades.tradeTimestamp), desc(trades.tradeId))

  // trades_timestamp_idx is on (tradeTimestamp desc, tradeId desc), the same
  // order this asks for, so the limit is a truncated index scan rather than a
  // sort of the whole table that then throws most of the rows away.
  return (query.limit === undefined ? ordered : ordered.limit(query.limit)).then((rows) =>
    rows.map(toTrade),
  )
}

/**
 * Aggregated in numeric by Postgres, never summed on the client: two clients
 * adding floats in a different order can disagree in the last place.
 *
 * Cancelled trades are excluded, not netted out: the trade did not happen.
 */
async function selectPositions(tx: Queryable): Promise<Position[]> {
  const result = await tx.execute<{
    symbol: string
    net_quantity: number
    bought_quantity: number
    sold_quantity: number
    net_notional: string
    trade_count: number
  }>(sql`
    select
      symbol,
      sum(case when side = 'BUY' then quantity else -quantity end)::int as net_quantity,
      sum(case when side = 'BUY' then quantity else 0 end)::int as bought_quantity,
      sum(case when side = 'SELL' then quantity else 0 end)::int as sold_quantity,
      sum(case when side = 'BUY' then quantity * price else -quantity * price end)::numeric(18, 6)
        as net_notional,
      count(*)::int as trade_count
    from ${trades}
    where status = 'ACTIVE'
    group by symbol
    order by symbol
  `)

  return result.rows.map((row) => ({
    symbol: row.symbol,
    netQuantity: row.net_quantity,
    boughtQuantity: row.bought_quantity,
    soldQuantity: row.sold_quantity,
    netNotional: row.net_notional as Position['netNotional'],
    tradeCount: row.trade_count,
  }))
}
