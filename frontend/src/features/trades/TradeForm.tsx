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

/** The schema's input type, not its output type: `price` is a plain string on the
 *  way in and a branded decimal on the way out. */
type FormValues = z.input<typeof createTradeInput>

/** Prefilled so booking in two side-by-side windows is one click. See the README. */
const DEFAULTS: FormValues = {
  symbol: 'VOD',
  side: 'BUY',
  quantity: 1_000,
  price: '72.500000',
  trader: DEFAULT_TRADER,
  // Off the head of each list, so a default cannot be a value its picklist lacks.
  book: BOOKS[0],
  counterparty: COUNTERPARTIES[0],
}

/** The boxes someone types into, for the retraction below. Picklists are excluded:
 *  they cannot hold a value their own list does not offer. */
const TYPED = ['symbol', 'quantity', 'price'] as const

const isTyped = (name: string): name is (typeof TYPED)[number] =>
  TYPED.some((field) => field === name)

/** Built off the same const tuples the schema validates against, so a list cannot
 *  offer what a booking would reject. */
const SIDES: SelectOption[] = [
  { value: 'BUY', label: 'BUY' },
  { value: 'SELL', label: 'SELL' },
]
const BOOK_CHOICES: SelectOption[] = BOOKS.map((name) => ({ value: name, label: name }))
const COUNTERPARTY_CHOICES: SelectOption[] = COUNTERPARTIES.map((name) => ({
  value: name,
  label: name,
}))

/** `trader` has no input of its own: it is the window's identity, and a second
 *  source could disagree with the actor stamped on the event. */
type Props = { trader: string }

export function TradeForm({ trader }: Props): ReactElement {
  const create = useCreateTrade()

  const form = useForm<FormValues, unknown, CreateTradeInput>({
    // The server parses the same schema, so the client cannot drift from it.
    resolver: zodResolver(createTradeInput),
    defaultValues: DEFAULTS,
    // Not the onChange default: an empty box fails the instrument master too, so
    // revalidating per keystroke puts the complaint back under a box just emptied.
    reValidateMode: 'onSubmit',
  })

  const { errors } = form.formState

  /** One idempotency key per ticket. A failed attempt keeps its key, so a retry
   *  cannot double-book when the first request committed and only the response was
   *  lost. A success re-mints it, so a second clip is a second trade. */
  const ticketId = useRef(newTicketId())
  const lastBooked = useRef<LastBooking | null>(null)
  const [guard, setGuard] = useState<Guard | null>(null)

  const onSubmit = (values: CreateTradeInput): void => {
    const raised = guardFor(values, lastBooked.current)

    // A guard already showing for this exact ticket makes this press its
    // confirmation. Signatures are compared, because a changed ticket is a first
    // press of something else.
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
          // Values kept, not cleared: a run of trades on the same book is common.
          form.reset({ ...values })
        },
      },
    )
  }

  return (
    <form
      className="rounded-sm border border-tape-line bg-tape-panel p-3"
      onSubmit={form.handleSubmit(onSubmit)}
      /** An edit retracts the held press and the complaint on the box, so the
       *  button cannot ask to confirm a ticket no longer on screen. */
      onChange={(event) => {
        if (guard !== null) {
          setGuard(null)
        }

        // Checked before clearing: form state is emitted to every subscriber, so
        // an unconditional clear would emit on each keystroke.
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
        {/* A typeahead, not a select: a real master holds thousands of lines. */}
        <Field name="symbol" label="Symbol" error={errors.symbol?.message} width="w-24">
          <input
            id="symbol"
            autoComplete="off"
            className={INPUT}
            list="instruments"
            {...form.register('symbol')}
          />
        </Field>
        {/* Value is the ticker, label the name, so the list reads as a master. */}
        <datalist id="instruments">
          {INSTRUMENTS.map((instrument) => (
            <option key={instrument.symbol} value={instrument.symbol}>
              {instrument.name}
            </option>
          ))}
        </datalist>

        {/* Controller, not register: a button and a listbox fire no input change. */}
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

        {/* A picklist: a book owns the position, so a near miss on a typed name
            opens a second book rather than failing. */}
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

        {/* A picklist, not a text box: a counterparty is resolved from a master at
            booking, and `UBSf` passes every length check, then fails enrichment
            and drops the trade into a repair queue. */}
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

        {/* One button, three labels: a separate confirm would move the one the
            hand is already on. */}
        <button
          type="submit"
          className={guard === null ? ACTION : ACTION_HELD}
          disabled={create.isPending}
        >
          {create.isPending ? 'Booking' : guard === null ? 'Book trade' : CONFIRM_LABEL[guard.kind]}
        </button>
      </div>

      {/* role="alert": a screen reader does not report the button's label change. */}
      {guard === null ? null : (
        <p className="mt-2 text-[11px] text-tape-warn" role="alert">
          {guard.message}
        </p>
      )}

      {create.error ? <ErrorNotice error={create.error} className="mt-2" /> : null}
    </form>
  )
}

/** Darker than the panel it sits on, per the note in lib/ui.ts. */
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
