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
import { CHIP, HANDLE_PX } from './lib/ui.js'

/**
 * Optional, so the existing tests can render the blotter on its own without
 * standing a session up first. The Gate always passes it.
 */
type Props = { onSignOut?: (() => void) | undefined }

/**
 * The panel's own control, in the corner of the panel's own header band.
 *
 * Laid over the frame rather than placed in it: a column of its own was a full
 * screen height of nothing holding one arrow. Outside the drawer, because it is
 * the only way back once the panel has gone, and in the same corner in both
 * states, so the arrow that sends the panel away is the arrow that returns it.
 */
const TAB =
  'absolute top-1.5 right-1.5 z-20 flex h-5 w-5 cursor-pointer items-center justify-center rounded-xs border border-tape-line bg-tape-panel text-tape-muted transition-colors duration-100 hover:border-tape-accent hover:text-tape-accent focus-visible:border-tape-focus focus-visible:outline-none'

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

  const showPositions = useCallback(() => setPositionsOpen(true), [])
  const closeAmend = useCallback(() => setAmendingId(null), [])
  const closeCancel = useCallback(() => setCancellingId(null), [])
  const closeHistory = useCallback(() => setHistoryId(null), [])

  return (
    // A blotter owns the viewport: the panes scroll, the page does not. Both
    // dialogs are position:fixed with no transformed ancestor, so clamping here
    // cannot clip them.
    <div className="flex h-screen flex-col gap-2 overflow-hidden bg-tape-bg p-3 text-tape-text">
      <header className="flex items-baseline gap-3 border-b border-tape-line pb-2">
        {/* The wordmark is the way back to a clean start: a reload keeps the
          address bar, so the workspace comes back and the socket, the cache and
          the panes are rebuilt from it. */}
        <h1 className="text-sm font-semibold uppercase tracking-[0.2em]">
          <button
            className="cursor-pointer tracking-[0.2em] hover:text-tape-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tape-focus"
            onClick={() => window.location.reload()}
            title="Reload"
            type="button"
          >
            tapedeck
          </button>
        </h1>
        <div className="ml-auto flex items-center gap-2">
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

      {/* overflow-hidden is what the panel slides out into. No gap between the
        tape and the panel: the handle between them is the gap, so the boundary a
        pointer aims at is the line that divides the two. relative for the tab
        below, which is laid over this corner rather than given a column. */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <Workspace
          trades={trades}
          pendingIds={pendingIds}
          actions={actions}
          // A reset is a clean start, and the panel is part of the frame the
          // panes sit in rather than one of the panes, so nothing inside the
          // workspace could put it back.
          onReset={showPositions}
        />

        {/*
         * The handle travels with the panel: it resizes its own next sibling, so
         * one left behind would drag whatever took the panel's place.
         *
         * Mounted in both states and moved rather than narrowed. A drag writes
         * the panel's width on every pointer move, so a width transition here
         * would make the panel chase the pointer; the margin gives the space
         * back to the tape and the drag never touches it. inert and aria-hidden
         * while it is off screen, because it still holds a handle and a scroller.
         */}
        <div
          aria-hidden={!positionsOpen}
          className="tape-drawer flex shrink-0"
          inert={!positionsOpen}
          style={{
            marginRight: positionsOpen ? 0 : -(panelWidth + HANDLE_PX),
            transform: positionsOpen ? 'translateX(0)' : 'translateX(100%)',
          }}
        >
          <PanelSeparator
            label="Resize the positions panel"
            max={PANEL_MAX_WIDTH}
            min={PANEL_MIN_WIDTH}
            onResize={setPanelWidth}
            width={panelWidth}
          />
          <PositionsPanel id={positionsId} width={panelWidth} />
        </div>

        {/* Named for the thing rather than the action, so aria-expanded carries
          the state and the name does not change under a screen reader. */}
        <button
          aria-controls={positionsId}
          aria-expanded={positionsOpen}
          aria-label="Positions"
          className={TAB}
          onClick={() => setPositionsOpen((open) => !open)}
          title={positionsOpen ? 'Hide positions' : 'Show positions'}
          type="button"
        >
          {positionsOpen ? '▸' : '◂'}
        </button>
      </div>

      {amending ? <AmendDialog trade={amending} onClose={closeAmend} /> : null}
      {cancelling ? <CancelDialog trade={cancelling} onClose={closeCancel} /> : null}
      {historyId ? <HistoryDrawer tradeId={historyId} onClose={closeHistory} /> : null}
    </div>
  )
}
