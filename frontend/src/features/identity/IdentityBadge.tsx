import type { ReactElement } from 'react'
import { MICRO_LABEL } from '../../lib/ui.js'

type Props = { trader: string }

/**
 * Who the window is trading as, stated rather than offered.
 *
 * This was a text box, and a text box is the wrong shape for it: the name
 * stamped on an amend is the one thing in the application nobody should be able
 * to choose. In production the actor arrives from outside, injected by a gateway
 * that has already authenticated the user, and the application trusts the edge.
 * So this reads what the window was handed and shows it.
 *
 * Text rather than a disabled input. A greyed-out box invites a click and then
 * refuses it, which is a worse answer than a box that was never there, and plain
 * text is also what distinguishes the one thing in this row that is not a
 * control.
 */
export function IdentityBadge({ trader }: Props): ReactElement {
  // Inline flow with a real space between the two, rather than flex with a gap.
  // A flex gap is not text, so a screen reader reads the label straight into the
  // name as one word, and two sizes on one baseline is the better line anyway.
  return (
    <p className="whitespace-nowrap">
      <span className={MICRO_LABEL}>Trading as</span> <span>{trader}</span>
    </p>
  )
}
