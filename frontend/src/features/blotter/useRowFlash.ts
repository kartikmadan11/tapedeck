import type { Trade } from '@tapedeck/shared'
import { useEffect, useRef, useState } from 'react'

/** Matches the tape-flash animation in index.css. */
const FLASH_MS = 900

/** Trade ids that changed since the last render, for the row flash. Keyed on
 *  `updatedAt`, not `version`: it moves even when nothing visible did. The first
 *  batch is recorded without flashing, or every seeded row flashes on load. */
export function useRowFlash(trades: Trade[]): ReadonlySet<string> {
  const seen = useRef(new Map<string, string>())
  const primed = useRef(false)
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const previous = seen.current
    const changed: string[] = []

    for (const trade of trades) {
      const before = previous.get(trade.tradeId)
      if (primed.current && before !== trade.updatedAt) {
        changed.push(trade.tradeId)
      }
      previous.set(trade.tradeId, trade.updatedAt)
    }

    primed.current = true

    if (changed.length === 0) {
      return
    }

    setFlashing(new Set(changed))
    const timer = setTimeout(() => setFlashing(new Set()), FLASH_MS)
    return () => clearTimeout(timer)
  }, [trades])

  return flashing
}
