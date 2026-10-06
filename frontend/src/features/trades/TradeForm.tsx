import { zodResolver } from '@hookform/resolvers/zod'
import type { CreateTradeInput } from '@tapedeck/shared'
import { BOOKS, COUNTERPARTIES, createTradeInput, INSTRUMENTS } from '@tapedeck/shared'
import type { ReactElement, ReactNode } from 'react'
import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import type { z } from 'zod'
import { ErrorNotice } from '../../components/ErrorNotice.js'
import type { SelectOption } from '../../components/Select.js'
import { Select } from '../../components/Select.js'
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
 * The boxes someone types into, for the retraction below. A picklist is not one
 * of them: it cannot hold a value its own list does not offer.
 */
const TYPED = ['symbol', 'quantity', 'price'] as const

const isTyped = (name: string): name is (typeof TYPED)[number] =>
  TYPED.some((field) => field === name)

/** The three picklists, built once off the same const tuples the schema
 *  validates against, so a list cannot offer what a booking would reject. */
const SIDES: SelectOption[] = [
  { value: 'BUY', label: 'BUY' },
  { value: 'SELL', label: 'SELL' },
]
const BOOK_CHOICES: SelectOption[] = BOOKS.map((name) => ({ value: name, label: name }))
const COUNTERPARTY_CHOICES: SelectOption[] = COUNTERPARTIES.map((name) => ({
  value: name,
  label: name,
}))

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
    // A complaint is made on a press and retracted on an edit, rather than
    // re-made on every keystroke. The default, onChange, is what kept `not a
    // ticker on the instrument master` under a box someone had just emptied: an
    // empty box fails the master too, and revalidating put the message straight
    // back after the edit cleared it.
    reValidateMode: 'onSubmit',
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
       * An edit retracts what the form was saying about the ticket: the held
       * press, so the button cannot sit there asking to confirm something that is
       * no longer on screen, and the complaint on the box being edited. onSubmit
       * makes both again, so this is about what is on screen between presses.
       */
      onChange={(event) => {
        if (guard !== null) {
          setGuard(null)
        }

        // Read before it is cleared, for the same reason the guard is: form
        // state is emitted to everything subscribed to it, and an unconditional
        // clear would emit on every keystroke.
        const box = event.target
        if (
          box instanceof HTMLInputElement &&
          isTyped(box.name) &&
          errors[box.name] !== undefined
        ) {
          form.clearErrors(box.name)
        }
      }}
      noValidate
    >
      <div className="flex flex-wrap items-end gap-2">
        {/* A typeahead, not a select: a real master holds thousands of lines.
            The schema resolves against the same list either way. */}
        <Field name="symbol" label="Symbol" error={errors.symbol?.message} width="w-24">
          <input
            id="symbol"
            autoComplete="off"
            className={INPUT}
            list="instruments"
            {...form.register('symbol')}
          />
        </Field>
        {/* Value is the ticker, label is the name, so the list reads as a
            master rather than as twelve abbreviations. */}
        <datalist id="instruments">
          {INSTRUMENTS.map((instrument) => (
            <option key={instrument.symbol} value={instrument.symbol}>
              {instrument.name}
            </option>
          ))}
        </datalist>

        {/* Controller rather than register: the control is a button and a
            listbox, so there is no change event on an input to hook. */}
        <Field name="side" label="Side" error={errors.side?.message} width="w-24">
          <Controller
            control={form.control}
            name="side"
            render={({ field }) => (
              <Select
                className={INPUT}
                id="side"
                label="Side"
                onChange={field.onChange}
                options={SIDES}
                value={field.value}
              />
            )}
          />
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
          <Controller
            control={form.control}
            name="book"
            render={({ field }) => (
              <Select
                className={INPUT}
                id="book"
                label="Book"
                onChange={field.onChange}
                options={BOOK_CHOICES}
                value={field.value}
              />
            )}
          />
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
          <Controller
            control={form.control}
            name="counterparty"
            render={({ field }) => (
              <Select
                className={INPUT}
                id="counterparty"
                label="Counterparty"
                onChange={field.onChange}
                options={COUNTERPARTY_CHOICES}
                value={field.value}
              />
            )}
          />
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
