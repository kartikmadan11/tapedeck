import { setSimulationInput } from '@tapedeck/shared'
import type { FastifyInstance } from 'fastify'

/** Control for the generated trade feed. It writes no trade itself. */
export function registerSimulationRoutes(app: FastifyInstance): void {
  /** Read on load, so a client connecting mid-run renders the right control. */
  app.get('/api/simulation', async () => app.simulator.state)

  /**
   * Returns the new state rather than 204. start() and stop() broadcast, so
   * every other client converges without polling this.
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
