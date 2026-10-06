import type { FastifyInstance } from 'fastify'

export function registerWebsocketRoute(app: FastifyInstance): void {
  app.get('/ws', { websocket: true }, (socket) => {
    // Fastify does not await the websocket handler, so a rejection from the async
    // handshake would otherwise be unhandled rather than a logged error.
    app.hub.attach(socket).catch((error: unknown) => {
      app.log.error({ err: error }, 'websocket handshake failed')
      socket.close(1011, 'handshake failed')
    })
  })
}
