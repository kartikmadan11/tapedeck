import type { ReactElement } from 'react'
import type { ConnectionStatus } from '../features/realtime/useRealtime.js'

type Props = { status: ConnectionStatus; cursor: number }

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
}

const TONES: Record<ConnectionStatus, string> = {
  connecting: 'border-tape-muted text-tape-muted',
  live: 'border-tape-buy text-tape-buy',
  reconnecting: 'border-tape-sell text-tape-sell',
}

/**
 * Shows the cursor as well as the state, because the cursor is the thing that
 * makes a reconnect safe: watching it resume where it left off is the visible
 * part of the resync contract.
 */
export function ConnectionBadge({ status, cursor }: Props): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 ${TONES[status]}`}
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full bg-current ${status === 'live' ? '' : 'animate-pulse'}`}
      />
      {LABELS[status]}
      <span className="text-tape-muted">seq {cursor}</span>
    </span>
  )
}
