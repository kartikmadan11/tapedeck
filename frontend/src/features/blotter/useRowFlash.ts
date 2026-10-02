import type { Trade } from '@tapedeck/shared'
import { useEffect, useRef, useState } from 'react'

/** Matches the tape-flash animation in index.css. */
const FLASH_MS = 900

/**
 * The trades that changed since the last render, so the table can flash them.
 *
 * `updatedAt` is the change detector rather than `version`, because it also moves
 * when nothing else visible did, and comparing one string beats diffing rows.
 *
 * The first batch is recorded without flashing, otherwise 500 seeded rows all
 * flash on load and the signal is worthless exactly when a reviewer is watching.
 */
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
