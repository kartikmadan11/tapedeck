import {
  frameSequence,
  type Position,
  type ServerFrame,
  type SimulationState,
  type Trade,
} from '@tapedeck/shared'
import type { FastifyBaseLogger } from 'fastify'
import type { WebSocket } from 'ws'
import type { Bus } from '../bus.js'

// A client buffering more than this is dropped. Safe only because of seq: it
// reconnects, takes a snapshot and replays what it missed.
const MAX_BUFFERED_BYTES = 1_000_000

interface Client {
  socket: WebSocket
  /** Cleared before each ping, set on pong. A client missing one ping is gone. */
  alive: boolean
}

export interface Hub {
  /** Runs the snapshot handshake and registers the socket. */
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
  /** Read at handshake time, so a connecting client is told whether the feed runs. */
  readSimulation: () => SimulationState
}

export function createHub(options: HubOptions): Hub {
  const { bus, log, pingIntervalMs, readSnapshot, readSimulation } = options
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

  /** Buffer from the moment the socket arrives, read a consistent snapshot, send it,
   * replay only what it does not contain, then register. Subscribing after the read
   * loses frames; before it duplicates them. `seq > snapshotSeq` is sound only because
   * the advisory lock makes the sequence gap-free and ordered. */
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

      for (const frame of buffer) {
        const seq = frameSequence(frame)
        if (seq !== null && seq > snapshot.seq) {
          socket.send(JSON.stringify(frame))
        }
      }

      // Positions carry no cursor, so send only the latest buffered one: derived
      // state supersedes every earlier frame.
      const latestPositions = buffer.findLast((frame) => frame.type === 'positions')
      if (latestPositions) {
        socket.send(JSON.stringify(latestPositions))
      }

      // Feed state is part of the handshake, not a delta, so a frame buffered during the
      // read wins. One frame either way: it carries no seq, so it matches neither filter.
      const toggledDuringRead = buffer.findLast((frame) => frame.type === 'simulation')
      socket.send(
        JSON.stringify(
          toggledDuringRead ?? ({ type: 'simulation', ...readSimulation() } satisfies ServerFrame),
        ),
      )
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

  /** Without the pong record and a terminate on the next tick, a client that vanished
   * without a close frame stays in the set and is sent every frame. */
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

  // Without unref this timer keeps the event loop alive and Vitest hangs.
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
