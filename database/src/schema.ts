import type { Trade } from '@tapedeck/shared'
import { sql } from 'drizzle-orm'
import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

/**
 * Stored exactly as the wire carries it: UTC, millisecond precision, mapped to a
 * Date so the projection can emit canonical ISO.
 *
 * mode: 'string' would hand back Postgres's own literal, whose offset follows the
 * server's timezone setting, so the API's timestamp format would depend on a
 * database session variable. precision: 3 matches the contract, so the value the
 * database orders by is the value the client sorts by.
 */
const WIRE_TIME = { withTimezone: true, precision: 3, mode: 'date' } as const

export const sideEnum = pgEnum('trade_side', ['BUY', 'SELL'])
export const statusEnum = pgEnum('trade_status', ['ACTIVE', 'CANCELLED'])
export const eventTypeEnum = pgEnum('trade_event_type', ['CREATED', 'AMENDED', 'CANCELLED'])

/**
 * Current state, one row per trade.
 *
 * price is numeric(18, 6) and pg returns numeric as a string, so the value
 * crosses the wire exactly as stored. No type parser may be registered for the
 * numeric OID. Six decimal places rather than the usual four for cash equities,
 * so a per-unit price derived from a block value needs no rounding.
 *
 * version is the concurrency token, and by construction equals the trade's event
 * count, since every mutation writes one event and bumps it in one transaction.
 */
export const trades = pgTable(
  'trades',
  {
    // TRD-100001 upwards, from a sequence. Declaring the default here as well as
    // in the migration is what makes tradeId optional on insert, so no caller
    // can invent an id. The migration hoists the CREATE SEQUENCE above this
    // table, since a default cannot reference a sequence that does not exist.
    tradeId: text('trade_id')
      .primaryKey()
      .default(sql`'TRD-' || lpad(nextval('trade_id_seq')::text, 6, '0')`),
    symbol: text('symbol').notNull(),
    side: sideEnum('side').notNull(),
    quantity: integer('quantity').notNull(),
    price: numeric('price', { precision: 18, scale: 6 }).notNull(),
    trader: text('trader').notNull(),
    book: text('book').notNull(),
    counterparty: text('counterparty').notNull(),
    tradeTimestamp: timestamp('trade_timestamp', WIRE_TIME).notNull(),
    status: statusEnum('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', WIRE_TIME).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', WIRE_TIME).notNull().defaultNow(),
  },
  (t) => [
    index('trades_symbol_idx').on(t.symbol),
    index('trades_status_idx').on(t.status),
    index('trades_trader_idx').on(t.trader),
    index('trades_book_idx').on(t.book),
    // The blotter's default ordering. The id breaks ties so ordering is stable
    // for trades booked in the same millisecond.
    index('trades_timestamp_idx').on(t.tradeTimestamp.desc(), t.tradeId.desc()),
  ],
)

/**
 * The append-only audit trail. Never updated, never deleted.
 *
 * `seq` does three jobs: primary key of the audit trail, ordering token for the
 * realtime stream, and the seam an outbox or logical-decoding consumer would
 * attach to. Sharing one counter is why the log and the stream cannot disagree
 * about order.
 *
 * mode: 'number' is required because pg returns int8 as a string, which would
 * make `seq > cursor` lexicographic. A repository test asserts the runtime type.
 *
 * Writes serialise under an advisory lock, so these rows commit in strict seq
 * order and max(seq) is a true high-water mark.
 */
export const tradeEvents = pgTable(
  'trade_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    tradeId: text('trade_id')
      .notNull()
      .references(() => trades.tradeId),
    eventType: eventTypeEnum('event_type').notNull(),
    // The full trade as it stood before and after. `before` is null for
    // CREATED. Storing whole snapshots rather than a field-level diff keeps the
    // history readable without replaying it, which is what the history drawer
    // needs, and costs little at this volume.
    before: jsonb('before').$type<Trade | null>(),
    after: jsonb('after').$type<Trade>().notNull(),
    actor: text('actor').notNull(),
    at: timestamp('at', WIRE_TIME).notNull().defaultNow(),
  },
  (t) => [index('trade_events_trade_idx').on(t.tradeId, t.seq)],
)

/**
 * Net exposure per symbol, aggregated in numeric so every client agrees. Two
 * clients summing floats in different orders can disagree in the last place.
 *
 * Cancelled trades are excluded, not netted out: the trade did not happen.
 */
export const positionsQuery = sql`
  select
    symbol,
    sum(case when side = 'BUY' then quantity else -quantity end)::int as net_quantity,
    sum(case when side = 'BUY' then quantity else 0 end)::int as bought_quantity,
    sum(case when side = 'SELL' then quantity else 0 end)::int as sold_quantity,
    sum(case when side = 'BUY' then quantity * price else -quantity * price end)::numeric(18, 6)
      as net_notional,
    count(*)::int as trade_count
  from trades
  where status = 'ACTIVE'
  group by symbol
  order by symbol
`

export type TradeRow = typeof trades.$inferSelect
export type TradeInsert = typeof trades.$inferInsert
export type TradeEventRow = typeof tradeEvents.$inferSelect
export type TradeEventInsert = typeof tradeEvents.$inferInsert
