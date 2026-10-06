import type {
  AmendTradeInput,
  ApiError,
  CancelTradeInput,
  CreateTradeInput,
  Credentials,
  PositionsResponse,
  Session,
  SimulationState,
  Trade,
  TradeEvent,
  TradesResponse,
} from '@tapedeck/shared'
import {
  apiError,
  BLOTTER_LIMIT,
  positionsResponse,
  session,
  simulationState,
  trade,
  tradeEvent,
  tradesResponse,
} from '@tapedeck/shared'
import { z } from 'zod'
import { readTrader } from './identity.js'
import { readSession } from './session.js'

/** Carries the server's typed payload, not just a status, so a caller can read
 *  `currentVersion` off a VERSION_CONFLICT without a cast. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly payload: ApiError

  constructor(status: number, payload: ApiError) {
    super(payload.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.payload = payload
  }
}

/** A failure from outside the API: a dropped network, or a proxy answering HTML.
 *  Shaped as an ApiError so every caller has one shape to handle. */
function opaqueFailure(status: number, body: string): ApiError {
  return {
    code: 'INTERNAL',
    message:
      body.trim().length > 0 && body.length < 200
        ? body.trim()
        : `The server responded with ${status}`,
    details: {},
  }
}

/** Sent on every request, so the one route that checks it gets it without each
 *  caller remembering. Absent until someone signs in. */
function bearer(): Record<string, string> {
  const current = readSession()
  return current === null ? {} : { authorization: `Bearer ${current.token}` }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      // The actor the server writes into the audit trail, asserted rather than read
      // off the token: the trade routes are not behind the session. See the README.
      'x-tapedeck-actor': readTrader(),
      ...bearer(),
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  })

  const text = await response.text()

  if (!response.ok) {
    const parsed = apiError.safeParse(safeJson(text))
    throw new ApiRequestError(
      response.status,
      parsed.success ? parsed.data : opaqueFailure(response.status, text),
    )
  }

  // Parsed against the shared schema, so contract drift surfaces here rather than
  // as an undefined three components deep.
  return schema.parse(safeJson(text))
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function register(input: Credentials): Promise<Session> {
  return request('/api/auth/register', session, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function login(input: Credentials): Promise<Session> {
  return request('/api/auth/login', session, { method: 'POST', body: JSON.stringify(input) })
}

/** Told to the server so the token stops working there too, and deliberately not
 *  awaited: the window is signed out once its stored session is gone. */
export function logout(): Promise<void> {
  return request('/api/auth/logout', z.unknown(), { method: 'POST' }).then(() => undefined)
}

/** Unfiltered, so a frame never has to be tested against a server-side predicate to
 *  know whether it belongs in the cache. Windowed because cancelled trades stay on
 *  the tape, and the limit is sent so the cache trims to the window it asked for. */
export function fetchTrades(): Promise<TradesResponse> {
  return request(`/api/trades?limit=${BLOTTER_LIMIT}`, tradesResponse)
}

export function fetchPositions(): Promise<PositionsResponse> {
  return request('/api/positions', positionsResponse)
}

export function fetchTradeEvents(tradeId: string): Promise<TradeEvent[]> {
  return request(
    `/api/trades/${encodeURIComponent(tradeId)}/events`,
    z.object({ events: z.array(tradeEvent) }),
  ).then((body) => body.events)
}

export function createTrade(input: CreateTradeInput): Promise<Trade> {
  return request('/api/trades', trade, { method: 'POST', body: JSON.stringify(input) })
}

export function amendTrade(tradeId: string, input: AmendTradeInput): Promise<Trade> {
  return request(`/api/trades/${encodeURIComponent(tradeId)}`, trade, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function cancelTrade(tradeId: string, input: CancelTradeInput): Promise<Trade> {
  return request(`/api/trades/${encodeURIComponent(tradeId)}/cancel`, trade, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function fetchSimulation(): Promise<SimulationState> {
  return request('/api/simulation', simulationState)
}

/** Only `running` is sent: the cadence is the server's to set. */
export function setSimulation(running: boolean): Promise<SimulationState> {
  return request('/api/simulation', simulationState, {
    method: 'POST',
    body: JSON.stringify({ running }),
  })
}

/** Derived from the page, not configured: in production the API serves this page,
 *  and in development Vite proxies /ws to it. No environment variable either way. */
export function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}
