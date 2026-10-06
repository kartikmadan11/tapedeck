import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SimulationState } from '@tapedeck/shared'
import { fetchSimulation, setSimulation } from '../../lib/api.js'
import { queryKeys } from '../../lib/queryClient.js'

export type UseSimulation = {
  state: SimulationState | undefined
  toggle: () => void
  pending: boolean
}

/** Read once over REST, or a client connecting while the feed is already running
 *  shows the wrong label until someone toggles it. The broadcast frame, written by
 *  useRealtime into this same entry, keeps it current after that. */
export function useSimulation(): UseSimulation {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.simulation,
    queryFn: fetchSimulation,
  })

  const mutation = useMutation({
    mutationFn: setSimulation,
    onSuccess: (next) => {
      // From the response rather than the broadcast, so the button does not sit
      // in its old state for a round trip. The frame carries the same values.
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
