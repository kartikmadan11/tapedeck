import type { Trade } from '@tapedeck/shared'
import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Stored exactly as the wire carries it: UTC, millisecond precision, mapped to a
 * Date so the projection can emit canonical ISO.
 *
 * mode: 'string' would hand back Postgres's own literal, whose offset follows the
 * server's timezone setting. precision: 3 matches the contract, so the value the
 * database orders by is the value the client sorts by.
 */
const WIRE_TIME = { withTimezone: true, precision: 3, mode: 'date' } as const

export const sideEnum = pgEnum('trade_side', ['BUY', 'SELL'])
export const statusEnum = pgEnum('trade_status', ['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'])
export const eventTypeEnum = pgEnum('trade_event_type', [
  'CREATED',
  'AMENDED',
  'FILLED',
  'CANCELLED',
])

/**
 * Current state, one row per trade.
 *
 * price is numeric(18, 6) and pg returns numeric as a string, so the value
 * crosses the wire exactly as stored. No type parser may be registered for the
 * numeric OID. Six decimal places, so a per-unit price derived from a block
 * value needs no rounding.
 *
 * version is the concurrency token, and by construction equals the trade's event
 * count, since every mutation writes one event and bumps it in one transaction.
 */
export const trades = pgTable(
  'trades',
  {
    // TRD-100001 upwards, from a sequence. The default is declared here as well
    // as in the migration, which is what makes tradeId optional on insert. The
    // migration hoists the CREATE SEQUENCE above this table, since a default
    // cannot reference a sequence that does not exist.
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
    // The client's idempotency key for the booking, null when none is sent.
    // Nullable rather than defaulted: a server-generated key would be unique per
    // request and dedupe nothing.
    clientTradeId: text('client_trade_id'),
    // CumQty. A booking is an order, so it starts at nothing filled and the
    // executions arrive afterwards.
    filledQuantity: integer('filled_quantity').notNull().default(0),
    status: statusEnum('status').notNull().default('NEW'),
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
    /**
     * The backstop that makes a booking idempotent for writers that bypass the
     * repository's replay check under the write lock.
     *
     * Postgres treats nulls as distinct here, so trades booked without a key do
     * not collide with each other. That default is the behaviour wanted, which
     * is why there is no NULLS NOT DISTINCT.
     */
    uniqueIndex('trades_client_trade_id_key').on(t.clientTradeId),
    /**
     * The three live statuses are a reading of filled_quantity, so this is what
     * stops them being set independently: a row claiming FILLED on a quantity
     * half filled cannot be written by any path, including a hand-run UPDATE.
     *
     * Cancellation is a separate fact, so a cancelled trade keeps whatever had
     * filled before it was struck. Nothing is asserted about its fill.
     */
    check(
      'trades_status_matches_fill',
      sql`
        filled_quantity between 0 and quantity
        and case status
          when 'NEW' then filled_quantity = 0
          when 'PARTIALLY_FILLED' then filled_quantity > 0 and filled_quantity < quantity
          when 'FILLED' then filled_quantity = quantity
          else true
        end
      `,
    ),
  ],
)

/**
 * The append-only audit trail. Never updated, never deleted.
 *
 * `seq` is both the primary key and the realtime stream's ordering token. One
 * counter is why the log and the stream cannot disagree about order.
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
    // CREATED. Whole snapshots, not a field-level diff, so the history reads
    // without replaying it.
    before: jsonb('before').$type<Trade | null>(),
    after: jsonb('after').$type<Trade>().notNull(),
    actor: text('actor').notNull(),
    at: timestamp('at', WIRE_TIME).notNull().defaultNow(),
  },
  (t) => [index('trade_events_trade_idx').on(t.tradeId, t.seq)],
)

export type TradeRow = typeof trades.$inferSelect
export type TradeInsert = typeof trades.$inferInsert
export type TradeEventRow = typeof tradeEvents.$inferSelect
export type TradeEventInsert = typeof tradeEvents.$inferInsert
