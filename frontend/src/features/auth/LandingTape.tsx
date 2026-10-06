import type { Side } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { formatQuantity, formatTime } from '../../lib/format.js'

interface Print {
  side: Side
  symbol: string
  quantity: number
  price: string
}

/** Decorative, deliberately not the instrument master: nothing here is booked, and
 *  the frontend does not depend on the data the seed books from. */
const PRINTS: readonly Print[] = [
  { side: 'BUY', symbol: 'VOD', quantity: 50_000, price: '68.4200' },
  { side: 'SELL', symbol: 'BARC', quantity: 25_000, price: '192.3500' },
  { side: 'BUY', symbol: 'SHEL', quantity: 2_000, price: '2714.5000' },
  { side: 'BUY', symbol: 'LLOY', quantity: 100_000, price: '54.2800' },
  { side: 'SELL', symbol: 'AZN', quantity: 500, price: '10842.0000' },
  { side: 'BUY', symbol: 'HSBA', quantity: 10_000, price: '648.7000' },
  { side: 'SELL', symbol: 'BP', quantity: 15_000, price: '412.1500' },
  { side: 'BUY', symbol: 'RIO', quantity: 1_500, price: '4821.5000' },
  { side: 'SELL', symbol: 'TSCO', quantity: 20_000, price: '338.9000' },
  { side: 'BUY', symbol: 'GSK', quantity: 5_000, price: '1456.8000' },
]

/** As many as read as a tape without the tape becoming the page. */
const ROWS = 7

/** Faster than the simulator's two seconds: at that gap the tape reads as a
 *  screenshot. */
const PRINT_MS = 1_100

interface Row extends Print {
  /** Counts up forever, so React never reuses a flash on a row that only moved. */
  key: number
  at: string
}

/** Seeded full, so the tape is never an empty box on first paint and the
 *  reduced-motion fallback needs no branch of its own. */
function initialRows(): Row[] {
  const now = Date.now()
  return PRINTS.slice(0, ROWS).map((print, index) => ({
    ...print,
    key: index,
    // Backdated a print apart, or it reads as seven trades at one instant.
    at: new Date(now - index * PRINT_MS).toISOString(),
  }))
}

/** Trades arriving on their own, shown before anyone has signed in. */
export function LandingTape(): ReactElement {
  const [rows, setRows] = useState<Row[]>(initialRows)
  const cursor = useRef(ROWS)

  useEffect(() => {
    // Nothing starts rather than something stopping: the seeded rows above are
    // already the whole static fallback.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    const id = window.setInterval(() => {
      const print = PRINTS.at(cursor.current % PRINTS.length)
      if (print === undefined) {
        return
      }
      const key = cursor.current
      cursor.current += 1
      setRows((current) => [
        { ...print, key, at: new Date().toISOString() },
        ...current.slice(0, ROWS - 1),
      ])
    }, PRINT_MS)

    return () => window.clearInterval(id)
  }, [])

  return (
    // No stated height: a print arriving drops the oldest in the same update, so
    // the row count never changes and the box cannot move what is under it.
    <ul aria-label="Live trade prints" className="border-y border-tape-line py-1">
      {rows.map((row, index) => (
        <li
          // Only the newest, and only once: tape-flash lands on a fresh key.
          className={`flex gap-3 tabular-nums ${index === 0 ? 'tape-flash' : ''}`}
          key={row.key}
        >
          <span className="text-tape-muted">{formatTime(row.at)}</span>
          <span className={`w-10 ${row.side === 'BUY' ? 'text-tape-buy' : 'text-tape-sell'}`}>
            {row.side}
          </span>
          <span className="w-12">{row.symbol}</span>
          <span className="w-20 text-right">{formatQuantity(row.quantity)}</span>
          <span className="w-24 text-right text-tape-muted">{row.price}</span>
        </li>
      ))}
    </ul>
  )
}
