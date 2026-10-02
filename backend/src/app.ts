import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { createDatabase, type Database, type DatabaseHandle } from '@tapedeck/database'
import Fastify, { type FastifyInstance } from 'fastify'
import { type Bus, createBus } from './bus.js'
import type { Config } from './config.js'
import { registerErrorHandler } from './plugins/errorHandler.js'
import { TradeRepository } from './repositories/trades.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerPositionRoutes } from './routes/positions.js'
import { registerTradeRoutes } from './routes/trades.js'
import { TradeService } from './services/tradeService.js'
import { createHub, type Hub } from './ws/hub.js'
import { registerWebsocketRoute } from './ws/route.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
    bus: Bus
    hub: Hub
    tradeService: TradeService
  }
}

export interface BuiltApp {
  app: FastifyInstance
  database: DatabaseHandle
}

/**
 * Builds a fully wired app without listening. server.ts is the only place that
 * calls listen(), so tests can use app.inject() with no port, and the websocket
 * tests can bind port 0.
 */
export async function buildApp(config: Config): Promise<BuiltApp> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Trust the proxy so request logs show the client address behind Fly or
    // Render rather than the load balancer's.
    trustProxy: true,
  })

  const database = createDatabase(config.DATABASE_URL)
  const bus = createBus((error) => {
    app.log.error({ err: error }, 'frame listener threw')
  })
  const repository = new TradeRepository(database.db)
  const tradeService = new TradeService(repository, bus)

  const hub = createHub({
    bus,
    log: app.log,
    pingIntervalMs: config.WS_PING_INTERVAL_MS,
    readSnapshot: () => repository.readSnapshot(),
  })

  app.decorate('db', database.db)
  app.decorate('bus', bus)
  app.decorate('hub', hub)
  app.decorate('tradeService', tradeService)

  await app.register(fastifyWebsocket)

  registerErrorHandler(app, { serveSpaFallback: config.STATIC_DIR !== undefined })
  registerHealthRoutes(app)
  registerTradeRoutes(app)
  registerPositionRoutes(app)
  registerWebsocketRoute(app)

  if (config.STATIC_DIR !== undefined) {
    await app.register(fastifyStatic, { root: config.STATIC_DIR, prefix: '/' })
  }

  // Ordered: stop broadcasting before closing the pool, so no in-flight
  // positions read outlives the connections it needs.
  app.addHook('onClose', async () => {
    hub.close()
    await database.close()
  })

  return { app, database }
}
