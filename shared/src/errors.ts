import { z } from 'zod'
import { tradeId, tradeStatus } from './trade.js'

// A discriminated union rather than a bag with an optional `details`, so
// handling a VERSION_CONFLICT can read currentVersion without a cast.

export const errorCode = z.enum([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'INVALID_STATE',
  'INTERNAL',
])
export type ErrorCode = z.infer<typeof errorCode>

export const validationFailedError = z.object({
  code: z.literal('VALIDATION_FAILED'),
  message: z.string(),
  details: z.object({
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  }),
})

/**
 * One 404 serves two cases: an unknown trade, which names it, and an unknown
 * route, which has no trade to name. Hence the optional id rather than an empty
 * string standing in for one.
 */
export const notFoundError = z.object({
  code: z.literal('NOT_FOUND'),
  message: z.string(),
  details: z.object({ tradeId: z.string().optional() }),
})

/**
 * Someone else changed the row first. Carries currentVersion so the client can
 * offer a retry rather than just report a failure.
 */
export const versionConflictError = z.object({
  code: z.literal('VERSION_CONFLICT'),
  message: z.string(),
  details: z.object({
    tradeId,
    expectedVersion: z.number().int().positive(),
    currentVersion: z.number().int().positive(),
  }),
})

/** The trade exists but is not in a state that permits the requested change. */
export const invalidStateError = z.object({
  code: z.literal('INVALID_STATE'),
  message: z.string(),
  details: z.object({ tradeId, status: tradeStatus }),
})

export const internalError = z.object({
  code: z.literal('INTERNAL'),
  message: z.string(),
  details: z.object({}),
})

export const apiError = z.discriminatedUnion('code', [
  validationFailedError,
  notFoundError,
  versionConflictError,
  invalidStateError,
  internalError,
])
export type ApiError = z.infer<typeof apiError>

export type VersionConflictError = z.infer<typeof versionConflictError>

/**
 * The single domain-error to HTTP mapping. The three-way split exists because
 * "gone", "out of date" and "cancelled" are three different things to tell a
 * user about a failed amend.
 */
export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 409,
  INTERNAL: 500,
}

/** Thrown by the service layer and translated by the Fastify error handler. */
export class DomainError extends Error {
  readonly payload: ApiError

  constructor(payload: ApiError) {
    super(payload.message)
    this.name = 'DomainError'
    this.payload = payload
  }

  get status(): number {
    return HTTP_STATUS[this.payload.code]
  }
}

export function notFound(id: string): DomainError {
  return new DomainError({
    code: 'NOT_FOUND',
    message: `Trade ${id} does not exist`,
    details: { tradeId: id },
  })
}

export function versionConflict(
  id: string,
  expectedVersion: number,
  currentVersion: number,
): DomainError {
  return new DomainError({
    code: 'VERSION_CONFLICT',
    message: `Trade ${id} has changed since you loaded it: you have version ${expectedVersion}, the current version is ${currentVersion}`,
    details: { tradeId: id, expectedVersion, currentVersion },
  })
}

export function invalidState(id: string, status: z.infer<typeof tradeStatus>): DomainError {
  return new DomainError({
    code: 'INVALID_STATE',
    message: `Trade ${id} is ${status} and cannot be changed`,
    details: { tradeId: id, status },
  })
}
