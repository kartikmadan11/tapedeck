import type { Position } from '@tapedeck/shared'
import { useBlotter } from '../trades/useTrades.js'

/** Same cache entry as the trades, so they arrive with the same snapshot. Never
 *  derived from the loaded trades: Postgres sums them in numeric, and two clients
 *  summing floats in different orders can disagree in the last place. */
export function usePositions(): Position[] {
  const { data } = useBlotter()
  return data?.positions ?? []
}
