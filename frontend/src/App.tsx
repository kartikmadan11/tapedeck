import type { ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge.js'
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

export function App(): ReactElement {
  const { status } = useRealtime()
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

  /**
   * The nav's slot for the workspace's own controls, which the workspace fills
   * through a portal. Held as the element rather than looked up by id, because a
   * render is the wrong place to read the DOM and the node does not exist in the
   * first one.
   */
  const [nav, setNav] = useState<HTMLElement | null>(null)

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
          {/* display:contents, so an empty slot is not a gap in the row: what the
            workspace puts here is a flex item of this row, not of a wrapper. */}
          <div className="contents" ref={setNav} />
          <IdentityBadge trader={trader} />
          <SimulationToggle />
          <RefreshButton onRefresh={refresh} refreshing={blotter.isFetching} />
          <ConnectionBadge status={status} cursor={blotter.data?.seq ?? 0} />
        </div>
      </header>

      <TradeForm trader={trader} />

      {blotter.error ? <ErrorNotice error={blotter.error} /> : null}

      {/* No gap: the handle between them is the gap, so the boundary a pointer
        aims at is the line that divides the two. */}
      <div className="flex min-h-0 flex-1">
        <Workspace trades={trades} pendingIds={pendingIds} actions={actions} nav={nav} />
        <PanelSeparator
          label="Resize the positions panel"
          max={PANEL_MAX_WIDTH}
          min={PANEL_MIN_WIDTH}
          onResize={setPanelWidth}
          width={panelWidth}
        />
        <PositionsPanel width={panelWidth} />
      </div>

      {amending ? <AmendDialog trade={amending} onClose={closeAmend} /> : null}
      {cancelling ? <CancelDialog trade={cancelling} onClose={closeCancel} /> : null}
      {historyId ? <HistoryDrawer tradeId={historyId} onClose={closeHistory} /> : null}
    </div>
  )
}
