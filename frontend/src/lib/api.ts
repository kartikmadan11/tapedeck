import type {
  AmendTradeInput,
  ApiError,
  CancelTradeInput,
  CreateTradeInput,
  PositionsResponse,
  Trade,
  TradeEvent,
  TradesResponse,
} from '@tapedeck/shared'
import { apiError, positionsResponse, trade, tradeEvent, tradesResponse } from '@tapedeck/shared'
import { z } from 'zod'

/**
 * There is no authentication in this build, but the audit trail still records an
 * actor, so the browser names itself. Adding real auth replaces this constant
 * with a token claim and changes nothing else.
 */
export const ACTOR = 'web-ui'

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
      'x-tapedeck-actor': ACTOR,
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
 * Deliberately unfiltered. The cache holds every trade and the table filters
 * what it renders, so an incoming frame never has to be tested against a
 * server-side predicate to know whether it belongs in the cache. The filtered
 * form of this endpoint exists and is tested, it is just not what the UI reads.
 */
export function fetchTrades(): Promise<TradesResponse> {
  return request('/api/trades', tradesResponse)
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

/**
 * Derived from the page rather than configured, because in production the API
 * serves this page. In development Vite proxies /ws to the API, so the same
 * derivation works there too with no environment variable.
 */
export function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}
