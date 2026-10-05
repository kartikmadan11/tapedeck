import { setSimulationInput } from '@tapedeck/shared'
import type { FastifyInstance } from 'fastify'

/**
 * Control for the generated trade feed.
 *
 * Deliberately not under /api/trades: it writes no trade itself, it decides
 * whether something else does.
 */
export function registerSimulationRoutes(app: FastifyInstance): void {
  /**
   * Read on load, so a client that connects while the feed is already running
   * renders the right control without waiting for the next broadcast.
   */
  app.get('/api/simulation', async () => app.simulator.state)

  /**
   * Returns the new state rather than 204, so the caller does not have to assume
   * the write took effect. start() and stop() broadcast, so every other client
   * converges without polling this.
   */
  app.post('/api/simulation', async (request) => {
    const { running } = setSimulationInput.parse(request.body)
    if (running) {
      app.simulator.start()
    } else {
      app.simulator.stop()
    }
    return app.simulator.state
  })
}
