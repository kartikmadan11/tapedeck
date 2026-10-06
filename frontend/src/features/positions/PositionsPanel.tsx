import { formatDecimal, fromMinorUnits } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { formatQuantity } from '../../lib/format.js'
import { MICRO_LABEL } from '../../lib/ui.js'
import { pnlMinor } from './pnl.js'
import { bookTotals } from './totals.js'
import { usePositions } from './usePositions.js'

/** Declared here rather than where the boundary is drawn: the floor is the width at
 *  which four columns of six-figure notional stop truncating. */
export const PANEL_WIDTH = 384
export const PANEL_MIN_WIDTH = 288
export const PANEL_MAX_WIDTH = 560

/** On the header, not in a legend: the qualifier has to travel with the figure, or
 *  the column reads as mark-to-market. */
const PNL_NOTE =
  'Marked against each instrument reference price, a static indicative level rather than a live market price'

type Props = {
  width: number
  /** Referenced by the rail's aria-controls, so it is passed in. */
  id: string
}

export function PositionsPanel({ width, id }: Props): ReactElement {
  const positions = usePositions()
  const totals = useMemo(() => bookTotals(positions), [positions])

  return (
    // overflow-hidden so the table cannot paint past the rounded corner. The width
    // is driven, because the handle beside it writes this property during a drag.
    <aside
      className="flex shrink-0 flex-col overflow-hidden rounded-sm border border-tape-line"
      id={id}
      style={{ width }}
    >
      {/* h-8 matches the blotter's header band, so the two panels align. The right
        padding is the frame's hide tab, laid over this corner, so the count
        clears it. */}
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-tape-line bg-tape-panel pr-7 pl-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em]">Positions</h2>
        <span className={MICRO_LABEL}>{positions.length} symbols</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* nowrap, or a figure wider than its column breaks the 28px row. */}
        <table className="w-full border-collapse whitespace-nowrap text-left">
          {/* Opaque as well as sticky, or the rows scroll through the labels. */}
          <thead className="sticky top-0 z-10 bg-tape-panel">
            <tr className="h-7">
              <th className={`px-1.5 ${HEAD}`}>Symbol</th>
              <th className={`px-1.5 text-right ${HEAD}`}>Net Qty</th>
              <th className={`px-1.5 text-right ${HEAD}`}>Net Notional</th>
              <th className={`px-1.5 text-right ${HEAD}`} title={PNL_NOTE}>
                P&amp;L vs ref
              </th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => {
              const pnl = pnlMinor(position)

              return (
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
                  {/* A dash, not a zero: the master can drop a symbol a position is
                    still held in, and a zero there reads as flat. */}
                  <td className={`px-1.5 text-right tabular-nums ${tone(pnl)}`}>
                    {pnl === null ? '-' : formatDecimal(fromMinorUnits(pnl), 2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {positions.length === 0 ? (
          <p className="px-2 py-6 text-center text-tape-muted">No active trades.</p>
        ) : null}
      </div>

      {/* The book, under the symbols it is made of. No live region: these move with
        every frame of the feed, and announcing them would talk over the tape. */}
      {positions.length === 0 ? null : (
        <dl className="shrink-0 border-t border-tape-line bg-tape-panel px-1.5 py-1">
          <Total label="Gross" value={formatDecimal(fromMinorUnits(totals.grossMinor), 2)} />
          <Total label="Net" value={formatDecimal(fromMinorUnits(totals.netMinor), 2)} />
          <Total
            label="P&L vs ref"
            title={PNL_NOTE}
            tone={tone(totals.pnlMinor)}
            value={formatDecimal(fromMinorUnits(totals.pnlMinor), 2)}
          />
          <Total label="Trades" value={formatQuantity(totals.activeTrades)} />
        </dl>
      )}
    </aside>
  )
}

type TotalProps = {
  label: string
  value: string
  tone?: string | undefined
  title?: string | undefined
}

/** The label gives way and the figure does not, so a narrow panel costs the word
 *  rather than a digit. */
function Total({ label, title, tone: figureTone, value }: TotalProps): ReactElement {
  return (
    <div className="flex h-6 items-center justify-between gap-2">
      <dt className={`min-w-0 truncate ${MICRO_LABEL}`} title={title}>
        {label}
      </dt>
      <dd className={`shrink-0 tabular-nums ${figureTone ?? 'text-tape-text'}`}>{value}</dd>
    </div>
  )
}

/** Zero is a position that happens to be flat, so it is not coloured as a gain. */
function tone(minor: bigint | null): string {
  if (minor === null || minor === 0n) return 'text-tape-muted'

  return minor < 0n ? 'text-tape-sell' : 'text-tape-buy'
}

const HEAD = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-tape-muted'
