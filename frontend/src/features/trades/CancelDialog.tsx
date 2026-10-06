import type { Trade } from '@tapedeck/shared'
import { formatDecimal } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { ErrorNotice } from '../../components/ErrorNotice.js'
import { CHIP } from '../../lib/ui.js'
import { useCancelTrade } from './useCancelTrade.js'

type Props = { trade: Trade; onClose: () => void }

/**
 * Confirms a cancellation. Cancelling is irreversible and rows reorder
 * underneath the pointer as the feed runs, so the protection is naming the
 * trade rather than the extra click.
 */
export function CancelDialog({ trade, onClose }: Props): ReactElement {
  const cancel = useCancelTrade()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const onConfirm = (): void => {
    // The version is read at the moment of confirming, from the cache-resolved
    // trade, so a cancel racing someone else's amend is still refused rather
    // than silently applied to a row that has since moved on.
    cancel.mutate({ tradeId: trade.tradeId, version: trade.version }, { onSuccess: onClose })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tape-bg/80 p-4">
      {/* Shadow rather than backdrop-blur, for the containing-block reason
          documented on the amend dialog. */}
      <div className="w-full max-w-md rounded-sm border border-tape-line bg-tape-panel p-4 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.9)]">
        <h2 className="mb-3 text-sm font-semibold">Cancel {trade.tradeId}?</h2>

        <p className="text-tape-muted">
          <span className={trade.side === 'BUY' ? 'text-tape-buy' : 'text-tape-sell'}>
            {trade.side}
          </span>{' '}
          <span className="tabular-nums text-tape-text">
            {trade.quantity.toLocaleString('en-GB')}
          </span>{' '}
          <span className="text-tape-text">{trade.symbol}</span> at{' '}
          <span className="tabular-nums text-tape-text">{formatDecimal(trade.price, 4)}</span> with{' '}
          {trade.counterparty}
        </p>

        <p className="mt-2 text-tape-muted">
          The trade stays on the blotter, struck through, and its history is kept. It cannot be
          reinstated.
        </p>

        {cancel.error ? <ErrorNotice error={cancel.error} className="mt-2" /> : null}

        <footer className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="ml-auto h-7 cursor-pointer rounded-xs border border-tape-sell/50 bg-tape-sell/15 px-3 font-semibold uppercase tracking-[0.1em] text-tape-sell transition-colors duration-100 hover:bg-tape-sell/25 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onConfirm}
            disabled={cancel.isPending}
          >
            {cancel.isPending ? 'Cancelling' : 'Cancel trade'}
          </button>

          <button type="button" className={CHIP} onClick={onClose}>
            Keep it
          </button>
        </footer>
      </div>
    </div>
  )
}
