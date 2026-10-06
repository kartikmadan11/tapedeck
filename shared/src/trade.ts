import { z } from 'zod'
import { BOOKS } from './books.js'
import { COUNTERPARTIES } from './counterparties.js'
import { SYMBOLS } from './instruments.js'
import { priceString, summedDecimalString } from './money.js'

// The spec's TypeScript interface and its sample JSON disagree. This follows the
// JSON, the superset. Recorded under Assumptions in the README.

export const side = z.enum(['BUY', 'SELL'])
export type Side = z.infer<typeof side>

/** FIX OrdStatus, where the spec asked only for ACTIVE or CANCELLED. The first three
 * are derived from `filledQuantity` and a check constraint rejects a row where they
 * disagree, so only CANCELLED is independently settable. */
export const tradeStatus = z.enum(['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'])
export type TradeStatus = z.infer<typeof tradeStatus>

export type WorkingStatus = Exclude<TradeStatus, 'CANCELLED'>

/** The status a cumulative fill implies, shared by the write path, the seed and the
 * check constraint. */
export function fillStatus(filledQuantity: number, quantity: number): WorkingStatus {
  if (filledQuantity <= 0) {
    return 'NEW'
  }
  return filledQuantity >= quantity ? 'FILLED' : 'PARTIALLY_FILLED'
}

/** Still working, so a fill can arrive against it. */
export function isWorking(trade: Pick<Trade, 'status'>): boolean {
  return trade.status === 'NEW' || trade.status === 'PARTIALLY_FILLED'
}

export const tradeId = z
  .string()
  .regex(/^TRD-\d{6,}$/, { error: 'expected a TRD-nnnnnn identifier' })

/** Shape only, not membership: the read model and the filters have to name
 * instruments the master no longer carries. */
const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9.]{0,11}$/, { error: 'expected a ticker such as VOD or VOD.L' })

/** The only tickers a ticket may name. The shape check above would pass `DSJBSDBJK`,
 * and an unresolvable symbol cannot be settled or reported. Uppercased first, so
 * `vod` resolves. */
const bookableSymbol = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(SYMBOLS, { error: 'not a ticker on the instrument master' }))

/** Exported so the UI's identity input caps at the same bound, with no second
 * literal to drift from the schema that rejects it. */
export const PARTY_MAX_LENGTH = 64

const party = z.string().trim().min(1).max(PARTY_MAX_LENGTH)

/** UTC ISO-8601 at millisecond precision. Offsets are refused so these strings sort
 * chronologically by byte order, which the blotter relies on, and cannot drift with
 * a database session's timezone. */
const timestamp = z.iso.datetime()

const quantity = z
  .number()
  .int({ error: 'quantity must be a whole number of shares' })
  .positive()
  .max(2_000_000_000, { error: 'quantity exceeds the supported maximum' })

export const trade = z.object({
  tradeId,
  /** Looser than a ticket's master check: a delisting must leave old trades readable. */
  symbol,
  side,
  quantity,
  /** CumQty, and what `status` is read off. Carried rather than derived because the
   * remainder still to fill is the figure a trader works. */
  filledQuantity: z.number().int().nonnegative(),
  price: priceString,
  trader: party,
  /** Looser than the enums that book them: the read model parses rows booked before a
   * book closed, so narrowing would make reference data a migration. */
  book: party,
  counterparty: party,
  tradeTimestamp: timestamp,
  status: tradeStatus,
  version: z.number().int().positive(),
  updatedAt: timestamp,
})
export type Trade = z.infer<typeof trade>

/** tradeId, status, version and updatedAt are database-assigned, so they are not
 * accepted here. tradeTimestamp defaults to the moment of booking. */
export const createTradeInput = z.strictObject({
  symbol: bookableSymbol,
  side,
  quantity,
  price: priceString,
  trader: party,
  /** From the list, never typed: a near miss opens a second book that nets on its own,
   * and no length check tells `EQ-LDN-1` from `EQ-LDN-01`. */
  book: z.enum(BOOKS, { error: 'book must be chosen from the book list' }),
  /** From the list, never typed. Free text passes every length check, then fails
   * enrichment into a repair queue. Settlement, netting and the report key off it. */
  counterparty: z.enum(COUNTERPARTIES, {
    error: 'counterparty must be chosen from the counterparty list',
  }),
  tradeTimestamp: timestamp.optional(),

  /** Idempotency key for the booking. A second request carrying a key that already
   * booked returns that trade, so a retry after a timeout cannot double-book. It
   * identifies the request, not the trade, so it is absent from the read model.
   * Optional: the seed and the simulator book without one and forfeit the guarantee. */
  clientTradeId: z.uuid({ error: 'expected a uuid' }).optional(),
})
export type CreateTradeInput = z.infer<typeof createTradeInput>

/** Only quantity and price. A strictObject of just those keys and `version` makes
 * amending `symbol` or `side` a compile error at the call site and a 400 on the wire,
 * not a service check. Counterparty is absent, a narrowing argued in the README: a
 * mis-booking is cancelled and rebooked, and moving exposure is a novation. */
export const amendTradeInput = z.strictObject({
  quantity,
  price: priceString,
  version: z.number().int().positive(),
})
export type AmendTradeInput = z.infer<typeof amendTradeInput>

export const cancelTradeInput = z.strictObject({
  version: z.number().int().positive(),
})
export type CancelTradeInput = z.infer<typeof cancelTradeInput>

/** An execution report carrying cumulative quantity filled, not the size of this
 * fill, so a report that arrives twice asks for a state the trade is already in.
 * `status` follows from the number and is not accepted here. */
export const fillTradeInput = z.strictObject({
  filledQuantity: quantity,
  version: z.number().int().positive(),
})
export type FillTradeInput = z.infer<typeof fillTradeInput>

/** FILLED is a fill arriving; the trade may still end up partially filled. */
export const tradeEventType = z.enum(['CREATED', 'AMENDED', 'FILLED', 'CANCELLED'])
export type TradeEventType = z.infer<typeof tradeEventType>

/** One row of the audit trail. `seq` is also the stream's ordering token, so log
 * and stream cannot disagree about order. */
export const tradeEvent = z.object({
  seq: z.number().int().positive(),
  tradeId,
  eventType: tradeEventType,
  before: trade.nullable(),
  after: trade,
  actor: party,
  at: timestamp,
})
export type TradeEvent = z.infer<typeof tradeEvent>

/** Computed by Postgres in numeric, never on the client, so clients agree. Every
 * field here is a sum, so none of them carries a single trade's bounds: a quantity
 * is capped but a sum of quantities is not. */
export const position = z.object({
  symbol,
  netQuantity: z.number().int(),
  boughtQuantity: z.number().int().nonnegative(),
  soldQuantity: z.number().int().nonnegative(),
  netNotional: summedDecimalString,
  tradeCount: z.number().int().nonnegative(),
})
export type Position = z.infer<typeof position>

/**
 * The newest trades the blotter holds. Cancelled trades stay on the tape, so
 * without a bound the feed grows without end.
 *
 * Shared because the client trims its cache to the window it asked the server
 * for. Two values would strand rows no refetch could replace.
 */
export const BLOTTER_LIMIT = 500

/** Blotter filters. All optional, combined with AND. */
export const tradeQuery = z.strictObject({
  symbol: symbol.optional(),
  side: side.optional(),
  status: tradeStatus.optional(),
  trader: party.optional(),
  book: party.optional(),

  /** Optional rather than defaulted: the simulator counts active trades through this
   * query and must see all of them, or it would book past its cap without end. The
   * HTTP route supplies the default. coerce, for the querystring. */
  limit: z.coerce.number().int().positive().max(5_000).optional(),
})
export type TradeQuery = z.infer<typeof tradeQuery>
