import type { Trade, TradeEvent } from '@tapedeck/shared'
import type { TradeEventRow, TradeRow } from './schema.js'

/**
 * The one place a row becomes a wire object, used by both the API and the seed, so
 * timestamp formats cannot diverge. Price stays the string pg returned: parsing it
 * here is the whole precision loss the numeric column exists to avoid.
 */
export function toTrade(row: TradeRow): Trade {
  return {
    tradeId: row.tradeId,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    filledQuantity: row.filledQuantity,
    price: row.price as Trade['price'],
    trader: row.trader,
    book: row.book,
    counterparty: row.counterparty,
    tradeTimestamp: row.tradeTimestamp.toISOString(),
    status: row.status,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toTradeEvent(row: TradeEventRow): TradeEvent {
  return {
    seq: row.seq,
    tradeId: row.tradeId,
    eventType: row.eventType,
    before: row.before,
    after: row.after,
    actor: row.actor,
    at: row.at.toISOString(),
  }
}
