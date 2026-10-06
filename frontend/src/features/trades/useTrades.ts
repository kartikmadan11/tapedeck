import type { UseQueryResult } from '@tanstack/react-query'
import { useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BlotterState } from '@tapedeck/shared'
import { useCallback } from 'react'
import { loadBlotter, queryKeys } from '../../lib/queryClient.js'

/**
 * The blotter cache entry. REST fills it, the socket keeps it current, and both
 * go through the same cursor guard, so there is no second state container to
 * reconcile.
 */
export function useBlotter(): UseQueryResult<BlotterState> {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: queryKeys.blotter,
    queryFn: () => loadBlotter(queryClient),
  })
}

/**
 * Run after every mutation, whether it succeeded or failed, so the user's own
 * action lands even if the socket happens to be reconnecting.
 *
 * This is only safe because the refetch goes through the cursor guard: a bare
 * refetch replaces the cache when it lands and discards every frame that
 * arrived while it was in flight.
 */
export function useRefreshBlotter(): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.blotter })
  }, [queryClient])
}

/** Shared by amend and cancel so one filter finds both. */
export const TRADE_MUTATION_KEY = ['trade', 'mutate'] as const

type TradeMutationVariables = { tradeId: string }

/**
 * The trades with a mutation in flight, read from React Query's own mutation
 * state rather than tracked separately.
 *
 * This is what replaces an optimistic write. Guessing the next version locally
 * would briefly show a version the server never assigned, so the row is marked
 * pending instead and the broadcast clears it.
 */
export function usePendingTradeIds(): ReadonlySet<string> {
  const pending = useMutationState({
    filters: { mutationKey: TRADE_MUTATION_KEY, status: 'pending' },
    select: (mutation) => (mutation.state.variables as TradeMutationVariables | undefined)?.tradeId,
  })

  return new Set(pending.filter((tradeId): tradeId is string => tradeId !== undefined))
}
