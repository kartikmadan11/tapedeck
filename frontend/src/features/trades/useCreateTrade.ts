import type { UseMutationResult } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import type { CreateTradeInput, Trade } from '@tapedeck/shared'
import type { ApiRequestError } from '../../lib/api.js'
import { createTrade } from '../../lib/api.js'
import { useRefreshBlotter } from './useTrades.js'

export function useCreateTrade(): UseMutationResult<Trade, ApiRequestError, CreateTradeInput> {
  const refresh = useRefreshBlotter()

  return useMutation({
    mutationFn: createTrade,
    onSettled: refresh,
  })
}
