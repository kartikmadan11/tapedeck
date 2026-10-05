import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import type { Config } from '../../src/config.js'
import { TEST_DATABASE_URL } from './db.js'

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    DATABASE_URL: TEST_DATABASE_URL,
    PORT: 0,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    // Short enough that a liveness test does not take half a minute, long
    // enough not to fire during an unrelated test.
    WS_PING_INTERVAL_MS: 5_000,
    // buildApp() never starts the feed, so this is belt and braces: it means a
    // test that does reach for server-style wiring still cannot have trades
    // appearing underneath its assertions.
    SIMULATION_ENABLED: false,
    SIMULATION_INTERVAL_MS: 2_000,
    SIMULATION_MAX_TRADES: 900,
    ...overrides,
  }
}

/** For REST tests: app.inject() needs no port. */
export async function buildTestApp(): Promise<FastifyInstance> {
  const { app } = await buildApp(testConfig())
  await app.ready()
  return app
}

/**
 * For websocket tests: inject() is light-my-request and performs no HTTP
 * upgrade, so a real listener is required. Port 0 avoids collisions between
 * parallel test files.
 */
export async function listenTestApp(
  overrides: Partial<Config> = {},
): Promise<{ app: FastifyInstance; url: string }> {
  const { app } = await buildApp(testConfig(overrides))
  await app.listen({ port: 0, host: '127.0.0.1' })

  const address = app.server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP address after listening on port 0')
  }

  return { app, url: `ws://127.0.0.1:${address.port}/ws` }
}
