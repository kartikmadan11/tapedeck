import { useCallback, useState } from 'react'
import { readTrader, writeTrader } from '../../lib/identity.js'

/**
 * The window's trader. Mirrored into storage on every change so that `api.ts`,
 * which is not a component, can read the same value when it stamps the actor
 * header onto an amend or a cancel.
 */
export function useIdentity(): { trader: string; setTrader: (trader: string) => void } {
  const [trader, setState] = useState(readTrader)

  const setTrader = useCallback((next: string) => {
    setState(next)
    writeTrader(next)
  }, [])

  return { trader, setTrader }
}
