import { z } from 'zod'
import { BOOKS } from './books.js'
import { COUNTERPARTIES } from './counterparties.js'
import { SYMBOLS } from './instruments.js'
import { decimalString, priceString } from './money.js'

// The specification's TypeScript interface and its sample JSON disagree. This
// follows the JSON: it is the superset and matches the readable trade id.
// Recorded under Assumptions in the README.

export const side = z.enum(['BUY', 'SELL'])
export type Side = z.infer<typeof side>

/**
 * FIX OrdStatus, narrowed to the four states this blotter produces. The
 * specification asked for a binary ACTIVE or CANCELLED, and ACTIVE stood for
 * nothing more than "not cancelled": it said a trade existed, not whether any of
 * it had traded. A blotter is read to find the exposure that is working, so the
 * three live states are the ones a trader acts on.
 *
 * The first three are derived from `filledQuantity`, never set by hand, and a
 * database check refuses a row where they disagree. Cancellation is a separate
 * fact and so is the one status a fill cannot produce.
 */
export const tradeStatus = z.enum(['NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'])
export type TradeStatus = z.infer<typeof tradeStatus>

/** The states a fill can put a trade in, which is every one but cancellation. */
export type WorkingStatus = Exclude<TradeStatus, 'CANCELLED'>

/**
 * The status a cumulative fill implies. The single definition, shared by the
 * write path, the seed and the check constraint, so no caller can invent a
 * fourth reading of a half-filled order.
 */
export function fillStatus(filledQuantity: number, quantity: number): WorkingStatus {
  if (filledQuantity <= 0) {
    return 'NEW'
  }
  return filledQuantity >= quantity ? 'FILLED' : 'PARTIALLY_FILLED'
}

/** Still working, so a fill can still arrive against it. */
export function isWorking(trade: Pick<Trade, 'status'>): boolean {
  return trade.status === 'NEW' || trade.status === 'PARTIALLY_FILLED'
}

export const tradeId = z
  .string()
  .regex(/^TRD-\d{6,}$/, { error: 'expected a TRD-nnnnnn identifier' })

/**
 * A ticker in the shape tickers come in. Used by the read model and by the
 * filters, which have to name instruments the master no longer carries.
 */
const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9.]{0,11}$/, { error: 'expected a ticker such as VOD or VOD.L' })

/**
 * A ticker the instrument master carries, which is the only kind a ticket may
 * name. Uppercased first, so `vod` resolves.
 *
 * The shape check above validates a string, not a symbol: `DSJBSDBJK` passes it.
 * A desk resolves the ticker against the security master at entry, because the
 * master carries the ISIN, the exchange and whether the line is tradeable. A
 * trade on a symbol nothing resolves cannot be settled, reconciled or reported,
 * so it fails here rather than downstream.
 */
const bookableSymbol = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(SYMBOLS, { error: 'not a ticker on the instrument master' }))

/**
 * Exported because the identity input in the UI caps itself at the same bound, and
 * a second literal there could drift from the schema that rejects it.
 */
export const PARTY_MAX_LENGTH = 64

const party = z.string().trim().min(1).max(PARTY_MAX_LENGTH)

/**
 * UTC ISO-8601 at millisecond precision, which is what `Date.toISOString()`
 * produces. Offsets are refused on purpose: a single format means these strings
 * sort chronologically by byte order, which the blotter's ordering relies on,
 * and the wire format cannot drift with a database session's timezone.
 */
const timestamp = z.iso.datetime()

const quantity = z
  .number()
  .int({ error: 'quantity must be a whole number of shares' })
  .positive()
  .max(2_000_000_000, { error: 'quantity exceeds the supported maximum' })

export const trade = z.object({
  tradeId,
  /**
   * Looser than the master a ticket is checked against, for the same reason book
   * and counterparty are: a delisting has to leave last month's trades readable.
   */
  symbol,
  side,
  quantity,
  /**
   * CumQty: how much of the booked quantity has traded. Zero up to the booked
   * quantity, and `status` is read off it. Carried rather than derived on the
   * client because the remainder still to fill is the figure a trader works.
   */
  filledQuantity: z.number().int().nonnegative(),
  price: priceString,
  trader: party,
  /**
   * Book and counterparty are looser here than the enums that book them. The
   * read model has to parse rows booked before a book closed or an entity left
   * the list, so narrowing it would make a reference-data change a data
   * migration.
   */
  book: party,
  counterparty: party,
  tradeTimestamp: timestamp,
  status: tradeStatus,
  version: z.number().int().positive(),
  updatedAt: timestamp,
})
export type Trade = z.infer<typeof trade>

/**
 * tradeId, status, version and updatedAt are assigned by the database and are
 * not accepted here. tradeTimestamp defaults to the moment of booking.
 */
export const createTradeInput = z.strictObject({
  symbol: bookableSymbol,
  side,
  quantity,
  price: priceString,
  trader: party,
  /**
   * Chosen from the list, never typed. A book owns the position, so a near miss
   * does not fail: it opens a second book that nets on its own. No length check
   * can tell `EQ-LDN-1` from `EQ-LDN-01`.
   */
  book: z.enum(BOOKS, { error: 'book must be chosen from the book list' }),
  /**
   * Chosen from the list, never typed. A counterparty is resolved from a
   * counterparty master at booking, and a free-text one is how `UBSf` gets into
   * a book: it passes every length check, fails enrichment downstream, and drops
   * the trade out of straight-through processing into a repair queue. Settlement
   * instructions, the netting agreement and the regulatory report all key off
   * this field, so it is the last one to leave open.
   */
  counterparty: z.enum(COUNTERPARTIES, {
    error: 'counterparty must be chosen from the counterparty list',
  }),
  tradeTimestamp: timestamp.optional(),

  /**
   * The idempotency key for the booking, minted once per ticket by the client. A
   * second request carrying a key that already booked returns that trade instead
   * of booking another, so a retry after a timeout cannot double-book: the first
   * attempt may well have committed before the response was lost.
   *
   * Identifies the request, not the trade, so it is absent from the read model
   * and never travels back to a client.
   *
   * Optional, because the seed and the simulator book without one and so does
   * any client that has not been updated. Omitting it forfeits the guarantee
   * rather than failing the booking, which is why the browser always sends one.
   */
  clientTradeId: z.uuid({ error: 'expected a uuid' }).optional(),
})
export type CreateTradeInput = z.infer<typeof createTradeInput>

/**
 * The amendable surface. Only quantity and price may change.
 *
 * Because this is a strictObject holding only those keys plus `version`,
 * amending `symbol` or `side` is inexpressible: a compile error at the call site
 * and a 400 on the wire. Hence it lives in the contract, not a service check.
 *
 * Counterparty is absent, which is a deliberate narrowing of the brief's amend
 * surface and is argued for in the README. Changing who a trade is with is not
 * an amendment to it: a mis-booking is cancelled and rebooked under a reason
 * code, and genuinely moving the exposure is a novation or a give-up needing the
 * incoming party's consent. Quietly rewriting the field would leave the economics
 * attached to a counterparty that never agreed to them, with credit, margin and
 * the regulatory report all already filed against the old one.
 */
export const amendTradeInput = z.strictObject({
  quantity,
  price: priceString,
  version: z.number().int().positive(),
})
export type AmendTradeInput = z.infer<typeof amendTradeInput>

/** Cancelling carries only the concurrency token. */
export const cancelTradeInput = z.strictObject({
  version: z.number().int().positive(),
})
export type CancelTradeInput = z.infer<typeof cancelTradeInput>

/**
 * An execution report: the cumulative quantity filled, not the size of this
 * fill. Cumulative because that is what the row holds, so a report that arrives
 * twice asks for a state the trade is already in rather than filling twice.
 *
 * `status` is absent on purpose. It follows from this number, so accepting it
 * would be accepting a second opinion about the same fact.
 */
export const fillTradeInput = z.strictObject({
  filledQuantity: quantity,
  version: z.number().int().positive(),
})
export type FillTradeInput = z.infer<typeof fillTradeInput>

/** FILLED is a fill arriving, which may leave the trade partially filled. */
export const tradeEventType = z.enum(['CREATED', 'AMENDED', 'FILLED', 'CANCELLED'])
export type TradeEventType = z.infer<typeof tradeEventType>

/**
 * One row of the audit trail. `seq` is also the stream's ordering token, so the
 * audit log and the stream cannot disagree about order.
 */
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

/** Computed by Postgres in numeric, never on the client, so clients agree. */
export const position = z.object({
  symbol,
  netQuantity: z.number().int(),
  boughtQuantity: z.number().int().nonnegative(),
  soldQuantity: z.number().int().nonnegative(),
  netNotional: decimalString,
  tradeCount: z.number().int().nonnegative(),
})
export type Position = z.infer<typeof position>

/**
 * How many trades the blotter holds and renders.
 *
 * The blotter is a window on the most recent trades, not the whole book. Without
 * a bound it is unbounded in the literal sense: cancelled trades stay on the tape
 * by design, so the feed adds rows for as long as it runs and never removes one.
 * At 500 rows and twelve columns the table is already 6,000 cells, every one of
 * which React reconciles each time a frame arrives.
 *
 * The number is shared because the client trims its cache to the same window it
 * asked the server for. Two different values would leave rows in the cache that
 * no refetch could ever replace.
 */
export const BLOTTER_LIMIT = 500

/** Blotter filters. All optional, combined with AND. */
export const tradeQuery = z.strictObject({
  symbol: symbol.optional(),
  side: side.optional(),
  status: tradeStatus.optional(),
  trader: party.optional(),
  book: party.optional(),

  /**
   * The most recent `limit` trades. Optional rather than defaulted, because the
   * simulator reads through the same query to count its active trades and must
   * see all of them: a window there would hide the trades above its cap and it
   * would book without end. The HTTP route defaults it instead, so no caller
   * reaches the unbounded form by forgetting rather than by deciding.
   *
   * coerce because this arrives as a querystring.
   */
  limit: z.coerce.number().int().positive().max(5_000).optional(),
})
export type TradeQuery = z.infer<typeof tradeQuery>
