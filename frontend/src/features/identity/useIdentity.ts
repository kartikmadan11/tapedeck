import { useState } from 'react'
import { readTrader } from '../../lib/identity.js'

/**
 * The window's trader, read once.
 *
 * No setter. The identity is settled before the first render by `adoptIdentity`
 * and nothing on screen can change it, so this is a value with a lifetime rather
 * than a lookup, which is the shape an auth hook has when there is one.
 */
export function useIdentity(): { trader: string } {
  const [trader] = useState(readTrader)
  return { trader }
}
