import { credentials, unauthenticated } from '@tapedeck/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * Sign-in against the mocked account store, and the only routes that read the token.
 * The trade routes still take the actor from `x-tapedeck-actor` and remain open,
 * which is where this build stops short of real auth. Recorded in the README.
 */
export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/register', async (request, reply) => {
    const session = await app.authService.register(credentials.parse(request.body))
    return reply.status(201).send(session)
  })

  app.post('/api/auth/login', async (request) =>
    app.authService.login(credentials.parse(request.body)),
  )

  /** 204 either way, since logout has no outcome a client could act on. */
  app.post('/api/auth/logout', async (request, reply) => {
    app.authService.logout(bearer(request))
    return reply.status(204).send()
  })

  /** What a reloaded window asks to find out whether its stored token still works. */
  app.get('/api/auth/me', async (request) => {
    const session = app.authService.verify(bearer(request))
    if (session === null) {
      throw unauthenticated('Sign in to continue')
    }
    return session
  })
}

/** The token, or null for anything that is not a non-empty bearer header. */
function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (typeof header !== 'string') {
    return null
  }
  const [scheme, token] = header.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token !== undefined && token.length > 0
    ? token
    : null
}
