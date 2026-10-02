import { QueryClientProvider } from '@tanstack/react-query'
import type { Position, ServerFrame, Trade } from '@tapedeck/shared'
import { position as positionSchema, trade as tradeSchema } from '@tapedeck/shared'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.js'
import { createQueryClient } from './lib/queryClient.js'

function aTrade(overrides: Record<string, unknown> = {}): Trade {
  return tradeSchema.parse({
    tradeId: 'TRD-100001',
    symbol: 'VOD',
    side: 'BUY',
    quantity: 10_000,
    price: '72.465000',
    trader: 'k.madan',
    book: 'EQ-LDN-1',
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

/**
 * Stands in for the browser's WebSocket so a frame can be delivered by hand. The
 * reducer is tested on its own; what this proves is the wiring from a frame on the
 * socket to a row on the screen.
 */
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

function respondWith(trades: Trade[], positions: Position[], seq: number): void {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/positions')) {
      return Promise.resolve(new Response(JSON.stringify({ seq, positions }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify({ seq, trades }), { status: 200 }))
  })
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

describe('App', () => {
  it('paints the blotter and the positions panel from REST before the socket opens', async () => {
    renderApp()

    expect(await screen.findByText('TRD-100001')).toBeInTheDocument()

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
    await screen.findByText('TRD-100001')
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

    expect(await screen.findByText('TRD-100002')).toBeInTheDocument()
    expect(badge()).toHaveTextContent('Live')
    expect(badge()).toHaveTextContent('seq 2')
  })

  it('strikes a row through when it is cancelled elsewhere rather than removing it', async () => {
    renderApp()
    await screen.findByText('TRD-100001')
    open()

    deliver({
      type: 'trade.cancelled',
      seq: 2,
      trade: aTrade({ status: 'CANCELLED', version: 2, updatedAt: '2026-10-02T12:00:00.000Z' }),
    })

    expect(await screen.findByText('CANCELLED')).toBeInTheDocument()

    const amend = screen.getByRole('button', { name: 'Amend' })
    expect(amend).toBeDisabled()
  })

  it('updates exposure from a positions frame without advancing the cursor', async () => {
    renderApp()
    await screen.findByText('TRD-100001')
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
    await screen.findByText('TRD-100001')
    open()

    act(() => FakeSocket.live.onclose?.())

    expect(badge()).toHaveTextContent('Reconnecting')
    expect(screen.getByText('TRD-100001')).toBeInTheDocument()
  })

  it('filters client-side, so clearing a filter needs no round trip', async () => {
    respondWith([aTrade(), aTrade({ tradeId: 'TRD-100002', symbol: 'HSBA' })], [], 2)
    renderApp()
    await screen.findByText('TRD-100001')

    const callsBefore = fetchMock.mock.calls.length

    fireEvent.change(screen.getByLabelText('Filter by symbol'), { target: { value: 'HSBA' } })

    expect(screen.queryByText('TRD-100001')).toBeNull()
    expect(screen.getByText('TRD-100002')).toBeInTheDocument()
    expect(fetchMock.mock.calls).toHaveLength(callsBefore)
  })
})
