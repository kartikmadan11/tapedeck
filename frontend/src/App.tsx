import type { ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { ConnectionBadge } from './components/ConnectionBadge.js'
import { ErrorNotice } from './components/ErrorNotice.js'
import { BlotterTable } from './features/blotter/BlotterTable.js'
import type { RowActions } from './features/blotter/columns.js'
import { HistoryDrawer } from './features/history/HistoryDrawer.js'
import { PositionsPanel } from './features/positions/PositionsPanel.js'
import { useRealtime } from './features/realtime/useRealtime.js'
import { AmendDialog } from './features/trades/AmendDialog.js'
import { TradeForm } from './features/trades/TradeForm.js'
import { useCancelTrade } from './features/trades/useCancelTrade.js'
import { useBlotter, usePendingTradeIds } from './features/trades/useTrades.js'

export function App(): ReactElement {
  const { status } = useRealtime()
  const blotter = useBlotter()
  const pendingIds = usePendingTradeIds()
  const cancel = useCancelTrade()

  const [amendingId, setAmendingId] = useState<string | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)

  const trades = blotter.data?.trades ?? []

  /**
   * Held as an id, not as a row, so the dialog always renders the cache's current
   * version of the trade. Holding a copy would let it show stale values after
   * someone else amended the same trade.
   */
  const amending = useMemo(
    () => trades.find((trade) => trade.tradeId === amendingId) ?? null,
    [trades, amendingId],
  )

  const actions: RowActions = useMemo(
    () => ({
      onAmend: (trade) => setAmendingId(trade.tradeId),
      onHistory: (trade) => setHistoryId(trade.tradeId),
      onCancel: (trade) => {
        cancel.mutate({ tradeId: trade.tradeId, version: trade.version })
      },
    }),
    [cancel],
  )

  const closeAmend = useCallback(() => setAmendingId(null), [])
  const closeHistory = useCallback(() => setHistoryId(null), [])

  return (
    <div className="flex h-screen flex-col gap-2 bg-tape-bg p-3 text-tape-text">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight">tapedeck</h1>
        <span className="text-tape-muted">equity trade blotter</span>
        <div className="ml-auto">
          <ConnectionBadge status={status} cursor={blotter.data?.seq ?? 0} />
        </div>
      </header>

      <TradeForm />

      {blotter.error ? <ErrorNotice error={blotter.error} /> : null}
      {cancel.error ? <ErrorNotice error={cancel.error} /> : null}

      <div className="flex min-h-0 flex-1 gap-2">
        <BlotterTable trades={trades} pendingIds={pendingIds} actions={actions} />
        <PositionsPanel />
      </div>

      {amending ? <AmendDialog trade={amending} onClose={closeAmend} /> : null}
      {historyId ? <HistoryDrawer tradeId={historyId} onClose={closeHistory} /> : null}
    </div>
  )
}
