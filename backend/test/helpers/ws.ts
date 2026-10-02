import { type ServerFrame, serverFrame } from '@tapedeck/shared'
import WebSocket from 'ws'

/**
 * Queues incoming frames so a test can await the next one without racing the
 * socket. Frames are parsed on receipt, so a malformed frame fails at delivery.
 */
export class FrameClient {
  private readonly socket: WebSocket
  private readonly received: ServerFrame[] = []
  private readonly waiters: ((frame: ServerFrame) => void)[] = []

  /** Every payload as it arrived, for assertions about the wire rather than the parse. */
  readonly raw: string[] = []

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (data: WebSocket.RawData) => {
      const text = data.toString()
      this.raw.push(text)
      const frame = serverFrame.parse(JSON.parse(text))
      const waiter = this.waiters.shift()
      if (waiter) {
        waiter(frame)
      } else {
        this.received.push(frame)
      }
    })
  }

  static connect(url: string): Promise<FrameClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const client = new FrameClient(socket)
      socket.once('open', () => resolve(client))
      socket.once('error', reject)
    })
  }

  /** The next frame, from the queue if one already arrived. */
  next(timeoutMs = 3_000): Promise<ServerFrame> {
    const queued = this.received.shift()
    if (queued) {
      return Promise.resolve(queued)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`no frame within ${timeoutMs}ms`))
      }, timeoutMs)

      this.waiters.push((frame) => {
        clearTimeout(timer)
        resolve(frame)
      })
    })
  }

  /** Collects frames until `count` have arrived. */
  async take(count: number, timeoutMs = 3_000): Promise<ServerFrame[]> {
    const frames: ServerFrame[] = []
    for (let i = 0; i < count; i += 1) {
      frames.push(await this.next(timeoutMs))
    }
    return frames
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) {
        resolve()
        return
      }
      this.socket.once('close', () => resolve())
      this.socket.close()
    })
  }
}
