import type { FastifyInstance } from 'fastify'

export function registerWebsocketRoute(app: FastifyInstance): void {
  app.get('/ws', { websocket: true }, (socket) => {
    // The handshake reads a snapshot, so it is async. Fastify does not await the
    // websocket handler, so a rejection here would otherwise be an unhandled
    // rejection rather than a logged error.
    app.hub.attach(socket).catch((error: unknown) => {
      app.log.error({ err: error }, 'websocket handshake failed')
      socket.close(1011, 'handshake failed')
    })
  })
}
