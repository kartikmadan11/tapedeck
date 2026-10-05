import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SimulationState } from '@tapedeck/shared'
import { fetchSimulation, setSimulation } from '../../lib/api.js'
import { queryKeys } from '../../lib/queryClient.js'

export type UseSimulation = {
  state: SimulationState | undefined
  toggle: () => void
  pending: boolean
}

/**
 * The generated feed's control.
 *
 * Read once over REST, because a client connecting while the feed is already
 * running would otherwise show the wrong label until someone toggled it. Kept
 * current after that by the broadcast frame, which useRealtime writes straight
 * into this cache entry.
 */
export function useSimulation(): UseSimulation {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.simulation,
    queryFn: fetchSimulation,
  })

  const mutation = useMutation({
    mutationFn: setSimulation,
    onSuccess: (next) => {
      // Written from the response rather than waiting for the broadcast, so the
      // button does not sit in its old state for a round trip. The frame that
      // follows carries the same values, so there is nothing to reconcile.
      queryClient.setQueryData<SimulationState>(queryKeys.simulation, next)
    },
  })

  return {
    state: query.data,
    toggle: () => {
      if (query.data === undefined) {
        return
      }
      mutation.mutate(!query.data.running)
    },
    pending: mutation.isPending,
  }
}
