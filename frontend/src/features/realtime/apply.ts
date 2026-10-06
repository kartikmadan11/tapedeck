import type {
  BlotterState,
  PositionsResponse,
  ServerFrame,
  Trade,
  TradeDeltaFrame,
  TradesResponse,
} from '@tapedeck/shared'
import { BLOTTER_LIMIT } from '@tapedeck/shared'

export const emptyBlotter: BlotterState = { seq: 0, trades: [], positions: [] }

/**
 * Newest first, which is the server's ORDER BY. Keeping the same ordering means a
 * refetch never reshuffles rows the stream placed.
 *
 * Timestamps are UTC ISO at one precision, so comparing the strings is comparing
 * the instants, with no Date parsing in a sort comparator.
 */
function byRecency(a: Trade, b: Trade): number {
  if (a.tradeTimestamp !== b.tradeTimestamp) {
    return a.tradeTimestamp < b.tradeTimestamp ? 1 : -1
  }
  return a.tradeId < b.tradeId ? 1 : -1
}

/**
 * The most recent BLOTTER_LIMIT trades, which is the window the server was asked
 * for and so the window the cache holds.
 *
 * Trimmed on the way in rather than at render time. Without it the bounded first
 * load drifts back to unbounded: cancelled trades stay on the tape and nothing
 * ever leaves the array.
 *
 * Safe to cut from the end because the array is sorted newest first, so what
 * falls off is the oldest trade held.
 */
function windowed(trades: Trade[]): Trade[] {
  return trades.length > BLOTTER_LIMIT ? trades.slice(0, BLOTTER_LIMIT) : trades
}

/**
 * An amendment cannot change tradeTimestamp or tradeId, so a replacement keeps
 * its slot. A trade not held yet is inserted in order rather than appended,
 * because appending would leave the array unsorted until the next refetch.
 */
function upsert(trades: Trade[], incoming: Trade): Trade[] {
  const existing = trades.findIndex((trade) => trade.tradeId === incoming.tradeId)
  if (existing !== -1) {
    const next = trades.slice()
    next[existing] = incoming
    return next
  }

  const at = trades.findIndex((trade) => byRecency(incoming, trade) < 0)
  const next = trades.slice()
  next.splice(at === -1 ? trades.length : at, 0, incoming)
  // Only the insert path can grow the array. A replacement is one for one, so
  // trimming there would cut a row on an amendment of an already full window.
  return windowed(next)
}

/**
 * The only writer of blotter state, pure and socket-free, so every delivery
 * order a real connection can produce is reachable from a test.
 *
 * Every branch refuses a payload older than the cursor already held. Without
 * that, a refetch landing after a frame it does not contain silently reverts the
 * frame, which is the lost update the cursor exists to prevent.
 */
export function apply(state: BlotterState, frame: ServerFrame): BlotterState {
  switch (frame.type) {
    case 'snapshot':
      if (frame.seq < state.seq) {
        return state
      }
      return {
        seq: frame.seq,
        // Windowed as well as sorted, even though the handshake snapshot is
        // already windowed server-side, so the invariant belongs here rather
        // than to an agreement between two files.
        trades: windowed(frame.trades.slice().sort(byRecency)),
        positions: frame.positions,
      }

    case 'trade.created':
    case 'trade.amended':
    case 'trade.filled':
    case 'trade.cancelled':
      // Not <: a frame at the current cursor is one already applied.
      if (frame.seq <= state.seq) {
        return state
      }
      return {
        seq: frame.seq,
        trades: upsert(state.trades, frame.trade),
        positions: state.positions,
      }

    case 'positions':
      // Derived state with no cursor, so there is nothing to order it against
      // and the latest one wins. It must not advance seq: doing so would make the
      // client discard trade frames it has not applied.
      return { ...state, positions: frame.positions }

    case 'simulation':
      // Whether the feed is running is not blotter state. It is routed to its own
      // cache entry before this point; the case exists so the union stays
      // exhaustive, and returning state unchanged keeps the cursor untouched.
      return state

    default: {
      // Adding a frame type without deciding how it writes fails to compile here.
      const unreachable: never = frame
      return unreachable
    }
  }
}

/** Narrows to the frames that carry the stream cursor forward. */
export function isTradeDelta(frame: ServerFrame): frame is TradeDeltaFrame {
  return (
    frame.type === 'trade.created' ||
    frame.type === 'trade.amended' ||
    frame.type === 'trade.filled' ||
    frame.type === 'trade.cancelled'
  )
}

/**
 * True when a frame is further ahead than the next expected cursor, so something
 * was missed and the client should refetch.
 *
 * Only meaningful because the server serialises writes: the sequence is gap-free,
 * so a hole in it is a lost frame rather than a rolled-back transaction.
 */
export function hasGap(state: BlotterState, frame: TradeDeltaFrame): boolean {
  // Cursor 0 is a client that has not applied anything yet.
  return state.seq > 0 && frame.seq > state.seq + 1
}

/** GET /api/trades, held to the same staleness rule as a frame. */
export function applyTradesResponse(state: BlotterState, response: TradesResponse): BlotterState {
  if (response.seq < state.seq) {
    return state
  }
  return {
    seq: response.seq,
    trades: windowed(response.trades.slice().sort(byRecency)),
    positions: state.positions,
  }
}

/**
 * GET /api/positions. Its seq decides whether the payload is stale but does not
 * become the cursor, because the trades in state may be older than it and
 * advancing would discard the frames in between.
 */
export function applyPositionsResponse(
  state: BlotterState,
  response: PositionsResponse,
): BlotterState {
  if (response.seq < state.seq) {
    return state
  }
  return { ...state, positions: response.positions }
}
