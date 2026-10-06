import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'

export function registerHealthRoutes(app: FastifyInstance): void {
  /** Checks the database, not just the process. The compose healthcheck gates on it. */
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
