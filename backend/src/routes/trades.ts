import {
  amendTradeInput,
  cancelTradeInput,
  createTradeInput,
  notFound,
  tradeId as tradeIdSchema,
  tradeQuery,
} from '@tapedeck/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

// There is no authentication in this build, which the README states plainly. The
// audit trail still needs an actor, so it comes from a header with a default.
// Threading it through now means adding real auth changes one line here, rather
// than retrofitting a column into an append-only table.
const ANONYMOUS_ACTOR = 'web'

function actorOf(headers: Record<string, unknown>): string {
  const header = headers['x-tapedeck-actor']
  return typeof header === 'string' && header.trim().length > 0 ? header.trim() : ANONYMOUS_ACTOR
}

const tradeIdParams = z.object({ tradeId: tradeIdSchema })

export function registerTradeRoutes(app: FastifyInstance): void {
  /**
   * Returns `{ seq, trades }`, not a bare array, so the client can reject a
   * response older than what its socket already applied. A bare array makes
   * every refetch a potential lost update.
   */
  app.get('/api/trades', async (request) => {
    const query = tradeQuery.parse(request.query)
    return app.tradeService.listTrades(query)
  })

  app.get('/api/trades/:tradeId', async (request) => {
    const { tradeId } = tradeIdParams.parse(request.params)
    const trade = await app.tradeService.findTrade(tradeId)
    if (!trade) {
      throw notFound(tradeId)
    }
    return trade
  })

  /** The audit trail for one trade, oldest first. */
  app.get('/api/trades/:tradeId/events', async (request) => {
    const { tradeId } = tradeIdParams.parse(request.params)
    return { events: await app.tradeService.listEvents(tradeId) }
  })

  app.post('/api/trades', async (request, reply) => {
    const input = createTradeInput.parse(request.body)
    const trade = await app.tradeService.createTrade(input, actorOf(request.headers))
    return reply.status(201).send(trade)
  })

  /**
   * PATCH, not PUT: a partial update of three fields, and the body cannot express
   * the others. Amending `symbol` is a 400, not a silent no-op.
   */
  app.patch('/api/trades/:tradeId', async (request) => {
    const { tradeId } = tradeIdParams.parse(request.params)
    const input = amendTradeInput.parse(request.body)
    return app.tradeService.amendTrade(tradeId, input, actorOf(request.headers))
  })

  /**
   * A sub-resource action rather than a status patch, because status is not a
   * field a client sets. The body carries only the concurrency token.
   */
  app.post('/api/trades/:tradeId/cancel', async (request) => {
    const { tradeId } = tradeIdParams.parse(request.params)
    const input = cancelTradeInput.parse(request.body)
    return app.tradeService.cancelTrade(tradeId, input, actorOf(request.headers))
  })
}
