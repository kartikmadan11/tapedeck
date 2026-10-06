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

/** Newest first, matching the server's ORDER BY, so a refetch never reshuffles
 *  rows the stream placed. UTC ISO at one precision, so the strings compare as
 *  instants and the comparator parses no dates. */
function byRecency(a: Trade, b: Trade): number {
  if (a.tradeTimestamp !== b.tradeTimestamp) {
    return a.tradeTimestamp < b.tradeTimestamp ? 1 : -1
  }
  return a.tradeId < b.tradeId ? 1 : -1
}

/** The most recent BLOTTER_LIMIT trades, the window the server was asked for.
 *  Trimmed on the way in, because cancelled trades stay on the tape and nothing
 *  ever leaves the array. Safe to cut from the end: sorted newest first. */
function windowed(trades: Trade[]): Trade[] {
  return trades.length > BLOTTER_LIMIT ? trades.slice(0, BLOTTER_LIMIT) : trades
}

/** A replacement keeps its slot, since an amendment cannot change tradeTimestamp
 *  or tradeId. A new trade is inserted in order: appending leaves the array
 *  unsorted until the next refetch. */
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
  // Only the insert path grows the array. Trimming on replacement would cut a row
  // on every amendment of an already full window.
  return windowed(next)
}

/** The only writer of blotter state, pure and socket-free so every delivery order
 *  is reachable from a test. Every branch refuses a payload older than the cursor
 *  held, or a refetch landing after a frame it lacks would revert that frame. */
export function apply(state: BlotterState, frame: ServerFrame): BlotterState {
  switch (frame.type) {
    case 'snapshot':
      if (frame.seq < state.seq) {
        return state
      }
      return {
        seq: frame.seq,
        // Windowed here too, though the handshake snapshot already is server-side:
        // the invariant should not rest on an agreement between two files.
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
      // No cursor to order it against, so the latest wins. Must not advance seq,
      // or the client would discard trade frames it has not applied.
      return { ...state, positions: frame.positions }

    case 'simulation':
      // Routed to its own cache entry before this point. The case only keeps the
      // union exhaustive.
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

/** A frame ahead of the next expected cursor, so one was missed and the client
 *  should refetch. Meaningful only because the server serialises writes: the
 *  sequence is gap-free, so a hole is a lost frame. */
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

/** Its seq decides staleness but does not become the cursor: the trades in state
 *  may be older, and advancing would discard the frames in between. */
export function applyPositionsResponse(
  state: BlotterState,
  response: PositionsResponse,
): BlotterState {
  if (response.seq < state.seq) {
    return state
  }
  return { ...state, positions: response.positions }
}
