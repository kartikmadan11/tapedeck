import { useState } from 'react'
import { readTrader } from '../../lib/identity.js'

/**
 * The window's trader, read once. No setter: the identity is settled before the
 * first render by `adoptIdentity` and nothing on screen can change it.
 */
export function useIdentity(): { trader: string } {
  const [trader] = useState(readTrader)
  return { trader }
}
