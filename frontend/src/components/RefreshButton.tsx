import type { ReactElement } from 'react'
import { CHIP } from '../lib/ui.js'

type Props = { onRefresh: () => void; refreshing: boolean }

/** For when the socket is not the freshness mechanism. Cannot lose frames: the
 *  refetch goes through the same cursor guard as every other writer. */
export function RefreshButton({ onRefresh, refreshing }: Props): ReactElement {
  return (
    <button type="button" className={CHIP} onClick={onRefresh} disabled={refreshing}>
      {refreshing ? 'Refreshing' : 'Refresh'}
    </button>
  )
}
