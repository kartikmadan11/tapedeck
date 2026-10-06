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

/**
 * The only socket in the application. It writes frames into the blotter cache
 * through the pure reducer, so this hook holds nothing but connection lifecycle.
 *
 * There is no explicit resync request. The server answers every connection with
 * a consistent snapshot, so reconnecting is the resync, and a detected gap is
 * handled by refetching over REST.
 */
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
      // Not blotter state, so it is routed out before the reducer rather than
      // given a no-op branch there. Carries no cursor, so there is nothing to
      // guard against staleness: the latest one wins, as with positions.
      if (frame.type === 'simulation') {
        queryClient.setQueryData<SimulationState>(queryKeys.simulation, {
          running: frame.running,
          intervalMs: frame.intervalMs,
        })
        return
      }

      // Read before the write so the gap test sees the cursor the frame arrived
      // against, and so no side effect runs inside the cache updater.
      const before = queryClient.getQueryData<BlotterState>(queryKeys.blotter) ?? emptyBlotter

      queryClient.setQueryData<BlotterState>(queryKeys.blotter, (prev) =>
        apply(prev ?? emptyBlotter, frame),
      )

      if (isTradeDelta(frame) && hasGap(before, frame)) {
        refetch()
      }
    }

    const schedule = (): void => {
      // Doubling with jitter, so a browser with several tabs open does not
      // reconnect all of them in the same millisecond after an outage.
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
          // A frame this client cannot read may have been a trade, so recover
          // over REST rather than leave the blotter quietly wrong.
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
      // Closing a socket that is still opening aborts the handshake, which is the
      // wanted behaviour under a double-invoked development effect.
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
