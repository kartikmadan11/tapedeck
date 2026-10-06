import type { UseMutationResult } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import type { AmendTradeInput, Trade } from '@tapedeck/shared'
import type { ApiRequestError } from '../../lib/api.js'
import { amendTrade } from '../../lib/api.js'
import { TRADE_MUTATION_KEY, useRefreshBlotter } from './useTrades.js'

/** `tradeId` is a variable rather than captured, so one instance serves every row
 *  and the pending-row lookup can read the id off the in-flight mutation. */
export type AmendVariables = { tradeId: string; input: AmendTradeInput }

export function useAmendTrade(): UseMutationResult<Trade, ApiRequestError, AmendVariables> {
  const refresh = useRefreshBlotter()

  return useMutation({
    mutationKey: TRADE_MUTATION_KEY,
    mutationFn: ({ tradeId, input }: AmendVariables) => amendTrade(tradeId, input),
    onSettled: refresh,
  })
}
