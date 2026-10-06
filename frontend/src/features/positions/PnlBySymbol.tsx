import type { Position } from '@tapedeck/shared'
import { formatDecimal, fromMinorUnits } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useId, useMemo } from 'react'
import { SECTION_LABEL } from '../../lib/ui.js'
import { barScale, barWidth } from '../blotter/magnitude.js'
import { pnlMinor, pnlTone } from './pnl.js'

/** Below this the ranking says nothing: one bar fills the track whatever it holds. */
const MIN_ROWS = 2

export type MarkedSymbol = {
  symbol: string
  minor: bigint
}

type Props = {
  positions: readonly Position[]
}

/** Biggest mover first, either way, because the question is which symbol is
 *  carrying the book rather than where it falls in the alphabet. Symbol breaks
 *  a tie, so the order does not shuffle between frames. */
export function ranked(positions: readonly Position[]): MarkedSymbol[] {
  const marked: MarkedSymbol[] = []

  for (const position of positions) {
    const minor = pnlMinor(position)
    if (minor !== null) marked.push({ symbol: position.symbol, minor })
  }

  return marked.sort((left, right) => {
    const a = abs(left.minor)
    const b = abs(right.minor)
    if (a === b) return left.symbol.localeCompare(right.symbol)

    return a < b ? 1 : -1
  })
}

function abs(minor: bigint): bigint {
  return minor < 0n ? -minor : minor
}

/** The P&L column as sizes rather than digits: the figures are two inches above,
 *  and what they do not give is which symbol is carrying the book. */
export function PnlBySymbol({ positions }: Props): ReactElement | null {
  const rows = useMemo(() => ranked(positions), [positions])
  const headingId = useId()

  const largest = rows[0]
  if (largest === undefined || rows.length < MIN_ROWS) return null

  // Quantised off the biggest mover, so an arrival two seconds later does not
  // redraw every bar beside it.
  const scale = barScale(abs(largest.minor))

  return (
    <section aria-labelledby={headingId} className="border-t border-tape-line px-1.5 py-1">
      <h3 className={`flex h-5 items-center ${SECTION_LABEL}`} id={headingId}>
        P&amp;L by symbol
      </h3>

      <ul>
        {rows.map(({ symbol, minor }) => (
          <li key={symbol} className="flex h-5 items-center gap-1">
            <span className="w-9 shrink-0 truncate text-tape-muted">{symbol}</span>

            {/* Not announced: the symbol and figure either side of it already say
              everything a bar can, and the table above says it a third time. */}
            <span aria-hidden="true" className="flex h-2 min-w-0 flex-1 items-stretch">
              {/* A loss grows left off the centre line, so side reads before the
                digits do. justify-end is what puts its end against the axis. */}
              <span className="flex flex-1 justify-end">
                {minor < 0n ? <Bar minor={minor} scale={scale} /> : null}
              </span>
              <span className="w-px shrink-0 bg-tape-line" />
              <span className="flex flex-1">
                {minor > 0n ? <Bar minor={minor} scale={scale} /> : null}
              </span>
            </span>

            {/* Fixed, or each row's track ends somewhere else and the bars stop
              being comparable. 120px holds -99,999,999.99 at 13px monospace. */}
            <span className={`w-[120px] shrink-0 text-right tabular-nums ${pnlTone(minor)}`}>
              {formatDecimal(fromMinorUnits(minor), 2)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** min-w-px so a symbol that has barely moved still reads as present rather than
 *  as missing from the chart. */
function Bar({ minor, scale }: { minor: bigint; scale: bigint }): ReactElement {
  const fill = minor < 0n ? 'bg-tape-sell/40' : 'bg-tape-buy/40'

  return (
    <span
      className={`min-w-px rounded-xs ${fill}`}
      style={{ width: `${barWidth(abs(minor), scale)}%` }}
    />
  )
}
