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
   *
   * Windowed to the most recent BLOTTER_LIMIT unless the caller names its own
   * limit. Cancelled trades stay on the tape, so the unwindowed form grows for
   * as long as the feed runs and would eventually put megabytes on the wire to
   * render rows nobody scrolls to.
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
   * booked one and this is a repeat. The body is the trade either way, so a
   * client that ignores the status still gets what it asked for, and one that
   * reads it can tell that its retry did not double-book.
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
