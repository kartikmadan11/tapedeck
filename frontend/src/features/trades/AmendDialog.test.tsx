import { QueryClientProvider } from '@tanstack/react-query'
import type { Trade } from '@tapedeck/shared'
import { trade as tradeSchema } from '@tapedeck/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../../lib/queryClient.js'
import { AmendDialog } from './AmendDialog.js'

const ACTIVE: Trade = tradeSchema.parse({
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
})

const fetchMock = vi.fn()

function renderDialog(onClose = vi.fn()): { onClose: ReturnType<typeof vi.fn> } {
  const client = createQueryClient()
  const tree = (
    <QueryClientProvider client={client}>
      <AmendDialog trade={ACTIVE} onClose={onClose} />
    </QueryClientProvider>
  ) as ReactElement

  render(tree)
  return { onClose }
}

/** The blotter refetch that follows every mutation, which this test ignores. */
function emptyBlotterResponses(): Response {
  return new Response(JSON.stringify({ seq: 0, trades: [], positions: [] }), { status: 200 })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => Promise.resolve(emptyBlotterResponses()))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function amendCall(): [string, RequestInit] | undefined {
  return fetchMock.mock.calls.find(
    (call): call is [string, RequestInit] =>
      (call[1] as RequestInit | undefined)?.method === 'PATCH',
  )
}

describe('AmendDialog', () => {
  it('sends only the amendable fields plus the version the user opened', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== 'PATCH') {
        return Promise.resolve(emptyBlotterResponses())
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ...ACTIVE, quantity: 5_000, version: 2 }), { status: 200 }),
      )
    })

    const { onClose } = renderDialog()

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save amendment' }))

    await waitFor(() => expect(amendCall()).toBeDefined())

    const [url, init] = amendCall() ?? ['', {}]
    expect(url).toBe('/api/trades/TRD-100001')
    // toEqual and not toMatchObject: the absence of counterparty is the
    // assertion, since a stray key here would be a 400 from the strictObject.
    expect(JSON.parse(String(init.body))).toEqual({
      quantity: 5_000,
      price: '72.465000',
      // The version the dialog opened with, not one guessed from the row.
      version: 1,
    })

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('cannot submit the symbol or the side, because the contract has no field for them', () => {
    renderDialog()

    expect(screen.getByLabelText('Quantity')).toBeInTheDocument()
    expect(screen.queryByLabelText('Symbol')).toBeNull()
    expect(screen.queryByLabelText('Side')).toBeNull()
  })

  it('shows the counterparty without offering a field for it', () => {
    renderDialog()

    // Not a control, because changing the counterparty is a cancel and a rebooking
    // rather than an amendment.
    expect(screen.getByText('GSIL')).toBeInTheDocument()
    expect(screen.queryByLabelText('Counterparty')).toBeNull()
  })

  it('reports a 409 as someone else having changed the trade, naming both versions', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== 'PATCH') {
        return Promise.resolve(emptyBlotterResponses())
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 'VERSION_CONFLICT',
            message: 'Trade TRD-100001 has changed since you loaded it',
            details: { tradeId: 'TRD-100001', expectedVersion: 1, currentVersion: 2 },
          }),
          { status: 409 },
        ),
      )
    })

    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Save amendment' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Changed by someone else')
    expect(alert).toHaveTextContent('version 1')
    expect(alert).toHaveTextContent('version 2')

    // A rejected amend leaves the dialog open with the user's values intact.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Quantity')).toHaveValue('10000')
  })

  it('refuses a price with more precision than the contract allows, without a round trip', async () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '72.4650001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save amendment' }))

    // Validated by the shared schema in the browser, so no PATCH is attempted.
    await waitFor(() => expect(screen.getByText(/decimal places/)).toBeInTheDocument())
    expect(amendCall()).toBeUndefined()
  })
})
