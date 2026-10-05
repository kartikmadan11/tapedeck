import type {
  AmendTradeInput,
  ApiError,
  CancelTradeInput,
  CreateTradeInput,
  PositionsResponse,
  SimulationState,
  Trade,
  TradeEvent,
  TradesResponse,
} from '@tapedeck/shared'
import {
  apiError,
  BLOTTER_LIMIT,
  positionsResponse,
  simulationState,
  trade,
  tradeEvent,
  tradesResponse,
} from '@tapedeck/shared'
import { z } from 'zod'
import { readTrader } from './identity.js'

/**
 * Carries the server's typed error payload rather than just a status, so a
 * caller can read `currentVersion` off a VERSION_CONFLICT without a cast.
 */
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

/**
 * A failure that did not come from the API itself: the network dropped, or a
 * proxy answered with HTML. Kept inside the same error type so every caller has
 * one shape to handle.
 */
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

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      // There is no authentication here, so the actor is the window's declared
      // identity: asserted by the caller and trusted by the server, which is the
      // shape a gateway-authenticated deployment has anyway. Verifying it is a
      // change to this line and a check on the server, not to the audit model.
      'x-tapedeck-actor': readTrader(),
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

  // Parsed against the shared schema, so the same definition that validated the
  // request on the server validates the response in the browser. A contract
  // drift shows up here rather than as an undefined three components deep.
  return schema.parse(safeJson(text))
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Deliberately unfiltered but deliberately windowed.
 *
 * Unfiltered, because the cache holds every trade it is given and the table
 * filters what it renders, so an incoming frame never has to be tested against a
 * server-side predicate to know whether it belongs in the cache. The filtered
 * form of this endpoint exists and is tested, it is just not what the UI reads.
 *
 * Windowed, because the book grows without bound: cancelled trades stay on the
 * tape, so the feed only ever adds rows. The limit is sent rather than left to
 * the server's default so that the window the cache trims itself to is the same
 * window it asked for, stated in one place.
 */
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

/**
 * Only `running` is sent. The cadence is the server's, so the UI reports it
 * rather than offering it.
 */
export function setSimulation(running: boolean): Promise<SimulationState> {
  return request('/api/simulation', simulationState, {
    method: 'POST',
    body: JSON.stringify({ running }),
  })
}

/**
 * Derived from the page rather than configured, because in production the API
 * serves this page. In development Vite proxies /ws to the API, so the same
 * derivation works there too with no environment variable.
 */
export function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}
