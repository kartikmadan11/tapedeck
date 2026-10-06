import { z } from 'zod'

/**
 * The generated-flow feed, which books, amends and cancels trades on a timer.
 * It drives the application's own write path rather than fabricating frames.
 */
export const simulationState = z.object({
  running: z.boolean(),
  /** Reported, not settable. */
  intervalMs: z.number().int().positive(),
})
export type SimulationState = z.infer<typeof simulationState>

/** Only `running` is settable. The cadence is deployment configuration. */
export const setSimulationInput = z.strictObject({
  running: z.boolean(),
})
export type SetSimulationInput = z.infer<typeof setSimulationInput>
