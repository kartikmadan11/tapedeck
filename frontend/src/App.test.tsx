import { QueryClientProvider } from '@tanstack/react-query'
import type { Position, ServerFrame, Trade } from '@tapedeck/shared'
import { position as positionSchema, trade as tradeSchema } from '@tapedeck/shared'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.js'
import { adoptIdentity } from './lib/identity.js'
import { createQueryClient } from './lib/queryClient.js'

function aTrade(overrides: Record<string, unknown> = {}): Trade {
  return tradeSchema.parse({
    tradeId: 'TRD-100001',
    symbol: 'VOD',
    side: 'BUY',
    quantity: 10_000,
    filledQuantity: 0,
    price: '72.465000',
    trader: 'k.madan',
    book: 'EQ-LDN-01',
    counterparty: 'GSIL',
    tradeTimestamp: '2026-10-02T09:15:00.000Z',
    status: 'NEW',
    version: 1,
    updatedAt: '2026-10-02T09:15:00.000Z',
    ...overrides,
  })
}

function aPosition(overrides: Record<string, unknown> = {}): Position {
  return positionSchema.parse({
    symbol: 'VOD',
    netQuantity: 10_000,
    boughtQuantity: 10_000,
    soldQuantity: 0,
    netNotional: '724650.000000',
    tradeCount: 1,
    ...overrides,
  })
}

/** Stands in for the browser's WebSocket so a frame can be delivered by hand. */
class FakeSocket {
  static instances: FakeSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null

  readonly url: string
  closed = false

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  close(): void {
    this.closed = true
  }

  static get live(): FakeSocket {
    const socket = FakeSocket.instances.at(-1)
    if (!socket) {
      throw new Error('nothing opened a socket')
    }
    return socket
  }
}

function open(): void {
  act(() => FakeSocket.live.onopen?.())
}

/** React Query flushes cache notifications on a timer that act() does not wait for,
 *  so assert what a frame changed with findBy or waitFor, not a straight read. */
function deliver(frame: ServerFrame): void {
  act(() => FakeSocket.live.onmessage?.({ data: JSON.stringify(frame) }))
}

const fetchMock = vi.fn()

const SIMULATION_INTERVAL_MS = 2_000

function respondWith(trades: Trade[], positions: Position[], seq: number, running = false): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    // Url before method: this endpoint is read and written, and a POST here does
    // not answer with a trade.
    if (url.startsWith('/api/simulation')) {
      const body = init?.body === undefined ? null : JSON.parse(init.body as string)
      return Promise.resolve(
        new Response(
          JSON.stringify({
            running: body === null ? running : body.running,
            intervalMs: SIMULATION_INTERVAL_MS,
          }),
          { status: 200 },
        ),
      )
    }

    // A write answers with the created trade, not a list, as the real API does.
    if (init?.method !== undefined) {
      return Promise.resolve(
        new Response(JSON.stringify(aTrade({ tradeId: 'TRD-100999' })), { status: 201 }),
      )
    }
    if (url.startsWith('/api/positions')) {
      return Promise.resolve(new Response(JSON.stringify({ seq, positions }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ seq, trades }), { status: 200 }))
  })
}

function lastWrite(): { actor: string; body: Record<string, unknown> } {
  const call = fetchMock.mock.calls.findLast((entry) => entry[1]?.method !== undefined)
  if (call === undefined) {
    throw new Error('nothing was written')
  }
  const init = call[1] as RequestInit
  const headers = init.headers as Record<string, string>
  return {
    actor: headers['x-tapedeck-actor'] ?? '',
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  }
}

function renderApp(): ReturnType<typeof createQueryClient> {
  const client = createQueryClient()
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return client
}

beforeEach(() => {
  // jsdom keeps sessionStorage for the whole file, so one test's identity would
  // otherwise decide the next test's actor.
  sessionStorage.clear()
  FakeSocket.instances = []
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('WebSocket', FakeSocket)
  respondWith([aTrade()], [aPosition()], 1)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A trade's row, by the id it carries: the Trade column is off by default. */
function row(tradeId: string): HTMLElement | null {
  return document.querySelector(`tr[data-trade-id="${tradeId}"]`)
}

function findRow(tradeId: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = row(tradeId)
    if (found === null) {
      throw new Error(`no row for ${tradeId}`)
    }
    return found
  })
}

/** Amend, cancel and history exist only once a row is picked. */
function selectRow(tradeId: string): void {
  const found = row(tradeId)
  if (found === null) {
    throw new Error(`no row for ${tradeId}`)
  }
  fireEvent.click(found)
}

describe('App', () => {
  it('paints the blotter and the positions panel from REST before the socket opens', async () => {
    renderApp()

    expect(await findRow('TRD-100001')).toBeInTheDocument()

    // Populated on first paint: the snapshot carries exposure as well as trades.
    // Scoped to the table, because the band under it restates the same figure.
    const rows = within(within(screen.getByRole('complementary')).getByRole('table'))
    expect(rows.getByText('VOD')).toBeInTheDocument()
    expect(rows.getByText('724,650.00')).toBeInTheDocument()
  })

  it('marks each position against its reference price and totals the book beneath', async () => {
    renderApp()
    await findRow('TRD-100001')

    const panel = within(screen.getByRole('complementary'))

    // VOD references 68.42, so 10,000 shares mark at 684,200 against 724,650 paid.
    expect(within(panel.getByRole('table')).getByText('-40,450.00')).toBeInTheDocument()

    expect(panel.getAllByRole('term').map((label) => label.textContent)).toEqual([
      'Gross',
      'Net',
      'P&L vs ref',
      'Trades',
    ])

    // One symbol, so the book agrees with the row above it digit for digit.
    expect(panel.getAllByRole('definition').map((figure) => figure.textContent)).toEqual([
      '724,650.00',
      '724,650.00',
      '-40,450.00',
      '1',
    ])
  })

  it('slides the positions panel off the screen with the boundary beside it', async () => {
    renderApp()
    await findRow('TRD-100001')

    const toggle = screen.getByRole('button', { name: 'Positions' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)

    // The handle goes with it: it resizes its next sibling, so one left behind
    // would have nothing on the far side.
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('separator', { name: 'Resize the positions panel' })).toBeNull()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // Still mounted so it slides, inert so the handle stays out of the tab order.
    expect(screen.getByRole('complementary', { hidden: true }).closest('[inert]')).not.toBeNull()

    fireEvent.click(toggle)
    expect(within(screen.getByRole('complementary')).getByText('VOD')).toBeInTheDocument()
  })

  it('brings the positions panel back on a reset, since a reset is a clean start', async () => {
    renderApp()
    await findRow('TRD-100001')

    fireEvent.click(screen.getByRole('button', { name: 'Positions' }))
    expect(screen.queryByRole('complementary')).toBeNull()

    // The panel is the frame the panes sit in, so nothing inside the workspace
    // could restore it.
    fireEvent.pointerDown(document.body)
    fireEvent.contextMenu(document.body)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset workspace' }))

    expect(within(screen.getByRole('complementary')).getByText('VOD')).toBeInTheDocument()
  })

  // jsdom cannot stub the reload, so this only holds that the wordmark is a control.
  it('offers the wordmark as the way back to a clean start', () => {
    renderApp()
    expect(screen.getByRole('button', { name: 'tapedeck' })).toHaveAttribute('title', 'Reload')
  })

  it('connects to the same origin it was served from', () => {
    renderApp()
    expect(FakeSocket.live.url).toBe(`ws://${window.location.host}/ws`)
  })

  it('shows a trade booked elsewhere, which is the headline requirement', async () => {
    renderApp()
    await findRow('TRD-100001')
    open()

    deliver({
      type: 'trade.created',
      seq: 2,
      trade: aTrade({
        tradeId: 'TRD-100002',
        symbol: 'HSBA',
        side: 'SELL',
        tradeTimestamp: '2026-10-02T11:00:00.000Z',
      }),
    })

    expect(await findRow('TRD-100002')).toBeInTheDocument()
  })

  it('strikes a row through when it is cancelled elsewhere rather than removing it', async () => {
    renderApp()
    await findRow('TRD-100001')
    open()

    deliver({
      type: 'trade.cancelled',
      seq: 2,
      trade: aTrade({ status: 'CANCELLED', version: 2, updatedAt: '2026-10-02T12:00:00.000Z' }),
    })

    expect(await screen.findByText('CANCELLED')).toBeInTheDocument()

    // A cancelled trade keeps its place, and the bar refuses to write to it.
    selectRow('TRD-100001')
    expect(screen.getByRole('button', { name: 'Amend' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    // History stays open, which is why a cancelled row is worth keeping.
    expect(screen.getByRole('button', { name: 'History' })).toBeEnabled()
  })

  it('updates exposure from a positions frame without advancing the cursor', async () => {
    renderApp()
    await findRow('TRD-100001')
    open()

    deliver({
      type: 'positions',
      positions: [aPosition({ netQuantity: 4_000, netNotional: '289860.000000' })],
    })

    const rows = within(screen.getByRole('complementary')).getByRole('table')
    expect(await within(rows).findByText('289,860.00')).toBeInTheDocument()

    // A positions frame carries no seq, and seq 2 is accepted only against a
    // cursor still on 1, so the row arriving is the proof.
    deliver({ type: 'trade.created', seq: 2, trade: aTrade({ tradeId: 'TRD-100002' }) })

    expect(await findRow('TRD-100002')).toBeInTheDocument()
  })

  it('keeps the rows it already has when the connection drops', async () => {
    renderApp()
    await findRow('TRD-100001')
    open()

    act(() => FakeSocket.live.onclose?.())

    // A drop is not a reason to blank the tape. Reconnecting is the resync.
    expect(row('TRD-100001')).not.toBeNull()
  })

  it('filters client-side, so clearing a filter needs no round trip', async () => {
    respondWith([aTrade(), aTrade({ tradeId: 'TRD-100002', symbol: 'HSBA' })], [], 2)
    renderApp()
    await findRow('TRD-100001')

    const callsBefore = fetchMock.mock.calls.length

    fireEvent.change(screen.getByLabelText('Filter by symbol'), { target: { value: 'HSBA' } })

    expect(row('TRD-100001')).toBeNull()
    expect(row('TRD-100002')).not.toBeNull()
    expect(fetchMock.mock.calls).toHaveLength(callsBefore)
  })

  it('re-reads the API when refresh is pressed', async () => {
    renderApp()
    await findRow('TRD-100001')

    // A trade booked while the socket was down, so nothing but a re-read finds it.
    respondWith([aTrade(), aTrade({ tradeId: 'TRD-100002', symbol: 'HSBA' })], [aPosition()], 2)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await findRow('TRD-100002')).toBeInTheDocument()
  })

  it('books under the window identity and stamps the same name as the actor', async () => {
    // Handed over before the first render, the way it arrives in the app.
    window.history.replaceState(null, '', '/?actor=j.okonkwo')
    adoptIdentity()

    renderApp()
    await findRow('TRD-100001')

    fireEvent.click(screen.getByRole('button', { name: 'Book trade' }))

    await waitFor(() => {
      const write = lastWrite()
      expect(write.body.trader).toBe('j.okonkwo')
      expect(write.actor).toBe('j.okonkwo')
    })
  })

  it('states the identity rather than offering it', async () => {
    renderApp()
    await findRow('TRD-100001')

    // The header states the name and holds no box. Addressed off the title,
    // because every pane bar is a banner too.
    const header = screen.getByRole('heading', { name: 'tapedeck' }).closest('header')
    expect(header).toHaveTextContent('k.madan')
    expect(within(header as HTMLElement).queryByRole('textbox')).toBeNull()
  })
})

describe('the simulated feed control', () => {
  it('offers to pause a feed the server reports as running', async () => {
    respondWith([aTrade()], [aPosition()], 1, true)
    renderApp()

    // Read over REST on load, so a client arriving mid-feed does not guess it is off.
    expect(await screen.findByRole('button', { name: 'Pause feed' })).toBeInTheDocument()
  })

  it('asks the server to stop the feed when pressed', async () => {
    respondWith([aTrade()], [aPosition()], 1, true)
    renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'Pause feed' }))

    await waitFor(() => {
      expect(lastWrite().body).toEqual({ running: false })
    })
    expect(await screen.findByRole('button', { name: 'Start feed' })).toBeInTheDocument()
  })

  it('follows a toggle made in another window', async () => {
    renderApp()
    expect(await screen.findByRole('button', { name: 'Start feed' })).toBeInTheDocument()
    open()

    deliver({ type: 'simulation', running: true, intervalMs: SIMULATION_INTERVAL_MS })

    // Without the broadcast this client reads 'Start feed' while trades arrive.
    expect(await screen.findByRole('button', { name: 'Pause feed' })).toBeInTheDocument()
  })

  it('does not let a simulation frame disturb the blotter or its cursor', async () => {
    renderApp()
    await findRow('TRD-100001')
    open()

    deliver({ type: 'simulation', running: true, intervalMs: SIMULATION_INTERVAL_MS })

    await screen.findByRole('button', { name: 'Pause feed' })
    expect(row('TRD-100001')).not.toBeNull()

    // An unsequenced frame must not advance the cursor, or the client discards
    // the trade frames the feed is about to produce.
    deliver({ type: 'trade.created', seq: 2, trade: aTrade({ tradeId: 'TRD-100002' }) })

    expect(await findRow('TRD-100002')).toBeInTheDocument()
  })
})

describe('booking guards', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  /** The bodies of the bookings only, so the simulation writes are not counted. */
  function bookings(): Record<string, unknown>[] {
    return fetchMock.mock.calls
      .filter((entry) => entry[0] === '/api/trades' && entry[1]?.method !== undefined)
      .map((entry) => JSON.parse((entry[1] as RequestInit).body as string))
  }

  function book(label = 'Book trade'): void {
    fireEvent.click(screen.getByRole('button', { name: label }))
  }

  /** The ticket's box, not the config panel's Quantity column checkbox: same label
   *  text, and mounted even while the panel is shut. */
  function quantity(): HTMLElement {
    return screen.getByLabelText('Quantity', { selector: '#quantity' })
  }

  /** The ticket's box, for the same reason the quantity helper exists. */
  function symbol(): HTMLElement {
    return screen.getByLabelText('Symbol', { selector: '#symbol' })
  }

  async function ready(): Promise<void> {
    renderApp()
    await findRow('TRD-100001')
  }

  it('holds a repeat of the ticket it just booked, and books it when confirmed', async () => {
    await ready()

    book()
    await waitFor(() => expect(bookings()).toHaveLength(1))

    // The form keeps the ticket it just sent, so a second press is the accident.
    book()
    expect(await screen.findByRole('button', { name: 'Confirm duplicate' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Identical to TRD-100999, booked 0\.\ds ago/,
    )
    expect(bookings()).toHaveLength(1)

    book('Confirm duplicate')
    await waitFor(() => expect(bookings()).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Book trade' })).toBeInTheDocument()
  })

  it('holds an oversized ticket until the size is confirmed', async () => {
    await ready()

    // One extra zero on the prefilled 1,000: 725,000 against the 250,000 limit.
    fireEvent.change(quantity(), { target: { value: '10000' } })
    book()

    expect(await screen.findByRole('button', { name: 'Confirm size' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      '725,000.00 is over the 250,000 booking limit',
    )
    expect(bookings()).toEqual([])
  })

  it('drops a held press when the ticket is edited, rather than confirming the old one', async () => {
    await ready()

    fireEvent.change(quantity(), { target: { value: '10000' } })
    book()
    await screen.findByRole('button', { name: 'Confirm size' })

    // Back under the limit, so the reason the press was held no longer applies.
    fireEvent.change(quantity(), { target: { value: '1000' } })

    expect(await screen.findByRole('button', { name: 'Book trade' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('takes the complaint off a box that is being edited, and makes it again on the press', async () => {
    const MASTER = 'not a ticker on the instrument master'
    await ready()

    fireEvent.change(symbol(), { target: { value: 'NOPE' } })
    book()
    expect(await screen.findByText(MASTER)).toBeInTheDocument()

    // An empty box fails the instrument master too, so revalidating per keystroke
    // puts the message straight back under a box just emptied.
    fireEvent.change(symbol(), { target: { value: '' } })

    // Settled, not momentarily gone: validation is async, so a poll could pass in
    // the gap between the edit clearing the message and revalidation restoring it.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.queryByText(MASTER)).toBeNull()

    // Retracted, not withdrawn: the press still refuses the empty ticket.
    book()
    expect(await screen.findByText(MASTER)).toBeInTheDocument()
    expect(bookings()).toEqual([])
  })

  it('sends an idempotency key, minted fresh for each booking', async () => {
    await ready()

    book()
    await waitFor(() => expect(bookings()).toHaveLength(1))
    book()
    await screen.findByRole('button', { name: 'Confirm duplicate' })
    book('Confirm duplicate')
    await waitFor(() => expect(bookings()).toHaveLength(2))

    const keys = bookings().map((body) => body.clientTradeId)
    for (const key of keys) {
      expect(key).toMatch(UUID)
    }
    // A reused key would make the second clip a silent replay and lose a booking.
    expect(new Set(keys).size).toBe(2)
  })
})

describe('cancelling a trade', () => {
  async function openCancelDialog(): Promise<void> {
    renderApp()
    await findRow('TRD-100001')
    selectRow('TRD-100001')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  }

  it('confirms against the trade rather than cancelling on the first click', async () => {
    await openCancelDialog()

    // With rows arriving on their own, one-click Cancel lands on the wrong trade.
    expect(await screen.findByText('Cancel TRD-100001?')).toBeInTheDocument()
    expect(() => lastWrite()).toThrow(/nothing was written/)
  })

  it('keeps the row selected while its confirmation is over the tape', async () => {
    await openCancelDialog()
    const dialog = await screen.findByRole('dialog')

    // A pane drops its selection on a press elsewhere, so without the distinction
    // confirming would deselect the trade the dialog names.
    fireEvent.pointerDown(dialog)

    expect(screen.getByRole('status')).toHaveTextContent('TRD-100001')
  })

  it('writes nothing when the confirmation is dismissed', async () => {
    await openCancelDialog()
    await screen.findByText('Cancel TRD-100001?')

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))

    await waitFor(() => {
      expect(screen.queryByText('Cancel TRD-100001?')).not.toBeInTheDocument()
    })
    expect(() => lastWrite()).toThrow(/nothing was written/)
  })

  it('cancels at the row current version once confirmed', async () => {
    await openCancelDialog()
    await screen.findByText('Cancel TRD-100001?')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel trade' }))

    await waitFor(() => {
      // The version carried is the cache's, so a cancel racing an amend is refused.
      expect(lastWrite().body).toEqual({ version: 1 })
    })
  })
})

describe('acting on a row', () => {
  /** The readback, which is the only thing that says which row is selected. */
  function readback(): HTMLElement {
    return screen.getByRole('status')
  }

  it('offers nothing until a row is picked', async () => {
    renderApp()
    await findRow('TRD-100001')

    expect(readback()).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Amend' })).not.toBeInTheDocument()

    selectRow('TRD-100001')

    expect(readback()).toHaveTextContent('TRD-100001')
    expect(readback()).toHaveTextContent('VOD')
    expect(screen.getByRole('button', { name: 'Amend' })).toBeEnabled()
  })

  it('amends and cancels the selected row from the keyboard', async () => {
    renderApp()
    await findRow('TRD-100001')
    selectRow('TRD-100001')

    const grid = screen.getByRole('grid')

    fireEvent.keyDown(grid, { key: 'a' })
    expect(await screen.findByRole('button', { name: 'Save amendment' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save amendment' })).not.toBeInTheDocument()
    })

    fireEvent.keyDown(grid, { key: 'c' })
    // Still a confirmation: a hotkey must not be a shorter path to the wrong trade.
    expect(await screen.findByText('Cancel TRD-100001?')).toBeInTheDocument()
    expect(() => lastWrite()).toThrow(/nothing was written/)
  })

  it('moves the selection down the order on screen, and drops it on Escape', async () => {
    // Sorted by timestamp descending, so the later trade is the first row.
    respondWith(
      [aTrade(), aTrade({ tradeId: 'TRD-100002', tradeTimestamp: '2026-10-02T10:00:00.000Z' })],
      [aPosition()],
      1,
    )
    renderApp()
    await findRow('TRD-100002')

    const grid = screen.getByRole('grid')

    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(readback()).toHaveTextContent('TRD-100002')

    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(readback()).toHaveTextContent('TRD-100001')

    // Clamped, not wrapping: a held key stops at the end of the tape.
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(readback()).toHaveTextContent('TRD-100001')

    fireEvent.keyDown(grid, { key: 'Escape' })
    expect(readback()).toBeEmptyDOMElement()
  })
})

describe('whose trade it is', () => {
  /** The default identity is the fixture's trader, so a case about someone else's
   *  trade moves the trade rather than the window. */
  async function open(chip: 'Amend' | 'Cancel', trader?: string): Promise<void> {
    if (trader !== undefined) {
      respondWith([aTrade({ trader })], [aPosition()], 1)
    }
    renderApp()
    await findRow('TRD-100001')
    selectRow('TRD-100001')
    fireEvent.click(screen.getByRole('button', { name: chip }))
    await screen.findByRole('dialog')
  }

  it('says the trade is yours when it is', async () => {
    await open('Amend')

    expect(screen.getByText('Booked by you')).toBeInTheDocument()
  })

  it('names the trader and says whose name the amendment will carry', async () => {
    await open('Amend', 'r.chatterjee')

    // Not a refusal: correcting someone else's booking is trade support's job.
    expect(screen.getByText(/Booked by r\.chatterjee/)).toHaveTextContent(
      'Your name goes on the amendment.',
    )
    expect(screen.getByRole('button', { name: 'Save amendment' })).toBeEnabled()
  })

  it('names the cancellation rather than the amendment on the other dialog', async () => {
    await open('Cancel', 'r.chatterjee')

    expect(screen.getByText(/Booked by r\.chatterjee/)).toHaveTextContent(
      'Your name goes on the cancellation.',
    )
  })
})
