import { z } from 'zod'
import { simulationState } from './simulation.js'
import { position, trade } from './trade.js'

/**
 * The stream cursor is `trade_events.seq`. Validated as a number because pg
 * returns int8 as a string, which would make `seq > cursor` lexicographic,
 * where '10' > '9' is false.
 */
export const sequenceNumber = z.number().int().positive()

const sequenced = z.object({ seq: sequenceNumber })

/**
 * Sent once per connection. The triple is read in one repeatable-read
 * transaction, so it is internally consistent.
 *
 * `seq` is non-negative here, not positive: an empty database has cursor 0.
 */
export const snapshotFrame = z.object({
  type: z.literal('snapshot'),
  seq: z.number().int().nonnegative(),
  trades: z.array(trade),
  positions: z.array(position),
})

export const tradeCreatedFrame = sequenced.extend({
  type: z.literal('trade.created'),
  trade,
})

export const tradeAmendedFrame = sequenced.extend({
  type: z.literal('trade.amended'),
  trade,
})

export const tradeCancelledFrame = sequenced.extend({
  type: z.literal('trade.cancelled'),
  trade,
})

/**
 * Recomputed exposure, pushed after a mutation. Has no `seq` field: positions
 * are derived state, and reusing the triggering event's seq would put two
 * frames on the wire with the same cursor, breaking both gap detection and the
 * handshake drain filter.
 */
export const positionsFrame = z.object({
  type: z.literal('positions'),
  positions: z.array(position),
})

/**
 * The generated feed starting or stopping. Unsequenced like positions, so it
 * must not advance any client's cursor. Broadcast rather than kept per-window,
 * so two windows cannot disagree about whether the feed is running.
 */
export const simulationFrame = z.object({
  type: z.literal('simulation'),
  ...simulationState.shape,
})

export const serverFrame = z.discriminatedUnion('type', [
  snapshotFrame,
  tradeCreatedFrame,
  tradeAmendedFrame,
  tradeCancelledFrame,
  positionsFrame,
  simulationFrame,
])
export type ServerFrame = z.infer<typeof serverFrame>

/** The frames that participate in the event order. */
export type SequencedFrame = Extract<ServerFrame, { seq: number }>

/** The three incremental frames. */
export type TradeDeltaFrame = Extract<
  ServerFrame,
  { type: 'trade.created' | 'trade.amended' | 'trade.cancelled' }
>

/** Returns null for derived frames, which must not advance the cursor. */
export function frameSequence(frame: ServerFrame): number | null {
  switch (frame.type) {
    case 'snapshot':
      return frame.seq
    case 'trade.created':
    case 'trade.amended':
    case 'trade.cancelled':
      return frame.seq
    case 'positions':
    case 'simulation':
      return null
    default: {
      // Adding a frame without deciding its ordering fails to compile here.
      const unreachable: never = frame
      return unreachable
    }
  }
}

/**
 * The single query cache entry. `seq` travels with the data so any writer, REST
 * or socket, can refuse a payload staler than what is already held.
 */
export const blotterState = z.object({
  seq: z.number().int().nonnegative(),
  trades: z.array(trade),
  positions: z.array(position),
})
export type BlotterState = z.infer<typeof blotterState>

/**
 * The cursor travels with the rows. A bare array would overwrite the cache on
 * arrival, discarding frames that landed while the request was in flight.
 */
export const tradesResponse = blotterState.omit({ positions: true })
export type TradesResponse = z.infer<typeof tradesResponse>

export const positionsResponse = blotterState.omit({ trades: true })
export type PositionsResponse = z.infer<typeof positionsResponse>

/** Server-push only. Gap recovery is a REST refetch, liveness is protocol ping/pong. */
export type ClientFrame = never
