import { useState } from 'react'
import { readTrader } from '../../lib/identity.js'

/** The window's trader, read once. No setter: `adoptIdentity` settles it before the
 *  first render and nothing on screen can change it. */
export function useIdentity(): { trader: string } {
  const [trader] = useState(readTrader)
  return { trader }
}
