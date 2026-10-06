import type { Trade } from '@tapedeck/shared'
import { formatDecimal } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { formatQuantity } from '../../lib/format.js'
import { CHIP, MICRO_LABEL } from '../../lib/ui.js'

/** The three things that can be done to a row. */
export type RowActions = {
  onAmend: (trade: Trade) => void
  onCancel: (trade: Trade) => void
  onHistory: (trade: Trade) => void
}

type Props = {
  trade: Trade | null
  pending: boolean
  actions: RowActions
  /** What the bar says while nothing is picked, so the height it holds is never
   *  blank. The pane counts its own rows, so it supplies the line. */
  hint: string
}

/**
 * Amending and cancelling are refused on a cancelled trade, and while one of its
 * own writes is in flight. History is always available.
 *
 * Exported because the keyboard path has to enforce the same rule as the
 * buttons: a disabled button that a hotkey bypasses is worse than neither.
 */
export function canWrite(trade: Trade, pending: boolean): boolean {
  return trade.status !== 'CANCELLED' && !pending
}

/**
 * Reads back the selected trade and offers the actions for it, and says what the
 * pane is holding while nothing is picked.
 *
 * Always rendered, even with nothing selected, so the grid above it does not
 * resize every time a row is picked or dropped. That is why it carries the row
 * count: a bar that holds its height has to be worth the height it holds.
 */
export function SelectionBar({ trade, pending, actions, hint }: Props): ReactElement {
  if (trade === null) {
    return (
      <div className={BAR}>
        {/* Empty, not absent. The live region has to exist before it has
          anything to say or the first selection announces nothing, and the
          count stays outside it: rows arrive every two seconds, and a screen
          reader reading each new total is noise. */}
        <output />
        <span className={MICRO_LABEL}>{hint}</span>
      </div>
    )
  }

  const writable = canWrite(trade, pending)

  return (
    <div className={BAR}>
      {/* One live region holding the whole description, so picking a row
          announces the trade once rather than field by field. An <output> for
          the role=status it carries by default. */}
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

/**
 * The shortcut that reaches this button. aria-hidden is load-bearing: a hidden
 * subtree is excluded from the accessible name, so the button is still named
 * exactly `Amend` rather than `Amend a`. normal-case because the chip uppercases
 * its text.
 */
function Key({ children }: { children: string }): ReactElement {
  return (
    <span aria-hidden="true" className="ml-1.5 normal-case text-tape-accent">
      {children}
    </span>
  )
}
