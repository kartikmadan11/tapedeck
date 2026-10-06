import type { ReactElement } from 'react'

type Props = { trader: string }

/** Plain text, not a disabled input: the name stamped on an amend is not a
 *  choice. */
export function IdentityBadge({ trader }: Props): ReactElement {
  return <p className="whitespace-nowrap">{trader}</p>
}
