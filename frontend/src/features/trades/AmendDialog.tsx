import { zodResolver } from '@hookform/resolvers/zod'
import type { Trade } from '@tapedeck/shared'
import { amendTradeInput, formatDecimal } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useEffect, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { ErrorNotice } from '../../components/ErrorNotice.js'
import { ApiRequestError } from '../../lib/api.js'
import { ACTION, CHIP, CONTROL, MICRO_LABEL } from '../../lib/ui.js'
import { BookedBy } from './BookedBy.js'
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

  /** Names the dialog off its own heading, rather than restating the heading. */
  const titleId = useId()

  /**
   * The version the user opened, held deliberately rather than read live from the
   * cache. Resubmitting with whatever version has since arrived would quietly
   * overwrite someone else's change.
   */
  const [editingVersion, setEditingVersion] = useState(trade.version)

  const form = useForm<FormValues, unknown, z.output<typeof amendFields>>({
    resolver: zodResolver(amendFields),
    defaultValues: {
      quantity: trade.quantity,
      price: trade.price,
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
      {/*
       * A cast shadow rather than a blur. backdrop-filter would establish a
       * containing block, and the scrim above is already fixed with no
       * transformed ancestor, which is what keeps it covering the viewport.
       *
       * The role is on the box rather than on the scrim, because the scrim is
       * the whole viewport and the dialog is not. No aria-modal: focus is not
       * trapped, so claiming a boundary would be claiming something untrue.
       */}
      <div
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-sm border border-tape-line bg-tape-panel p-4 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.9)]"
        role="dialog"
      >
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <header className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold" id={titleId}>
              Amend {trade.tradeId}
              <span className="ml-2 text-tape-muted">
                {trade.side} {trade.symbol}
              </span>
            </h2>
            <span className={MICRO_LABEL}>editing version {editingVersion}</span>
          </header>

          <BookedBy action="amendment" trader={trade.trader} />

          <div className="grid grid-cols-3 gap-2">
            {/* The label span is a sibling of the input, so the uppercase and the
                10px do not inherit into the field the user types in. */}
            <label className="block">
              <span className={`mb-1 block ${MICRO_LABEL}`}>Quantity</span>
              <input
                className={`${INPUT} text-right tabular-nums`}
                inputMode="numeric"
                {...form.register('quantity', { valueAsNumber: true })}
              />
              {errors.quantity ? <Hint>{errors.quantity.message}</Hint> : null}
            </label>

            <label className="block">
              <span className={`mb-1 block ${MICRO_LABEL}`}>Price</span>
              <input
                className={`${INPUT} text-right tabular-nums`}
                inputMode="decimal"
                {...form.register('price')}
              />
              {errors.price ? <Hint>{errors.price.message}</Hint> : null}
            </label>

            {/* Shown, not offered: who a trade is with is fixed at booking. A div
                rather than a label because there is no control to name. */}
            <div>
              <span className={`mb-1 block ${MICRO_LABEL}`}>Counterparty</span>
              <p className="h-7 truncate leading-7">{trade.counterparty}</p>
              <span className="mt-1 block text-[10px] text-tape-muted">
                Cancel and rebook to change
              </span>
            </div>
          </div>

          {amend.error ? <ErrorNotice error={amend.error} className="mt-2" /> : null}

          <footer className="mt-3 flex items-center gap-2">
            {conflicted ? (
              <button
                type="button"
                className="h-7 cursor-pointer rounded-xs border border-tape-accent px-2 text-tape-accent transition-colors duration-100 hover:bg-tape-accent/15"
                onClick={adoptCurrent}
              >
                Load version {trade.version} ({formatQuantityHint(trade)})
              </button>
            ) : null}

            <button type="submit" className={`ml-auto ${ACTION}`} disabled={amend.isPending}>
              {amend.isPending ? 'Saving' : 'Save amendment'}
            </button>

            <button type="button" className={CHIP} onClick={onClose}>
              Close
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

/** Darker than the dialog panel it sits on, as in the booking form. */
const INPUT = `${CONTROL} w-full bg-tape-bg`

function Hint({ children }: { children: string | undefined }): ReactElement {
  return <span className="mt-1 block text-[10px] text-tape-sell">{children}</span>
}

/** The current values, so adopting the newer version is an informed choice. */
function formatQuantityHint(trade: Trade): string {
  return `${trade.quantity} @ ${formatDecimal(trade.price, 4)}`
}
