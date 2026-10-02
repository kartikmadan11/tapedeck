import type { UseMutationResult } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import type { Trade } from '@tapedeck/shared'
import type { ApiRequestError } from '../../lib/api.js'
import { cancelTrade } from '../../lib/api.js'
import { TRADE_MUTATION_KEY, useRefreshBlotter } from './useTrades.js'

/** Cancelling carries only the concurrency token, so the body is the version. */
export type CancelVariables = { tradeId: string; version: number }

export function useCancelTrade(): UseMutationResult<Trade, ApiRequestError, CancelVariables> {
  const refresh = useRefreshBlotter()

  return useMutation({
    mutationKey: TRADE_MUTATION_KEY,
    mutationFn: ({ tradeId, version }: CancelVariables) => cancelTrade(tradeId, { version }),
    onSettled: refresh,
  })
}
