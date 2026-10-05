import type { Rng } from '@tapedeck/database'
import type {
  AmendTradeInput,
  CancelTradeInput,
  CreateTradeInput,
  SimulationState,
  Trade,
} from '@tapedeck/shared'
import type { FastifyBaseLogger } from 'fastify'
import type { Bus } from '../bus.js'
import { nextAction } from './nextAction.js'

/**
 * Recorded as the actor on every event the feed produces, so the audit trail is
 * honest about which rows a human touched.
 */
export const SIMULATOR_ACTOR = 'simulator'

export interface SimulatorOptions {
  intervalMs: number
  maxTrades: number
  rng: Rng
  log: FastifyBaseLogger
  bus: Bus
  listActive: () => Promise<Trade[]>
  create: (input: CreateTradeInput, actor: string) => Promise<Trade>
  amend: (tradeId: string, input: AmendTradeInput, actor: string) => Promise<Trade>
  cancel: (tradeId: string, input: CancelTradeInput, actor: string) => Promise<Trade>
}

export interface Simulator {
  start: () => void
  stop: () => void
  readonly state: SimulationState
  /** One tick with no timer involved, which is what the tests drive. */
  runOnce: () => Promise<void>
}

/**
 * The generated trade feed.
 *
 * It writes through the injected service calls rather than publishing frames of
 * its own, so everything it produces inherits the real write path: a gap-free
 * `seq`, a correct `version` chain, a full event history and netted positions.
 * Fabricated frames would break all four and make the live demo a lie.
 *
 * Dependencies arrive as callbacks, the way HubOptions takes readSnapshot, so
 * the runner is testable without a database.
 */
export function createSimulator(options: SimulatorOptions): Simulator {
  const { intervalMs, maxTrades, rng, log, bus } = options

  let running = false
  let timer: NodeJS.Timeout | null = null

  function currentState(): SimulationState {
    return { running, intervalMs }
  }

  async function runOnce(): Promise<void> {
    const active = await options.listActive()
    const action = nextAction(active, maxTrades, rng)

    switch (action.kind) {
      case 'create':
        await options.create(action.input, SIMULATOR_ACTOR)
        return
      case 'amend':
        await options.amend(action.tradeId, action.input, SIMULATOR_ACTOR)
        return
      case 'cancel':
        await options.cancel(action.tradeId, action.input, SIMULATOR_ACTOR)
        return
      default: {
        // Adding an action without teaching the runner to perform it fails here.
        const unreachable: never = action
        return unreachable
      }
    }
  }

  /**
   * A re-arming timeout, not setInterval. Writes serialise behind an advisory
   * lock, so a tick slower than the interval would let setInterval queue the next
   * one immediately and pile ticks up behind the lock. Scheduling only after a
   * tick finishes makes the interval a floor on the gap rather than a deadline.
   */
  function arm(): void {
    timer = setTimeout(() => {
      void tick()
    }, intervalMs)
    // Without unref this timer alone keeps the event loop alive, so a process or
    // a test run would never exit. Same reason as the hub's ping timer.
    timer.unref()
  }

  async function tick(): Promise<void> {
    try {
      await runOnce()
    } catch (error) {
      // A VERSION_CONFLICT here is expected, not exceptional: it is what happens
      // when someone amends the same trade in the same instant. The feed logs it
      // and carries on, because a demo that dies on a race is worse than a race.
      log.warn({ err: error }, 'simulated trade failed')
    }

    // Checked after the await: stop() may have been called during the tick, and
    // re-arming then would leave a timer running after the feed was switched off.
    if (running) {
      arm()
    }
  }

  function start(): void {
    if (running) {
      return
    }
    running = true
    arm()
    // Published on a real transition only, so the route stays thin and any other
    // caller keeps every connected client in agreement for free.
    bus.publish({ type: 'simulation', ...currentState() })
    log.info({ intervalMs, maxTrades }, 'simulated trade feed started')
  }

  function stop(): void {
    if (!running) {
      return
    }
    running = false
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    bus.publish({ type: 'simulation', ...currentState() })
    log.info('simulated trade feed stopped')
  }

  return {
    start,
    stop,
    get state() {
      return currentState()
    },
    runOnce,
  }
}
