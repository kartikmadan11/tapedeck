import type { ReactElement } from 'react'
import { MICRO_LABEL } from '../../lib/ui.js'

type Props = { trader: string }

/**
 * Who the window is trading as, stated rather than offered. Plain text, not a
 * disabled input: the name stamped on an amend is not a choice.
 */
export function IdentityBadge({ trader }: Props): ReactElement {
  // Inline flow with a real space between the two, rather than flex with a gap.
  // A flex gap is not text, so a screen reader reads the label straight into the
  // name as one word.
  return (
    <p className="whitespace-nowrap">
      <span className={MICRO_LABEL}>Trading as</span> <span>{trader}</span>
    </p>
  )
}
