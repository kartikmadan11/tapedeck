import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'

export function registerHealthRoutes(app: FastifyInstance): void {
  /**
   * Checks the database, not just the process. A health check that only proves
   * the event loop is turning will report healthy while every request 500s, and
   * the compose healthcheck depends on this to gate the container.
   */
  app.get('/api/health', async (_request, reply) => {
    try {
      await app.db.execute(sql`select 1`)
      return { status: 'ok', database: 'ok' }
    } catch (error) {
      app.log.error({ err: error }, 'health check failed')
      return reply.status(503).send({ status: 'degraded', database: 'unreachable' })
    }
  })
}
