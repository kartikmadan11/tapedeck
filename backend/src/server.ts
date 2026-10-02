import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const { app } = await buildApp(config)

/**
 * Close on SIGTERM and SIGINT so `docker compose down` is a clean shutdown
 * rather than a kill: the onClose hook closes the websocket clients with 1001
 * and drains the pool, instead of leaving clients to discover the socket is gone
 * by timeout.
 */
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down')
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed')
        process.exit(1)
      },
    )
  })
}

try {
  await app.listen({ port: config.PORT, host: config.HOST })
} catch (error) {
  app.log.error({ err: error }, 'failed to start')
  process.exit(1)
}
