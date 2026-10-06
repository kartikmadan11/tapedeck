import { useQueryClient } from '@tanstack/react-query'
import type { BlotterState, ServerFrame, SimulationState } from '@tapedeck/shared'
import { serverFrame } from '@tapedeck/shared'
import { useEffect } from 'react'
import { websocketUrl } from '../../lib/api.js'
import { queryKeys } from '../../lib/queryClient.js'
import { apply, emptyBlotter, hasGap, isTradeDelta } from './apply.js'

const BASE_DELAY_MS = 250
const MAX_DELAY_MS = 10_000
const JITTER_MS = 250

/** The only socket. Frames reach the cache through the pure reducer, so this holds
 *  nothing but connection lifecycle. No resync request: every connection is answered
 *  with a snapshot, so reconnecting is the resync, and a gap refetches over REST. */
export function useRealtime(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const refetch = (): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.blotter })
    }

    const handle = (frame: ServerFrame): void => {
      // Not blotter state, so it is routed out before the reducer. Carries no
      // cursor either, so the latest one wins, as with positions.
      if (frame.type === 'simulation') {
        queryClient.setQueryData<SimulationState>(queryKeys.simulation, {
          running: frame.running,
          intervalMs: frame.intervalMs,
        })
        return
      }

      // Read before the write, so the gap test sees the cursor the frame arrived
      // against and no side effect runs inside the cache updater.
      const before = queryClient.getQueryData<BlotterState>(queryKeys.blotter) ?? emptyBlotter

      queryClient.setQueryData<BlotterState>(queryKeys.blotter, (prev) =>
        apply(prev ?? emptyBlotter, frame),
      )

      if (isTradeDelta(frame) && hasGap(before, frame)) {
        refetch()
      }
    }

    const schedule = (): void => {
      // Jittered, so several tabs do not reconnect in the same millisecond.
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt) + Math.random() * JITTER_MS
      attempt += 1
      timer = setTimeout(connect, delay)
    }

    function connect(): void {
      if (disposed) {
        return
      }

      const next = new WebSocket(websocketUrl())
      socket = next

      // Resets the backoff, so the next drop starts over rather than at 10s.
      next.onopen = () => {
        attempt = 0
      }

      next.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') {
          return
        }
        const parsed = serverFrame.safeParse(parseJson(event.data))
        if (!parsed.success) {
          // An unreadable frame may have been a trade, so recover over REST
          // rather than leave the blotter quietly wrong.
          console.warn('tapedeck: discarding an unreadable frame', parsed.error.issues)
          refetch()
          return
        }
        handle(parsed.data)
      }

      // onerror is always followed by onclose, so the reconnect lives in one place.
      next.onclose = () => {
        if (disposed) {
          return
        }
        schedule()
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(timer)
      // Closing a socket mid-handshake aborts it, which is what a double-invoked
      // development effect wants.
      socket?.close()
    }
  }, [queryClient])
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
