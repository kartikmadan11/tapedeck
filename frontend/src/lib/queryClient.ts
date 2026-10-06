import { QueryClient } from '@tanstack/react-query'
import type { BlotterState } from '@tapedeck/shared'
import {
  applyPositionsResponse,
  applyTradesResponse,
  emptyBlotter,
} from '../features/realtime/apply.js'
import { ApiRequestError, fetchPositions, fetchTrades } from './api.js'

/** One entry holds the whole blotter: trades and positions share a cursor, and two
 *  entries could disagree about which frame they had seen. */
export const queryKeys = {
  blotter: ['blotter'] as const,
  tradeEvents: (tradeId: string) => ['trade-events', tradeId] as const,
  // Separate from the blotter: folded in, a toggle could invalidate rows.
  simulation: ['simulation'] as const,
}

/** First paint, and the recovery path after a gap. The base is read after both
 *  requests resolve, so the cursor guard sees frames applied in the meantime.
 *  Positions fold in first so the trades read sets the cursor: either response may
 *  be the newer one, and a positions payload behind it would be refused as stale. */
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
        // races the stream and can overwrite a frame with an older read.
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: shouldRetry,
      },
      mutations: {
        // Booking twice because a response was slow is worse than reporting it.
        retry: false,
      },
    },
  })
}
