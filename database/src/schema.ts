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

/** Stored as the wire carries it: UTC, millisecond precision, mapped to a Date so the
 * projection can emit canonical ISO. mode: 'string' would hand back Postgres's own
 * literal, whose offset follows the server's timezone. precision: 3 matches the contract. */
const WIRE_TIME = { withTimezone: true, precision: 3, mode: 'date' } as const

export const sideEnum = pgEnum('trade_side', ['BUY', 'SELL'])
export const statusEnum = pgEnum('trade_status', ['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'])
export const eventTypeEnum = pgEnum('trade_event_type', [
  'CREATED',
  'AMENDED',
  'FILLED',
  'CANCELLED',
])

/** Current state, one row per trade. pg returns numeric as a string, so price crosses
 * the wire exactly as stored: no type parser may be registered for the numeric OID.
 * Six decimals, so a per-unit price from a block value needs no rounding. version is
 * the concurrency token and equals the event count, one event per mutation. */
export const trades = pgTable(
  'trades',
  {
    // TRD-100001 upwards. Declared here too, which is what makes tradeId optional on
    // insert; the migration hoists CREATE SEQUENCE above this table.
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
    // The client's idempotency key, null when none is sent. Nullable rather than
    // defaulted: a server-generated key is unique per request and dedupes nothing.
    clientTradeId: text('client_trade_id'),
    // CumQty. A booking is an order, so the executions arrive afterwards.
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
    // The blotter's default ordering, with the id breaking ties within a millisecond.
    index('trades_timestamp_idx').on(t.tradeTimestamp.desc(), t.tradeId.desc()),
    /** Backstop for writers that bypass the repository's replay check. Postgres treats
     * nulls as distinct here, so keyless trades never collide; hence no NULLS NOT DISTINCT. */
    uniqueIndex('trades_client_trade_id_key').on(t.clientTradeId),
    /** The three live statuses are a reading of filled_quantity, so no path, including a
     * hand-run UPDATE, can claim FILLED on a half fill. Cancellation asserts nothing. */
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

/** Append-only: never updated, never deleted. `seq` is both the primary key and the
 * stream's ordering token, so log and stream cannot disagree about order. mode: 'number'
 * is required because pg returns int8 as a string, which would make `seq > cursor`
 * lexicographic. Writes serialise under an advisory lock, so max(seq) is a high-water mark. */
export const tradeEvents = pgTable(
  'trade_events',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    tradeId: text('trade_id')
      .notNull()
      .references(() => trades.tradeId),
    eventType: eventTypeEnum('event_type').notNull(),
    // Whole snapshots, not a field-level diff, so history reads without replaying
    // it. `before` is null for CREATED.
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
