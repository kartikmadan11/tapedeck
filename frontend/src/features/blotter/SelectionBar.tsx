import type { Trade } from '@tapedeck/shared'
import { formatDecimal } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { formatQuantity } from '../../lib/format.js'
import { CHIP, MICRO_LABEL } from '../../lib/ui.js'

export type RowActions = {
  onAmend: (trade: Trade) => void
  onCancel: (trade: Trade) => void
  onHistory: (trade: Trade) => void
}

type Props = {
  trade: Trade | null
  pending: boolean
  actions: RowActions
  /** What the bar says while nothing is picked. The pane counts its own rows. */
  count: string
}

/** No amend or cancel on a cancelled trade, or while its own write is in flight.
 *  Exported so the keys and the menu enforce the same rule as the buttons. */
export function canWrite(trade: Trade, pending: boolean): boolean {
  return trade.status !== 'CANCELLED' && !pending
}

/** The selected trade and its actions, or the pane's row count while nothing is
 *  picked. Always rendered, so picking a row does not resize the grid above it. */
export function SelectionBar({ trade, pending, actions, count }: Props): ReactElement {
  if (trade === null) {
    return (
      <div className={BAR}>
        {/* Empty, not absent: a live region has to exist before it has anything
          to say, or the first selection announces nothing. The count stays
          outside it, since rows arrive every two seconds. */}
        <output />
        <span className={MICRO_LABEL}>{count}</span>
      </div>
    )
  }

  const writable = canWrite(trade, pending)

  return (
    <div className={BAR}>
      {/* One live region for the whole description, so a pick announces once
          rather than field by field. <output> for its default role=status. */}
      <output className="flex items-center gap-2">
        <span className="text-tape-muted">{trade.tradeId}</span>
        <span className={trade.side === 'BUY' ? 'text-tape-buy' : 'text-tape-sell'}>
          {trade.side}
        </span>
        <span className="tabular-nums">{formatQuantity(trade.quantity)}</span>
        <span className="font-semibold">{trade.symbol}</span>
        <span className="text-tape-muted">@</span>
        <span className="tabular-nums">{formatDecimal(trade.price, 4)}</span>
        {trade.status === 'CANCELLED' ? (
          <span className={`${MICRO_LABEL} text-tape-sell`}>cancelled</span>
        ) : null}
      </output>

      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className={CHIP}
          disabled={!writable}
          onClick={() => actions.onAmend(trade)}
        >
          Amend
          <Key>a</Key>
        </button>
        <button
          type="button"
          className={`${CHIP} hover:border-tape-sell hover:text-tape-sell`}
          disabled={!writable}
          onClick={() => actions.onCancel(trade)}
        >
          {pending ? 'Working' : 'Cancel'}
          <Key>c</Key>
        </button>
        <button type="button" className={CHIP} onClick={() => actions.onHistory(trade)}>
          History
          <Key>h</Key>
        </button>
      </span>
    </div>
  )
}

/** Matches the blotter's header band, so the grid sits between two 32px rails. */
const BAR =
  'mt-2 flex h-8 shrink-0 items-center gap-2 rounded-sm border border-tape-line bg-tape-panel px-2'

/** The shortcut on a button. aria-hidden keeps it out of the accessible name, so
 *  the button stays named `Amend`, not `Amend a`. */
function Key({ children }: { children: string }): ReactElement {
  return (
    <span aria-hidden="true" className="ml-1.5 normal-case text-tape-accent">
      {children}
    </span>
  )
}
