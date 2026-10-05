import type { ReactElement } from 'react'
import { CHIP } from '../lib/ui.js'

type Props = { onRefresh: () => void; refreshing: boolean }

/**
 * The socket is the freshness mechanism, so this is for when it is not: a
 * reconnecting client, or a deliberate re-read of the API. Pressing it cannot
 * lose frames, because the refetch goes through the same cursor guard as every
 * other writer.
 */
export function RefreshButton({ onRefresh, refreshing }: Props): ReactElement {
  return (
    <button type="button" className={CHIP} onClick={onRefresh} disabled={refreshing}>
      {refreshing ? 'Refreshing' : 'Refresh'}
    </button>
  )
}
