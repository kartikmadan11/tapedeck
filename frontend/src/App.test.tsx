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
    price: '72.465000',
    trader: 'k.madan',
    book: 'EQ-LDN-01',
    counterparty: 'GSIL',
    tradeTimestamp: '2026-10-02T09:15:00.000Z',
    status: 'ACTIVE',
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

/**
 * React Query flushes cache notifications on a timer rather than inline, which
 * act() does not wait for, so everything a delivered frame changes is asserted
 * with findBy or waitFor rather than read straight afterwards.
 */
function deliver(frame: ServerFrame): void {
  act(() => FakeSocket.live.onmessage?.({ data: JSON.stringify(frame) }))
}

const fetchMock = vi.fn()

const SIMULATION_INTERVAL_MS = 2_000

function respondWith(trades: Trade[], positions: Position[], seq: number, running = false): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    // Matched on the url before the method, because this endpoint is both read
    // and written and a POST here does not answer with a trade.
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

    // A write answers with the created trade, not a list, so the real response
    // schema is the one the client parses.
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

/** The request behind the most recent write, so a test can read what was sent. */
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
  // The identity lives in sessionStorage, which jsdom keeps for the whole file, so
  // without this one test arriving under a name would decide the next test's actor.
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

function badge(): HTMLElement {
  return screen.getByText(/^(Connecting|Live|Reconnecting)$/).parentElement as HTMLElement
}

/** A trade's row, by the id it carries: the Trade column is off by default. */
function row(tradeId: string): HTMLElement | null {
  return document.querySelector(`tr[data-trade-id="${tradeId}"]`)
}

/** Waits for a trade to reach the tape, which is what a REST load or a frame does. */
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

    // The positions panel is populated on first paint, not after the first
    // mutation: the snapshot carries exposure as well as trades.
    const panel = screen.getByRole('complementary')
    expect(within(panel).getByText('VOD')).toBeInTheDocument()
    expect(within(panel).getByText('724,650.00')).toBeInTheDocument()

    expect(badge()).toHaveTextContent('Connecting')
    expect(badge()).toHaveTextContent('seq 1')
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
    expect(badge()).toHaveTextContent('Live')
    expect(badge()).toHaveTextContent('seq 2')
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

    // A cancelled trade keeps its place on the tape, and the bar refuses to write
    // to it.
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

    const panel = screen.getByRole('complementary')
    expect(await within(panel).findByText('289,860.00')).toBeInTheDocument()

    // A positions frame carries no seq, so there is nothing for it to advance and
    // no frame it can cause the client to skip.
    expect(badge()).toHaveTextContent('seq 1')
  })

  it('reports a dropped connection and keeps the rows it already has', async () => {
    renderApp()
    await findRow('TRD-100001')
    open()

    act(() => FakeSocket.live.onclose?.())

    expect(badge()).toHaveTextContent('Reconnecting')
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
    expect(badge()).toHaveTextContent('seq 2')
  })

  it('books under the window identity and stamps the same name as the actor', async () => {
    // Handed over before the first render, the way it arrives in the app.
    window.history.replaceState(null, '', '/?actor=j.okonkwo')
    adoptIdentity()

    renderApp()
    await findRow('TRD-100001')

    fireEvent.click(screen.getByRole('button', { name: 'Book trade' }))

    // One identity feeds both the trader on the trade and the actor on the event.
    await waitFor(() => {
      const write = lastWrite()
      expect(write.body.trader).toBe('j.okonkwo')
      expect(write.actor).toBe('j.okonkwo')
    })
  })

  it('states the identity rather than offering it', async () => {
    renderApp()
    await findRow('TRD-100001')

    // The name stamped on an amend is the one thing a trader should not be able to
    // choose, so there is no control labelled with it, only the name itself.
    expect(screen.queryByLabelText('Trading as')).toBeNull()
    expect(screen.getByText('Trading as').parentElement).toHaveTextContent('Trading as k.madan')
  })
})

describe('the simulated feed control', () => {
  it('offers to pause a feed the server reports as running', async () => {
    respondWith([aTrade()], [aPosition()], 1, true)
    renderApp()

    // Read over REST on load, so a client arriving after the feed started shows
    // the right control rather than guessing it is stopped.
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

    // Without the broadcast this client would still read 'Start feed' while trades
    // arrived underneath it.
    expect(await screen.findByRole('button', { name: 'Pause feed' })).toBeInTheDocument()
  })

  it('does not let a simulation frame disturb the blotter or its cursor', async () => {
    renderApp()
    await findRow('TRD-100001')
    open()

    deliver({ type: 'simulation', running: true, intervalMs: SIMULATION_INTERVAL_MS })

    await screen.findByRole('button', { name: 'Pause feed' })
    // An unsequenced frame must not advance the cursor: doing so would make the
    // client discard the trade frames the feed is about to produce.
    expect(badge()).toHaveTextContent('seq 1')
    expect(row('TRD-100001')).not.toBeNull()
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

  /** The ticket's box, not the config panel's Quantity column checkbox, which
   *  carries the same label text and is mounted even while the panel is shut. */
  function quantity(): HTMLElement {
    return screen.getByLabelText('Quantity', { selector: '#quantity' })
  }

  async function ready(): Promise<void> {
    renderApp()
    await findRow('TRD-100001')
  }

  it('holds a repeat of the ticket it just booked, and books it when confirmed', async () => {
    await ready()

    book()
    await waitFor(() => expect(bookings()).toHaveLength(1))

    // The form keeps the ticket it just sent, so pressing again is the accident
    // the guard exists for.
    book()
    expect(await screen.findByRole('button', { name: 'Confirm duplicate' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Identical to TRD-100999, booked 0\.\ds ago/,
    )
    expect(bookings()).toHaveLength(1)

    // Confirming is the same button, and a confirmed repeat books.
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
    // A key reused here would make the second clip a silent replay of the first
    // and lose a booking.
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

    // With rows arriving on their own, a bare one-click Cancel is easy to land on
    // the wrong trade.
    expect(await screen.findByText('Cancel TRD-100001?')).toBeInTheDocument()
    expect(() => lastWrite()).toThrow(/nothing was written/)
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
      // The version carried is the one the cache holds, so a cancel racing an
      // amend is refused rather than applied to a row that has moved on.
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
    // Still a confirmation, not a write: a hotkey must not be a shorter path to
    // cancelling the wrong trade than the button is.
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

    // Clamped rather than wrapping: the key held down stops at the end of the tape.
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(readback()).toHaveTextContent('TRD-100001')

    fireEvent.keyDown(grid, { key: 'Escape' })
    expect(readback()).toBeEmptyDOMElement()
  })
})
