import type { FastifyInstance } from 'fastify'

export function registerPositionRoutes(app: FastifyInstance): void {
  /** Carries the cursor for the same reason GET /api/trades does. */
  app.get('/api/positions', async () => app.tradeService.listPositions())
}
