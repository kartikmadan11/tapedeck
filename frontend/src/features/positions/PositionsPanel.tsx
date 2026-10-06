import { formatDecimal } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { formatQuantity } from '../../lib/format.js'
import { MICRO_LABEL } from '../../lib/ui.js'
import { usePositions } from './usePositions.js'

/**
 * What the panel is worth on opening, and the range a drag may take it over.
 * Declared here rather than where the boundary is drawn, because the floor is
 * the width at which three columns of six-figure notional stop truncating.
 */
export const PANEL_WIDTH = 288
export const PANEL_MIN_WIDTH = 216
export const PANEL_MAX_WIDTH = 560

type Props = {
  width: number
  /** Referenced by the rail's aria-controls, so it is passed in. */
  id: string
}

export function PositionsPanel({ width, id }: Props): ReactElement {
  const positions = usePositions()

  return (
    // overflow-hidden so the table inside cannot paint past the rounded corner.
    // The width is driven rather than declared, because the handle beside it
    // writes this same property directly while it is being dragged.
    <aside
      className="flex shrink-0 flex-col overflow-hidden rounded-sm border border-tape-line"
      id={id}
      style={{ width }}
    >
      {/* h-8 matches the blotter's header band, so the two panels align. */}
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-tape-line bg-tape-panel px-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em]">Positions</h2>
        <span className={MICRO_LABEL}>{positions.length} symbols</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          {/* Opaque as well as sticky, or the rows scroll through the labels. */}
          <thead className="sticky top-0 z-10 bg-tape-panel">
            <tr className="h-7">
              <th className={`px-1.5 ${HEAD}`}>Symbol</th>
              <th className={`px-1.5 text-right ${HEAD}`}>Net Qty</th>
              <th className={`px-1.5 text-right ${HEAD}`}>Net Notional</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr
                key={position.symbol}
                className="h-7 border-t border-tape-line/60 hover:bg-tape-raised"
              >
                <td className="px-1.5 font-semibold">{position.symbol}</td>
                <td
                  className={`px-1.5 text-right tabular-nums ${
                    position.netQuantity < 0 ? 'text-tape-sell' : 'text-tape-buy'
                  }`}
                  title={`${formatQuantity(position.boughtQuantity)} bought, ${formatQuantity(
                    position.soldQuantity,
                  )} sold, ${position.tradeCount} active trades`}
                >
                  {formatQuantity(position.netQuantity)}
                </td>
                <td className="px-1.5 text-right tabular-nums text-tape-text">
                  {formatDecimal(position.netNotional, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {positions.length === 0 ? (
          <p className="px-2 py-6 text-center text-tape-muted">No active trades.</p>
        ) : null}
      </div>
    </aside>
  )
}

const HEAD = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-tape-muted'
