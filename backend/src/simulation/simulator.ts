import type { Rng } from '@tapedeck/database'
import type {
  AmendTradeInput,
  CancelTradeInput,
  CreateTradeInput,
  FillTradeInput,
  SimulationState,
  Trade,
} from '@tapedeck/shared'
import type { FastifyBaseLogger } from 'fastify'
import type { Bus } from '../bus.js'
import { nextAction } from './nextAction.js'

/** Recorded as the actor on every event the feed produces. */
export const SIMULATOR_ACTOR = 'simulator'

export interface SimulatorOptions {
  intervalMs: number
  maxTrades: number
  rng: Rng
  log: FastifyBaseLogger
  bus: Bus
  /** Every trade a write can still touch, so everything but the cancelled. */
  listOpen: () => Promise<Trade[]>
  create: (input: CreateTradeInput, actor: string) => Promise<Trade>
  amend: (tradeId: string, input: AmendTradeInput, actor: string) => Promise<Trade>
  fill: (tradeId: string, input: FillTradeInput, actor: string) => Promise<Trade>
  cancel: (tradeId: string, input: CancelTradeInput, actor: string) => Promise<Trade>
}

export interface Simulator {
  start: () => void
  stop: () => void
  readonly state: SimulationState
  /** One tick with no timer involved, which is what the tests drive. */
  runOnce: () => Promise<void>
}

/** The generated trade feed. It writes through the injected service calls rather than
 * publishing its own frames, so it inherits the real write path: a gap-free `seq`, a
 * correct `version` chain, a full event history, netted positions. */
export function createSimulator(options: SimulatorOptions): Simulator {
  const { intervalMs, maxTrades, rng, log, bus } = options

  let running = false
  let timer: NodeJS.Timeout | null = null

  function currentState(): SimulationState {
    return { running, intervalMs }
  }

  async function runOnce(): Promise<void> {
    const open = await options.listOpen()
    const action = nextAction(open, maxTrades, rng)

    switch (action.kind) {
      case 'create':
        await options.create(action.input, SIMULATOR_ACTOR)
        return
      case 'amend':
        await options.amend(action.tradeId, action.input, SIMULATOR_ACTOR)
        return
      case 'fill':
        await options.fill(action.tradeId, action.input, SIMULATOR_ACTOR)
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

  /** A re-arming timeout, not setInterval: writes serialise behind an advisory lock,
   * so arming after a tick finishes makes the interval a floor, not a deadline. */
  function arm(): void {
    timer = setTimeout(() => {
      void tick()
    }, intervalMs)
    // Without unref this timer keeps the event loop alive and nothing would exit.
    timer.unref()
  }

  async function tick(): Promise<void> {
    try {
      await runOnce()
    } catch (error) {
      // A VERSION_CONFLICT here is expected: two writes to the same trade at once.
      log.warn({ err: error }, 'simulated trade failed')
    }

    // After the await: stop() may have run during the tick, and re-arming would leave
    // a timer running after the feed was switched off.
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
    // Published on a real transition only.
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
