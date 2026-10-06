import {
  amendTradeInput,
  BLOTTER_LIMIT,
  cancelTradeInput,
  createTradeInput,
  notFound,
  tradeId as tradeIdSchema,
  tradeQuery,
} from '@tapedeck/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

// No authentication in this build. The audit trail still needs an actor, so it
// comes from a header with a default.
const ANONYMOUS_ACTOR = 'web'

function actorOf(headers: Record<string, unknown>): string {
  const header = headers['x-tapedeck-actor']
  return typeof header === 'string' && header.trim().length > 0 ? header.trim() : ANONYMOUS_ACTOR
}

const tradeIdParams = z.object({ tradeId: tradeIdSchema })

export function registerTradeRoutes(app: FastifyInstance): void {
  /**
   * Returns `{ seq, trades }`, not a bare array, so the client can reject a
   * response older than what its socket already applied. Windowed to the most
   * recent BLOTTER_LIMIT unless the caller names its own limit.
   */
  app.get('/api/trades', async (request) => {
    const query = tradeQuery.parse(request.query)
    // ?? rather than a spread default: an optional key can arrive present and
    // undefined, which a spread would use to overwrite the default with nothing.
    return app.tradeService.listTrades({ ...query, limit: query.limit ?? BLOTTER_LIMIT })
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

  /**
   * 201 when a trade was booked, 200 when the body's clientTradeId had already
   * booked one. The body is the trade either way.
   */
  app.post('/api/trades', async (request, reply) => {
    const input = createTradeInput.parse(request.body)
    const { trade, replayed } = await app.tradeService.createTrade(input, actorOf(request.headers))
    return reply.status(replayed ? 200 : 201).send(trade)
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

  /** A sub-resource action, not a status patch: status is not a field a client sets. */
  app.post('/api/trades/:tradeId/cancel', async (request) => {
    const { tradeId } = tradeIdParams.parse(request.params)
    const input = cancelTradeInput.parse(request.body)
    return app.tradeService.cancelTrade(tradeId, input, actorOf(request.headers))
  })
}
