import type { ReactElement } from 'react'
import { useIdentity } from '../identity/useIdentity.js'

type Props = {
  trader: string
  /** What the window is about to write, so the line can name it. */
  action: 'amendment' | 'cancellation'
}

/**
 * Whose trade this is. Not a guard: correcting someone else's booking is trade
 * support's job and a trade cannot wait for the trader who booked it, so the
 * control is saying whose trade it is and whose name the event will carry.
 */
export function BookedBy({ trader, action }: Props): ReactElement {
  const { trader: me } = useIdentity()

  if (trader === me) {
    return <p className="mb-3 text-tape-muted">Booked by you</p>
  }

  // Always rendered, so a missing line never means either that it is yours or
  // that the line failed. Accent rather than the sell colour: this is something
  // to notice, not something refused.
  return (
    <p className="mb-3 text-tape-accent">
      Booked by {trader}. Your name goes on the {action}.
    </p>
  )
}
