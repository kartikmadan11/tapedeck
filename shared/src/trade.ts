import { z } from 'zod'
import { decimalString, priceString } from './money.js'

// The specification's TypeScript interface and its sample JSON disagree. This
// follows the JSON: it is the superset and matches the readable trade id.
// Recorded under Assumptions in the README.

export const side = z.enum(['BUY', 'SELL'])
export type Side = z.infer<typeof side>

/** Binary, as specified. An amendment bumps `version` and appends an event. */
export const tradeStatus = z.enum(['ACTIVE', 'CANCELLED'])
export type TradeStatus = z.infer<typeof tradeStatus>

export const tradeId = z
  .string()
  .regex(/^TRD-\d{6,}$/, { error: 'expected a TRD-nnnnnn identifier' })

const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9.]{0,11}$/, { error: 'expected a ticker such as VOD or VOD.L' })

const party = z.string().trim().min(1).max(64)

const quantity = z
  .number()
  .int({ error: 'quantity must be a whole number of shares' })
  .positive()
  .max(2_000_000_000, { error: 'quantity exceeds the supported maximum' })

export const trade = z.object({
  tradeId,
  symbol,
  side,
  quantity,
  price: priceString,
  trader: party,
  book: party,
  counterparty: party,
  tradeTimestamp: z.string(),
  status: tradeStatus,
  version: z.number().int().positive(),
  updatedAt: z.string(),
})
export type Trade = z.infer<typeof trade>

/**
 * tradeId, status, version and updatedAt are assigned by the database and are
 * not accepted here. tradeTimestamp defaults to the moment of booking.
 */
export const createTradeInput = z.strictObject({
  symbol,
  side,
  quantity,
  price: priceString,
  trader: party,
  book: party,
  counterparty: party,
  tradeTimestamp: z.string().optional(),
})
export type CreateTradeInput = z.infer<typeof createTradeInput>

/**
 * The amendable surface. Only quantity, price and counterparty may change.
 *
 * Because this is a strictObject holding only those keys plus `version`,
 * amending `symbol` or `side` is inexpressible: a compile error at the call site
 * and a 400 on the wire. Hence it lives in the contract, not a service check.
 */
export const amendTradeInput = z.strictObject({
  quantity,
  price: priceString,
  counterparty: party,
  version: z.number().int().positive(),
})
export type AmendTradeInput = z.infer<typeof amendTradeInput>

/** Cancelling carries only the concurrency token. */
export const cancelTradeInput = z.strictObject({
  version: z.number().int().positive(),
})
export type CancelTradeInput = z.infer<typeof cancelTradeInput>

export const tradeEventType = z.enum(['CREATED', 'AMENDED', 'CANCELLED'])
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
  at: z.string(),
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

/** Blotter filters. All optional, combined with AND. */
export const tradeQuery = z.strictObject({
  symbol: symbol.optional(),
  side: side.optional(),
  status: tradeStatus.optional(),
  trader: party.optional(),
  book: party.optional(),
})
export type TradeQuery = z.infer<typeof tradeQuery>
