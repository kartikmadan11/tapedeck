import type { ServerFrame } from '@tapedeck/shared'

export type FrameListener = (frame: ServerFrame) => void

export interface Bus {
  publish: (frame: ServerFrame) => void
  subscribe: (listener: FrameListener) => () => void
  readonly listenerCount: number
}

/**
 * In-process pub/sub, reached via app.decorate rather than a module singleton:
 * buildApp() is called more than once per process, and a shared bus would let two
 * app instances cross-talk. A throwing listener is isolated, because the mutation
 * that published the frame has committed and must not fail because a subscriber did.
 */
export function createBus(onListenerError?: (error: unknown) => void): Bus {
  const listeners = new Set<FrameListener>()

  return {
    publish(frame) {
      for (const listener of listeners) {
        try {
          listener(frame)
        } catch (error) {
          onListenerError?.(error)
        }
      }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    get listenerCount() {
      return listeners.size
    },
  }
}
