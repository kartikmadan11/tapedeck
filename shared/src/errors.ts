import { z } from 'zod'
import { tradeId, tradeStatus } from './trade.js'

// A discriminated union rather than a bag with an optional `details`, so
// handling a VERSION_CONFLICT can read currentVersion without a cast.

export const errorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'ALREADY_EXISTS',
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

/** Wrong credentials, or a token the server does not hold. One code for both, so
 *  a reply does not say which usernames exist. */
export const unauthenticatedError = z.object({
  code: z.literal('UNAUTHENTICATED'),
  message: z.string(),
  details: z.object({}),
})

/** A name someone already holds. Names the field so a form can mark the box. */
export const alreadyExistsError = z.object({
  code: z.literal('ALREADY_EXISTS'),
  message: z.string(),
  details: z.object({ field: z.string() }),
})

/** One 404 serves both an unknown trade and an unknown route, hence the optional id. */
export const notFoundError = z.object({
  code: z.literal('NOT_FOUND'),
  message: z.string(),
  details: z.object({ tradeId: z.string().optional() }),
})

/** Someone else changed the row first. Carries currentVersion so the client can retry. */
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
  unauthenticatedError,
  alreadyExistsError,
  notFoundError,
  versionConflictError,
  invalidStateError,
  internalError,
])
export type ApiError = z.infer<typeof apiError>

export type VersionConflictError = z.infer<typeof versionConflictError>

/** The single domain-error to HTTP mapping. */
export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  ALREADY_EXISTS: 409,
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

export function unauthenticated(message: string): DomainError {
  return new DomainError({ code: 'UNAUTHENTICATED', message, details: {} })
}

export function alreadyExists(field: string, message: string): DomainError {
  return new DomainError({ code: 'ALREADY_EXISTS', message, details: { field } })
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

/** A fill the trade's own quantities refuse: one that does not advance the cumulative
 * total, or one past what was booked. invalidState's code, since it is the same kind of
 * refusal, but the message has to say the fill is the reason. */
export function invalidFill(
  id: string,
  status: z.infer<typeof tradeStatus>,
  reason: string,
): DomainError {
  return new DomainError({
    code: 'INVALID_STATE',
    message: `Trade ${id} cannot be filled: ${reason}`,
    details: { tradeId: id, status },
  })
}
