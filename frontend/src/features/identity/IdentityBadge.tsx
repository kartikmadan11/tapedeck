import { PARTY_MAX_LENGTH } from '@tapedeck/shared'
import type { ReactElement } from 'react'

type Props = { trader: string; onChange: (trader: string) => void }

/**
 * In production the actor arrives from outside the application, injected by a
 * gateway that has already authenticated the user, and the application trusts
 * the edge. This stands in for that gateway: it names both the trader booked on
 * a new trade and the actor recorded against every event.
 */
export function IdentityPicker({ trader, onChange }: Props): ReactElement {
  return (
    <label htmlFor="identity" className="flex items-center gap-1.5 text-tape-muted">
      Trading as
      <input
        id="identity"
        className="w-32 rounded border border-tape-line bg-tape-panel px-2 py-0.5 text-tape-text focus:border-tape-accent focus:outline-none"
        value={trader}
        onChange={(event) => onChange(event.target.value)}
        // The identity does not pass through the form resolver, so this is where
        // the schema's bound is enforced before a write can be rejected for it.
        maxLength={PARTY_MAX_LENGTH}
      />
    </label>
  )
}
