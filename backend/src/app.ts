import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { createDatabase, type Database, type DatabaseHandle, Rng } from '@tapedeck/database'
import { BLOTTER_LIMIT } from '@tapedeck/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { type Bus, createBus } from './bus.js'
import type { Config } from './config.js'
import { registerErrorHandler } from './plugins/errorHandler.js'
import { TradeRepository } from './repositories/trades.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerPositionRoutes } from './routes/positions.js'
import { registerSimulationRoutes } from './routes/simulation.js'
import { registerTradeRoutes } from './routes/trades.js'
import { TradeService } from './services/tradeService.js'
import { createSimulator, type Simulator } from './simulation/simulator.js'
import { createHub, type Hub } from './ws/hub.js'
import { registerWebsocketRoute } from './ws/route.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
    bus: Bus
    hub: Hub
    tradeService: TradeService
    simulator: Simulator
  }
}

export interface BuiltApp {
  app: FastifyInstance
  database: DatabaseHandle
}

/**
 * Builds a fully wired app without listening. server.ts is the only place that
 * calls listen(), so tests can use app.inject() with no port and the websocket
 * tests can bind port 0.
 */
export async function buildApp(config: Config): Promise<BuiltApp> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Trust the proxy so request logs show the client address, not the balancer's.
    trustProxy: true,
  })

  const database = createDatabase(config.DATABASE_URL)
  const bus = createBus((error) => {
    app.log.error({ err: error }, 'frame listener threw')
  })
  const repository = new TradeRepository(database.db)
  const tradeService = new TradeService(repository, bus)

  /**
   * Created here but never started here, so buildApp() stays free of side
   * effects. Constructed before the hub, whose handshake reports its state.
   *
   * The write callbacks are wrappers, not bare method references: TradeService
   * holds its repository on `this`, so passing `tradeService.createTrade`
   * directly would unbind it and fail at runtime, not at compile time.
   */
  const simulator = createSimulator({
    intervalMs: config.SIMULATION_INTERVAL_MS,
    maxTrades: config.SIMULATION_MAX_TRADES,
    // Seeded from the clock, unlike the seed's fixed value.
    rng: new Rng(Date.now()),
    log: app.log,
    bus,
    // Unwindowed on purpose: the simulator compares what it reads against
    // maxTrades, so a limit here would hide trades above the cap and it would
    // book forever.
    listActive: () => tradeService.listTrades({ status: 'ACTIVE' }).then((result) => result.trades),
    // The simulator sends no clientTradeId, so its bookings never replay.
    create: (input, actor) => tradeService.createTrade(input, actor).then(({ trade }) => trade),
    amend: (tradeId, input, actor) => tradeService.amendTrade(tradeId, input, actor),
    cancel: (tradeId, input, actor) => tradeService.cancelTrade(tradeId, input, actor),
  })

  const hub = createHub({
    bus,
    log: app.log,
    pingIntervalMs: config.WS_PING_INTERVAL_MS,
    // Windowed like the REST read: an unbounded handshake snapshot would put the
    // whole book on the wire on every reconnect.
    readSnapshot: () => repository.readSnapshot({ limit: BLOTTER_LIMIT }),
    readSimulation: () => simulator.state,
  })

  app.decorate('db', database.db)
  app.decorate('bus', bus)
  app.decorate('hub', hub)
  app.decorate('tradeService', tradeService)
  app.decorate('simulator', simulator)

  await app.register(fastifyWebsocket)

  registerErrorHandler(app, { serveSpaFallback: config.STATIC_DIR !== undefined })
  registerHealthRoutes(app)
  registerTradeRoutes(app)
  registerPositionRoutes(app)
  registerSimulationRoutes(app)
  registerWebsocketRoute(app)

  if (config.STATIC_DIR !== undefined) {
    await app.register(fastifyStatic, { root: config.STATIC_DIR, prefix: '/' })
  }

  // Ordered: stop writing, then stop broadcasting, then close the pool, so no
  // queued tick or in-flight read outlives the connections it needs.
  app.addHook('onClose', async () => {
    simulator.stop()
    hub.close()
    await database.close()
  })

  return { app, database }
}
