import type { Position } from '@tapedeck/shared'
import { useBlotter } from '../trades/useTrades.js'

/**
 * Positions live in the same cache entry as the trades, so they arrive with the
 * same snapshot and are replaced by the same stream. They are never derived from
 * the loaded trades: Postgres sums them in numeric, and two clients summing
 * floats in different orders can disagree in the last place.
 */
export function usePositions(): Position[] {
  const { data } = useBlotter()
  return data?.positions ?? []
}
