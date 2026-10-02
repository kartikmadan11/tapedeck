import { zodResolver } from '@hookform/resolvers/zod'
import type { Trade } from '@tapedeck/shared'
import { amendTradeInput, formatDecimal } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { ErrorNotice } from '../../components/ErrorNotice.js'
import { ApiRequestError } from '../../lib/api.js'
import { useAmendTrade } from './useAmendTrade.js'

/**
 * The shared amend contract minus the concurrency token, which is not something
 * the user types. Amending `symbol` or `side` is not expressible here because it
 * is not expressible in the contract.
 */
const amendFields = amendTradeInput.omit({ version: true })
type FormValues = z.input<typeof amendFields>

type Props = { trade: Trade; onClose: () => void }

export function AmendDialog({ trade, onClose }: Props): ReactElement {
  const amend = useAmendTrade()

  /**
   * The version the user opened, held deliberately rather than read live from the
   * cache. Resubmitting with whatever version has since arrived would quietly
   * overwrite someone else's change, which is the exact failure optimistic
   * concurrency exists to surface.
   */
  const [editingVersion, setEditingVersion] = useState(trade.version)

  const form = useForm<FormValues, unknown, z.output<typeof amendFields>>({
    resolver: zodResolver(amendFields),
    defaultValues: {
      quantity: trade.quantity,
      price: trade.price,
      counterparty: trade.counterparty,
    },
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

  const conflicted =
    amend.error instanceof ApiRequestError && amend.error.payload.code === 'VERSION_CONFLICT'

  const adoptCurrent = (): void => {
    setEditingVersion(trade.version)
    form.reset({
      quantity: trade.quantity,
      price: trade.price,
      counterparty: trade.counterparty,
    })
    amend.reset()
  }

  const onSubmit = (values: z.output<typeof amendFields>): void => {
    amend.mutate(
      { tradeId: trade.tradeId, input: { ...values, version: editingVersion } },
      { onSuccess: onClose },
    )
  }

  const { errors } = form.formState

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tape-bg/80 p-4">
      <form
        className="w-full max-w-md rounded border border-tape-line bg-tape-panel p-3"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
      >
        <header className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">
            Amend {trade.tradeId}
            <span className="ml-2 text-tape-muted">
              {trade.side} {trade.symbol}
            </span>
          </h2>
          <span className="text-tape-muted">editing version {editingVersion}</span>
        </header>

        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="mb-0.5 block text-tape-muted">Quantity</span>
            <input
              className={`${INPUT} text-right tabular-nums`}
              inputMode="numeric"
              {...form.register('quantity', { valueAsNumber: true })}
            />
            {errors.quantity ? <Hint>{errors.quantity.message}</Hint> : null}
          </label>

          <label className="block">
            <span className="mb-0.5 block text-tape-muted">Price</span>
            <input
              className={`${INPUT} text-right tabular-nums`}
              inputMode="decimal"
              {...form.register('price')}
            />
            {errors.price ? <Hint>{errors.price.message}</Hint> : null}
          </label>

          <label className="block">
            <span className="mb-0.5 block text-tape-muted">Counterparty</span>
            <input className={INPUT} {...form.register('counterparty')} />
            {errors.counterparty ? <Hint>{errors.counterparty.message}</Hint> : null}
          </label>
        </div>

        {amend.error ? <ErrorNotice error={amend.error} className="mt-2" /> : null}

        <footer className="mt-3 flex items-center gap-2">
          {conflicted ? (
            <button
              type="button"
              className="rounded border border-tape-accent px-2 py-1 text-tape-accent hover:bg-tape-accent/15"
              onClick={adoptCurrent}
            >
              Load version {trade.version} ({formatQuantityHint(trade)})
            </button>
          ) : null}

          <button
            type="submit"
            className="ml-auto rounded border border-tape-accent px-3 py-1 font-semibold text-tape-accent hover:bg-tape-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={amend.isPending}
          >
            {amend.isPending ? 'Saving' : 'Save amendment'}
          </button>

          <button
            type="button"
            className="rounded border border-tape-line px-3 py-1 hover:border-tape-text"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </form>
    </div>
  )
}

const INPUT =
  'w-full rounded border border-tape-line bg-tape-bg px-2 py-1 focus:border-tape-accent focus:outline-none'

function Hint({ children }: { children: string | undefined }): ReactElement {
  return <span className="mt-0.5 block text-tape-sell">{children}</span>
}

/** The current values, so adopting the newer version is an informed choice. */
function formatQuantityHint(trade: Trade): string {
  return `${trade.quantity} @ ${formatDecimal(trade.price, 4)}`
}
