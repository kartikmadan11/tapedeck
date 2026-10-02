import { zodResolver } from '@hookform/resolvers/zod'
import type { CreateTradeInput } from '@tapedeck/shared'
import { createTradeInput } from '@tapedeck/shared'
import type { ReactElement, ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { ErrorNotice } from '../../components/ErrorNotice.js'
import { useCreateTrade } from './useCreateTrade.js'

/**
 * The form holds the schema's input type, not its output type. `price` is a
 * branded decimal on the way out and a plain string on the way in, which is
 * exactly the distinction the brand exists to draw.
 */
type FormValues = z.input<typeof createTradeInput>

/**
 * Prefilled so booking a trade in two side-by-side windows is one click, which is
 * the demonstration this project exists to give. Noted in the README.
 */
const DEFAULTS: FormValues = {
  symbol: 'VOD',
  side: 'BUY',
  quantity: 1_000,
  price: '72.500000',
  trader: 'k.madan',
  book: 'EQ-LDN-1',
  counterparty: 'GSIL',
}

export function TradeForm(): ReactElement {
  const create = useCreateTrade()

  const form = useForm<FormValues, unknown, CreateTradeInput>({
    // The server parses the same schema, so there is one definition of a valid
    // trade and the client cannot drift from it.
    resolver: zodResolver(createTradeInput),
    defaultValues: DEFAULTS,
  })

  const { errors } = form.formState

  const onSubmit = (values: CreateTradeInput): void => {
    create.mutate(values, {
      onSuccess: () => {
        // Keep the counterparty and book, clear nothing else: booking a run of
        // trades on the same book is the common case.
        form.reset({ ...values })
      },
    })
  }

  return (
    <form
      className="rounded border border-tape-line bg-tape-panel p-2"
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field name="symbol" label="Symbol" error={errors.symbol?.message} width="w-24">
          <input id="symbol" className={INPUT} {...form.register('symbol')} />
        </Field>

        <Field name="side" label="Side" error={errors.side?.message} width="w-24">
          <select id="side" className={INPUT} {...form.register('side')}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
        </Field>

        <Field name="quantity" label="Quantity" error={errors.quantity?.message} width="w-28">
          <input
            id="quantity"
            className={`${INPUT} text-right tabular-nums`}
            inputMode="numeric"
            {...form.register('quantity', { valueAsNumber: true })}
          />
        </Field>

        <Field name="price" label="Price" error={errors.price?.message} width="w-28">
          <input
            id="price"
            className={`${INPUT} text-right tabular-nums`}
            inputMode="decimal"
            {...form.register('price')}
          />
        </Field>

        <Field name="trader" label="Trader" error={errors.trader?.message} width="w-32">
          <input id="trader" className={INPUT} {...form.register('trader')} />
        </Field>

        <Field name="book" label="Book" error={errors.book?.message} width="w-32">
          <input id="book" className={INPUT} {...form.register('book')} />
        </Field>

        <Field
          name="counterparty"
          label="Counterparty"
          error={errors.counterparty?.message}
          width="w-32"
        >
          <input id="counterparty" className={INPUT} {...form.register('counterparty')} />
        </Field>

        <button
          type="submit"
          className="rounded border border-tape-accent px-3 py-1 font-semibold text-tape-accent hover:bg-tape-accent/15 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={create.isPending}
        >
          {create.isPending ? 'Booking' : 'Book trade'}
        </button>
      </div>

      {create.error ? <ErrorNotice error={create.error} className="mt-2" /> : null}
    </form>
  )
}

const INPUT =
  'w-full rounded border border-tape-line bg-tape-bg px-2 py-1 focus:border-tape-accent focus:outline-none'

type FieldProps = {
  name: string
  label: string
  error?: string | undefined
  width: string
  children: ReactNode
}

/** htmlFor rather than wrapping, so the association is checkable by a linter. */
function Field({ name, label, error, width, children }: FieldProps): ReactElement {
  return (
    <div className={`${width} block`}>
      <label htmlFor={name} className="mb-0.5 block text-tape-muted">
        {label}
      </label>
      {children}
      {error ? <span className="mt-0.5 block text-tape-sell">{error}</span> : null}
    </div>
  )
}
