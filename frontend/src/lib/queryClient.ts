import { QueryClient } from '@tanstack/react-query'
import type { BlotterState } from '@tapedeck/shared'
import {
  applyPositionsResponse,
  applyTradesResponse,
  emptyBlotter,
} from '../features/realtime/apply.js'
import { ApiRequestError, fetchPositions, fetchTrades } from './api.js'

/**
 * One entry holds the whole blotter, because trades and positions share a cursor
 * and the socket writes both. Two entries would need two cursors and could
 * disagree about which mutation they had seen.
 */
export const queryKeys = {
  blotter: ['blotter'] as const,
  tradeEvents: (tradeId: string) => ['trade-events', tradeId] as const,
}

/**
 * The first paint, before the socket has finished its handshake, and the recovery
 * path after a detected gap.
 *
 * The base is read after both requests resolve, not before, so frames applied
 * while they were in flight are part of what the cursor guard compares against
 * and a response older than the stream cannot overwrite it. A frame landing in
 * the tick between this read and the cache write would still be lost, which is
 * what gap detection on the following frame exists to catch.
 *
 * Positions are folded in before trades so the trades read sets the cursor:
 * either response may be the newer one, and a positions payload tagged behind
 * the trades payload would otherwise be refused as stale, leaving the panel
 * blank. The two reads are not one transaction, so the panel can lag the rows by
 * one mutation until the snapshot frame replaces both.
 */
export async function loadBlotter(client: QueryClient): Promise<BlotterState> {
  const [trades, positions] = await Promise.all([fetchTrades(), fetchPositions()])
  const base = client.getQueryData<BlotterState>(queryKeys.blotter) ?? emptyBlotter
  return applyTradesResponse(applyPositionsResponse(base, positions), trades)
}

/** A request the server has already judged invalid will be judged invalid again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status < 500) {
    return false
  }
  return failureCount < 2
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The socket is the freshness mechanism. Polling or refetching on focus
        // would race the stream and could overwrite frames with an older read,
        // which is the lost update the cursor exists to prevent.
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: shouldRetry,
      },
      mutations: {
        // Booking a trade twice because a response was slow is worse than
        // reporting the failure.
        retry: false,
      },
    },
  })
}
