import type { ReactElement } from 'react'
import type { ConnectionStatus } from '../features/realtime/useRealtime.js'

type Props = { status: ConnectionStatus; cursor: number }

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
}

const TONES: Record<ConnectionStatus, string> = {
  connecting: 'border-tape-line text-tape-muted',
  live: 'border-tape-buy/40 bg-tape-buy/10 text-tape-buy',
  reconnecting: 'border-tape-sell/40 bg-tape-sell/10 text-tape-sell',
}

/** Shows the cursor as well as the state, since the cursor is what makes a
 *  reconnect safe. */
export function ConnectionBadge({ status, cursor }: Props): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${TONES[status]}`}
      aria-live="polite"
    >
      {/*
       * Keyed on the cursor so the dot remounts when a sequenced frame lands,
       * which is what restarts the animation. An element rather than a text
       * node, so none of it is visible to a test reading the badge's label.
       */}
      <span
        key={cursor}
        aria-hidden="true"
        className={`size-1.5 rounded-full bg-current ${
          status === 'live' ? 'shadow-[0_0_6px_currentColor] tape-tick' : 'animate-pulse'
        }`}
      />
      {LABELS[status]}
      <span className="text-tape-muted">seq {cursor}</span>
    </span>
  )
}
