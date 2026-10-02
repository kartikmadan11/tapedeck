import { frameSequence, type Position, type ServerFrame, type Trade } from '@tapedeck/shared'
import type { FastifyBaseLogger } from 'fastify'
import type { WebSocket } from 'ws'
import type { Bus } from '../bus.js'

// A client buffering more than this is dropped. Only safe because of seq: it
// reconnects, takes a snapshot and replays what it missed, so nothing is lost.
const MAX_BUFFERED_BYTES = 1_000_000

interface Client {
  socket: WebSocket
  /** Cleared before each ping, set on pong. A client missing one ping is gone. */
  alive: boolean
}

export interface Hub {
  /** Runs the snapshot handshake and registers the socket. Returns a teardown function. */
  attach: (socket: WebSocket) => Promise<void>
  readonly clientCount: number
  close: () => void
}

export interface HubOptions {
  bus: Bus
  log: FastifyBaseLogger
  pingIntervalMs: number
  /** Reads trades, positions and the high-water seq in one consistent transaction. */
  readSnapshot: () => Promise<{ seq: number; trades: Trade[]; positions: Position[] }>
}

export function createHub(options: HubOptions): Hub {
  const { bus, log, pingIntervalMs, readSnapshot } = options
  const clients = new Set<Client>()

  const unsubscribe = bus.subscribe((frame) => {
    broadcast(frame)
  })

  /** Serialised once, outside the loop, rather than per client. */
  function broadcast(frame: ServerFrame): void {
    const payload = JSON.stringify(frame)

    for (const client of clients) {
      if (client.socket.readyState !== client.socket.OPEN) {
        clients.delete(client)
        continue
      }

      if (client.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        log.warn(
          { buffered: client.socket.bufferedAmount },
          'dropping a client that is not draining; it will resync on reconnect',
        )
        clients.delete(client)
        client.socket.terminate()
        continue
      }

      client.socket.send(payload)
    }
  }

  /**
   * The handshake closes a race: frames published between reading the snapshot
   * and subscribing would be lost, and frames published before it would be
   * duplicates. So buffer from the moment the socket arrives, read a consistent
   * snapshot, send it, replay only what it does not contain, then register.
   *
   * `seq > snapshotSeq` is sound only because the advisory lock makes the
   * sequence gap-free and commit-ordered.
   */
  async function attach(socket: WebSocket): Promise<void> {
    const buffer: ServerFrame[] = []
    const stopBuffering = bus.subscribe((frame) => {
      buffer.push(frame)
    })

    try {
      const snapshot = await readSnapshot()

      if (socket.readyState !== socket.OPEN) {
        // The client gave up during the read.
        return
      }

      socket.send(
        JSON.stringify({
          type: 'snapshot',
          seq: snapshot.seq,
          trades: snapshot.trades,
          positions: snapshot.positions,
        } satisfies ServerFrame),
      )

      // Replay the sequenced frames the snapshot missed, in order.
      for (const frame of buffer) {
        const seq = frameSequence(frame)
        if (seq !== null && seq > snapshot.seq) {
          socket.send(JSON.stringify(frame))
        }
      }

      // Positions carry no cursor, so send only the latest buffered one: it is
      // derived state and supersedes every earlier frame.
      const latestPositions = buffer.findLast((frame) => frame.type === 'positions')
      if (latestPositions) {
        socket.send(JSON.stringify(latestPositions))
      }
    } finally {
      stopBuffering()
    }

    if (socket.readyState !== socket.OPEN) {
      return
    }

    const client: Client = { socket, alive: true }
    clients.add(client)

    socket.on('pong', () => {
      client.alive = true
    })

    socket.on('close', () => {
      clients.delete(client)
    })

    socket.on('error', (error) => {
      log.warn({ err: error }, 'websocket error, dropping client')
      clients.delete(client)
    })
  }

  /**
   * A ping alone proves nothing. Without recording the pong and terminating on
   * the next tick, a client that vanished without a close frame stays in the set
   * and is sent every future frame.
   */
  const pingTimer = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        log.info('terminating a client that did not answer the last ping')
        clients.delete(client)
        client.socket.terminate()
        continue
      }
      client.alive = false
      client.socket.ping()
    }
  }, pingIntervalMs)

  // Without unref this timer alone keeps the event loop alive and Vitest hangs
  // after the tests pass.
  pingTimer.unref()

  return {
    attach,
    get clientCount() {
      return clients.size
    },
    close() {
      clearInterval(pingTimer)
      unsubscribe()
      for (const client of clients) {
        client.socket.close(1001, 'server shutting down')
      }
      clients.clear()
    },
  }
}
