import { useQuery } from '@tanstack/react-query'
import type { Trade, TradeEvent } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { ErrorNotice } from '../../components/ErrorNotice.js'
import { fetchTradeEvents } from '../../lib/api.js'
import { formatDateTime } from '../../lib/format.js'
import { queryKeys } from '../../lib/queryClient.js'
import { CHIP, MICRO_LABEL } from '../../lib/ui.js'

type Props = { tradeId: string; onClose: () => void }

/**
 * The audit trail for one trade, read on demand rather than streamed: history is
 * looked at rarely and the rows never change once written.
 */
export function HistoryDrawer({ tradeId, onClose }: Props): ReactElement {
  const events = useQuery({
    queryKey: queryKeys.tradeEvents(tradeId),
    queryFn: () => fetchTradeEvents(tradeId),
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-[32rem] max-w-full flex-col border-l border-tape-line bg-tape-panel shadow-[-24px_0_64px_-12px_rgb(0_0_0/0.9)]">
      <header className="flex shrink-0 items-center justify-between border-b border-tape-line px-3 py-2">
        <h2 className="text-sm font-semibold">History of {tradeId}</h2>
        <button type="button" className={CHIP} onClick={onClose}>
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {events.isPending ? <p className="text-tape-muted">Loading history.</p> : null}
        {events.error ? <ErrorNotice error={events.error} /> : null}

        <ol className="flex flex-col gap-2">
          {(events.data ?? []).map((event) => (
            <EventCard key={event.seq} event={event} />
          ))}
        </ol>
      </div>

      <footer className="shrink-0 border-t border-tape-line px-3 py-2 text-[10px] leading-relaxed text-tape-muted">
        One row per mutation, so a trade's version is also its number of events. The same sequence
        numbers order the live stream.
      </footer>
    </div>
  )
}

function EventCard({ event }: { event: TradeEvent }): ReactElement {
  const changes = event.before === null ? [] : diff(event.before, event.after)

  return (
    <li className="rounded-sm border border-tape-line bg-tape-bg p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`font-semibold tracking-[0.1em] ${
            event.eventType === 'CANCELLED' ? 'text-tape-sell' : ''
          }`}
        >
          {event.eventType}
        </span>
        {/* Not MICRO_LABEL: this line carries an actor's name, and uppercasing
            someone's name is a different claim from styling a column label. */}
        <span className="text-[10px] text-tape-muted">
          seq {event.seq} · {formatDateTime(event.at)} · {event.actor}
        </span>
      </div>

      {event.before === null ? (
        <p className="mt-1 text-tape-muted">
          Booked {event.after.side} {event.after.quantity} {event.after.symbol} at{' '}
          {event.after.price} with {event.after.counterparty}.
        </p>
      ) : (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
          {changes.map((change) => (
            // items-baseline because the 10px label and the 13px values sit on
            // one line and would otherwise top-align against each other.
            <div key={change.field} className="col-span-2 flex items-baseline gap-2">
              <dt className={MICRO_LABEL}>{change.field}</dt>
              <dd>
                <span className="text-tape-muted line-through">{change.before}</span>
                <span className="mx-1">→</span>
                <span>{change.after}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}

/** The fields an amendment or a cancellation can move. */
const TRACKED = ['quantity', 'price', 'counterparty', 'status', 'version'] as const

type Change = { field: string; before: string; after: string }

/**
 * Computed here rather than stored, because the events hold whole snapshots. That
 * keeps the audit trail readable without replaying it and lets the display change
 * without a migration.
 */
function diff(before: Trade, after: Trade): Change[] {
  return TRACKED.filter((field) => before[field] !== after[field]).map((field) => ({
    field,
    before: String(before[field]),
    after: String(after[field]),
  }))
}
