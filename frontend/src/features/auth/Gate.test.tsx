import { QueryClientProvider } from '@tanstack/react-query'
import { DEMO_PASSWORD } from '@tapedeck/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '../../lib/queryClient.js'
import { Gate } from './Gate.js'

/** The App behind the gate opens one, and nothing here delivers a frame. */
class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close(): void {}
}

const fetchMock = vi.fn()

/** An empty book, so the blotter behind the gate renders without a fixture. */
function respond(): void {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/auth/login') || url.startsWith('/api/auth/register')) {
      return Promise.resolve(
        new Response(JSON.stringify({ trader: 'j.okonkwo', token: 'tkn' }), { status: 200 }),
      )
    }
    if (url.startsWith('/api/auth/logout')) {
      return Promise.resolve(new Response('', { status: 204 }))
    }
    if (url.startsWith('/api/simulation')) {
      return Promise.resolve(
        new Response(JSON.stringify({ running: false, intervalMs: 2_000 }), { status: 200 }),
      )
    }
    if (url.startsWith('/api/positions')) {
      return Promise.resolve(
        new Response(JSON.stringify({ seq: 1, positions: [] }), { status: 200 }),
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ seq: 1, trades: [] }), { status: 200 }))
  })
}

function renderGate(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Gate />
    </QueryClientProvider>,
  )
}

/** Signs in through the form, which is the only way past the landing page. */
function signIn(button: 'Log in' | 'Register'): void {
  fireEvent.click(screen.getByRole('button', { name: button }))
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'j.okonkwo' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: DEMO_PASSWORD } })
  fireEvent.submit(
    screen.getByRole('button', { name: button === 'Log in' ? 'Log in' : 'Create account' }),
  )
}

beforeEach(() => {
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('WebSocket', FakeSocket)
  respond()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what a visitor sees before they sign in', () => {
  it('is the landing page, and not the blotter', () => {
    renderGate()

    expect(screen.getByRole('heading', { name: 'tapedeck' })).not.toBeNull()
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('fetches nothing, because the blotter is what reads the book', () => {
    renderGate()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is a tape that has already printed, so the page is never an empty box', () => {
    renderGate()

    expect(screen.getByRole('list', { name: 'Live trade prints' }).children).toHaveLength(7)
  })
})

describe('signing in', () => {
  it('reaches the blotter from Log in', async () => {
    renderGate()
    signIn('Log in')

    expect(await screen.findByRole('grid')).not.toBeNull()
  })

  it('reaches the blotter from Register', async () => {
    renderGate()
    signIn('Register')

    expect(await screen.findByRole('grid')).not.toBeNull()
  })

  it('trades as the name the server returned, not the one that was typed', async () => {
    renderGate()
    signIn('Log in')
    await screen.findByRole('grid')

    // The server is what decides who you are, so the badge reads its answer.
    expect(screen.getByText('j.okonkwo')).not.toBeNull()
  })

  it('leaves the form up and says why when the credentials are refused', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ code: 'UNAUTHENTICATED', message: 'No such account', details: {} }),
          { status: 401 },
        ),
      ),
    )
    renderGate()
    signIn('Log in')

    expect(await screen.findByRole('alert')).toHaveTextContent('No such account')
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('comes back out to the landing page from Back', () => {
    renderGate()
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('button', { name: 'Register' })).not.toBeNull()
  })
})

describe('signing out', () => {
  it('goes back to the landing page and keeps no session', async () => {
    renderGate()
    signIn('Log in')
    await screen.findByRole('grid')

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull())
    expect(sessionStorage.getItem('tapedeck.session')).toBeNull()
  })

  it('signs the window out even when the server never hears about it', async () => {
    renderGate()
    signIn('Log in')
    await screen.findByRole('grid')

    // The stored session is what makes a window signed in, so a failed call is
    // not the user's problem.
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')))
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull())
  })
})
