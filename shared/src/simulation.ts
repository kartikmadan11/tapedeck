import { z } from 'zod'

/**
 * The generated-flow feed, which books, amends and cancels trades on a timer so
 * the blotter is live without anyone touching it.
 *
 * It is a demo aid, not a market data feed: it drives the application's own
 * write path rather than fabricating frames, so everything it produces carries
 * the same guarantees as a trade booked by hand.
 */
export const simulationState = z.object({
  running: z.boolean(),
  /** Reported so the UI can say how fast the feed is, not to let it change it. */
  intervalMs: z.number().int().positive(),
})
export type SimulationState = z.infer<typeof simulationState>

/**
 * Only `running` is settable. The cadence is deployment configuration, so a
 * client cannot ask the server to write as fast as it likes.
 */
export const setSimulationInput = z.strictObject({
  running: z.boolean(),
})
export type SetSimulationInput = z.infer<typeof setSimulationInput>
