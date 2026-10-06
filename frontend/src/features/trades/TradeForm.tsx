import { zodResolver } from '@hookform/resolvers/zod'
import type { CreateTradeInput } from '@tapedeck/shared'
import { BOOKS, COUNTERPARTIES, createTradeInput } from '@tapedeck/shared'
import type { ReactElement, ReactNode } from 'react'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import { ErrorNotice } from '../../components/ErrorNotice.js'
import { DEFAULT_TRADER } from '../../lib/identity.js'
import { ACTION, ACTION_HELD, CONTROL, MICRO_LABEL } from '../../lib/ui.js'
import type { Guard, LastBooking } from './guards.js'
import { CONFIRM_LABEL, guardFor, newTicketId, signatureOf } from './guards.js'
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
  trader: DEFAULT_TRADER,
  // Off the head of each list, not written out, so a default cannot be a value
  // its picklist does not offer.
  book: BOOKS[0],
  counterparty: COUNTERPARTIES[0],
}

/**
 * `trader` has no input of its own. It is the window's identity, so typing it
 * here as well would be a second source of truth that could disagree with the
 * actor stamped on the event.
 */
type Props = { trader: string }

export function TradeForm({ trader }: Props): ReactElement {
  const create = useCreateTrade()

  const form = useForm<FormValues, unknown, CreateTradeInput>({
    // The server parses the same schema, so there is one definition of a valid
    // trade and the client cannot drift from it.
    resolver: zodResolver(createTradeInput),
    defaultValues: DEFAULTS,
  })

  const { errors } = form.formState

  /**
   * One idempotency key per ticket, re-minted once a booking succeeds.
   *
   * A failed attempt keeps its key, so retrying it cannot double-book even if
   * the first request committed and only the response was lost. A success
   * replaces it, so a deliberate second clip is a second trade rather than a
   * silent replay of the first, and working an order in slices still works.
   *
   * A ref, not state: nothing renders from it, and a re-render per booking is a
   * re-render of the form over the tape.
   */
  const ticketId = useRef(newTicketId())
  const lastBooked = useRef<LastBooking | null>(null)
  const [guard, setGuard] = useState<Guard | null>(null)

  const onSubmit = (values: CreateTradeInput): void => {
    const raised = guardFor(values, lastBooked.current)

    // A guard already showing for this exact ticket has been read, so this press
    // is the confirmation it asked for. Comparing signatures rather than trusting
    // that the guard was cleared is what makes that safe: if the ticket changed
    // since the guard went up, this is a first press of something else.
    if (raised !== null && raised.signature !== guard?.signature) {
      setGuard(raised)
      return
    }

    setGuard(null)
    create.mutate(
      { ...values, trader, clientTradeId: ticketId.current },
      {
        onSuccess: (booked) => {
          lastBooked.current = {
            signature: signatureOf(values),
            tradeId: booked.tradeId,
            at: Date.now(),
          }
          ticketId.current = newTicketId()
          // Keep the counterparty and book, clear nothing else: booking a run of
          // trades on the same book is the common case.
          form.reset({ ...values })
        },
      },
    )
  }

  return (
    <form
      className="rounded-sm border border-tape-line bg-tape-panel p-3"
      onSubmit={form.handleSubmit(onSubmit)}
      /**
       * Drops a held press the moment the ticket is edited, so the button cannot
       * sit there asking to confirm something that is no longer on screen. This
       * is about the label only, since onSubmit re-derives the guard anyway, and
       * the condition keeps it from setting state on every keystroke.
       */
      onChange={() => {
        if (guard !== null) {
          setGuard(null)
        }
      }}
      noValidate
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field name="symbol" label="Symbol" error={errors.symbol?.message} width="w-24">
          <input id="symbol" className={INPUT} {...form.register('symbol')} />
        </Field>

        <Field name="side" label="Side" error={errors.side?.message} width="w-24">
          <select id="side" className={`${INPUT} cursor-pointer`} {...form.register('side')}>
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

        {/* A picklist for the reason the counterparty is: a book owns the
            position, so a near miss opens a second book rather than failing. */}
        <Field name="book" label="Book" error={errors.book?.message} width="w-36">
          <select id="book" className={`${INPUT} cursor-pointer`} {...form.register('book')}>
            {BOOKS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>

        {/* A picklist, not a text box. A counterparty is resolved from a
            counterparty master at booking, so there is nothing to type: `UBSf`
            passes every length check, then fails enrichment and drops the trade
            into a repair queue. */}
        <Field
          name="counterparty"
          label="Counterparty"
          error={errors.counterparty?.message}
          width="w-40"
        >
          <select
            id="counterparty"
            className={`${INPUT} cursor-pointer`}
            {...form.register('counterparty')}
          >
            {COUNTERPARTIES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>

        {/* One button, three labels. A separate confirm button would have to
            appear from nowhere and would move the one the hand is already on. */}
        <button
          type="submit"
          className={guard === null ? ACTION : ACTION_HELD}
          disabled={create.isPending}
        >
          {create.isPending ? 'Booking' : guard === null ? 'Book trade' : CONFIRM_LABEL[guard.kind]}
        </button>
      </div>

      {/* role="alert", so the reason is announced rather than only seen: the
          button's label changing is not something a screen reader reports. */}
      {guard === null ? null : (
        <p className="mt-2 text-[11px] text-tape-warn" role="alert">
          {guard.message}
        </p>
      )}

      {create.error ? <ErrorNotice error={create.error} className="mt-2" /> : null}
    </form>
  )
}

/** Darker than the panel it sits on, the inverse of the filter bar's controls,
 *  which sit on the canvas and so are lighter than it. */
const INPUT = `${CONTROL} w-full bg-tape-bg`

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
      <label htmlFor={name} className={`mb-1 block ${MICRO_LABEL}`}>
        {label}
      </label>
      {children}
      {error ? <span className="mt-1 block text-[10px] text-tape-sell">{error}</span> : null}
    </div>
  )
}
