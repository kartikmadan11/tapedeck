import { type ApiError, DomainError, HTTP_STATUS } from '@tapedeck/shared'
import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

export interface ErrorHandlerOptions {
  /**
   * True when @fastify/static is serving a built frontend, so an unknown
   * non-API path is a client route. False in development and in tests.
   */
  serveSpaFallback: boolean
}

/**
 * The one place an error becomes an ApiError, so no route hand-rolls a response
 * shape. Internal errors return a fixed message and log the detail: a stack
 * trace or a constraint name in a response is needless disclosure.
 */
export function registerErrorHandler(app: FastifyInstance, options: ErrorHandlerOptions): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      // A normal outcome of concurrent use, not a fault, so info not error.
      request.log.info({ code: error.payload.code, err: error.message }, 'domain error')
      return reply.status(error.status).send(error.payload)
    }

    if (error instanceof ZodError) {
      const payload: ApiError = {
        code: 'VALIDATION_FAILED',
        message: 'The request body is not valid',
        details: { issues: toIssues(error) },
      }
      return reply.status(HTTP_STATUS.VALIDATION_FAILED).send(payload)
    }

    // Fastify's own 4xx, such as malformed JSON, which never reaches a schema.
    const status = statusCodeOf(error)
    if (status !== null && status >= 400 && status < 500) {
      const payload: ApiError = {
        code: 'VALIDATION_FAILED',
        message: error instanceof Error ? error.message : 'The request is not valid',
        details: { issues: [] },
      }
      return reply.status(status).send(payload)
    }

    request.log.error({ err: error }, 'unhandled error')
    const payload: ApiError = {
      code: 'INTERNAL',
      message: 'An unexpected error occurred',
      details: {},
    }
    return reply.status(HTTP_STATUS.INTERNAL).send(payload)
  })

  /**
   * An unknown /api route returns JSON, not the SPA shell: otherwise a typo in a
   * curl returns 200 and a page of HTML. Everything else falls through to
   * index.html so the client router owns client routes.
   *
   * Cannot call reply.callNotFound(), which would re-enter this handler.
   */
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api') || !options.serveSpaFallback) {
      const payload: ApiError = {
        code: 'NOT_FOUND',
        message: `No such route: ${request.method} ${request.url}`,
        details: {},
      }
      return reply.status(404).send(payload)
    }
    return reply.type('text/html').sendFile('index.html')
  })
}

/**
 * One issue per offending field, so a form can attach each message to an input.
 *
 * An unrecognized_keys issue names the keys in `keys` and leaves `path` empty, so
 * posting `symbol` to an amend would otherwise return a field-less error.
 */
function toIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.flatMap((issue) => {
    const prefix = issue.path.map(String).join('.')

    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: prefix.length > 0 ? `${prefix}.${key}` : key,
        message: `${key} is not an accepted field here`,
      }))
    }

    return [{ path: prefix, message: issue.message }]
  })
}

/** Fastify types the handler's error loosely, so read statusCode defensively. */
function statusCodeOf(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error as { statusCode?: unknown }
    return typeof statusCode === 'number' ? statusCode : null
  }
  return null
}
