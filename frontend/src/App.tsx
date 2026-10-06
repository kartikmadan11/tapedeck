import type { ReactElement } from 'react'
import { useCallback, useId, useMemo, useState } from 'react'
import { ErrorNotice } from './components/ErrorNotice.js'
import { PanelSeparator } from './components/PanelSeparator.js'
import { RefreshButton } from './components/RefreshButton.js'
import type { RowActions } from './features/blotter/SelectionBar.js'
import { HistoryDrawer } from './features/history/HistoryDrawer.js'
import { IdentityBadge } from './features/identity/IdentityBadge.js'
import { useIdentity } from './features/identity/useIdentity.js'
import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  PANEL_WIDTH,
  PositionsPanel,
} from './features/positions/PositionsPanel.js'
import { useRealtime } from './features/realtime/useRealtime.js'
import { SimulationToggle } from './features/simulation/SimulationToggle.js'
import { AmendDialog } from './features/trades/AmendDialog.js'
import { CancelDialog } from './features/trades/CancelDialog.js'
import { TradeForm } from './features/trades/TradeForm.js'
import { useBlotter, usePendingTradeIds, useRefreshBlotter } from './features/trades/useTrades.js'
import { Workspace } from './features/workspace/Workspace.js'
import { CHIP, CHIP_ON } from './lib/ui.js'

/**
 * Optional, so the existing tests can render the blotter on its own without
 * standing a session up first. The Gate always passes it.
 */
type Props = { onSignOut?: (() => void) | undefined }

export function App({ onSignOut }: Props = {}): ReactElement {
  useRealtime()
  const blotter = useBlotter()
  const pendingIds = usePendingTradeIds()
  const refresh = useRefreshBlotter()
  const { trader } = useIdentity()

  const [amendingId, setAmendingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)

  const trades = blotter.data?.trades ?? []

  /**
   * Held as ids, not as rows, so a dialog always renders the cache's current
   * version of the trade. A held copy would confirm against a version that no
   * longer exists after someone else amended the same trade.
   */
  const amending = useMemo(
    () => trades.find((trade) => trade.tradeId === amendingId) ?? null,
    [trades, amendingId],
  )

  const cancelling = useMemo(
    () => trades.find((trade) => trade.tradeId === cancellingId) ?? null,
    [trades, cancellingId],
  )

  const actions: RowActions = useMemo(
    () => ({
      onAmend: (trade) => setAmendingId(trade.tradeId),
      onHistory: (trade) => setHistoryId(trade.tradeId),
      // Opens the confirmation rather than writing. The mutation lives in the
      // dialog, which is also where its error belongs.
      onCancel: (trade) => setCancellingId(trade.tradeId),
    }),
    [],
  )

  /**
   * How much of the width the positions panel is holding. Here rather than in
   * the panel, because the blotter beside it is the other half of the same
   * boundary and takes whatever this leaves. Deliberately not persisted.
   */
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH)

  /** On by default: net exposure is the reason to keep a blotter open, so hiding
   *  it is the deliberate act. Not persisted, so a reload gives it back. */
  const [positionsOpen, setPositionsOpen] = useState(true)
  const positionsId = useId()

  const closeAmend = useCallback(() => setAmendingId(null), [])
  const closeCancel = useCallback(() => setCancellingId(null), [])
  const closeHistory = useCallback(() => setHistoryId(null), [])

  return (
    // A blotter owns the viewport: the panes scroll, the page does not. Both
    // dialogs are position:fixed with no transformed ancestor, so clamping here
    // cannot clip them.
    <div className="flex h-screen flex-col gap-2 overflow-hidden bg-tape-bg p-3 text-tape-text">
      <header className="flex items-baseline gap-3 border-b border-tape-line pb-2">
        <h1 className="text-sm font-semibold uppercase tracking-[0.2em]">tapedeck</h1>
        <div className="ml-auto flex items-center gap-2">
          {/* A disclosure, so the label names the thing and the accent border
            says it is showing. aria-controls only while the panel is mounted:
            it has to name an element that is there. */}
          <button
            aria-controls={positionsOpen ? positionsId : undefined}
            aria-expanded={positionsOpen}
            className={positionsOpen ? CHIP_ON : CHIP}
            onClick={() => setPositionsOpen((open) => !open)}
            type="button"
          >
            Positions
          </button>
          <SimulationToggle />
          <RefreshButton onRefresh={refresh} refreshing={blotter.isFetching} />
          <IdentityBadge trader={trader} />
          {onSignOut === undefined ? null : (
            <button className={CHIP} onClick={onSignOut} type="button">
              Log out
            </button>
          )}
        </div>
      </header>

      <TradeForm trader={trader} />

      {blotter.error ? <ErrorNotice error={blotter.error} /> : null}

      {/* No gap: the handle between them is the gap, so the boundary a pointer
        aims at is the line that divides the two. */}
      <div className="flex min-h-0 flex-1">
        <Workspace trades={trades} pendingIds={pendingIds} actions={actions} />
        {/* The handle goes with the panel: it resizes its own next sibling, so
          one left behind would drag whatever took the panel's place. */}
        {positionsOpen ? (
          <>
            <PanelSeparator
              label="Resize the positions panel"
              max={PANEL_MAX_WIDTH}
              min={PANEL_MIN_WIDTH}
              onResize={setPanelWidth}
              width={panelWidth}
            />
            <PositionsPanel id={positionsId} width={panelWidth} />
          </>
        ) : null}
      </div>

      {amending ? <AmendDialog trade={amending} onClose={closeAmend} /> : null}
      {cancelling ? <CancelDialog trade={cancelling} onClose={closeCancel} /> : null}
      {historyId ? <HistoryDrawer tradeId={historyId} onClose={closeHistory} /> : null}
    </div>
  )
}
