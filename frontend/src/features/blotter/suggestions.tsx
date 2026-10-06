import type { Trade } from '@tapedeck/shared'
import type { ReactElement } from 'react'

/** The columns whose filter box is free text. */
export type Suggestions = Record<'symbol' | 'trader' | 'book' | 'counterparty', string[]>

/** Read off the tape, not the reference lists, so every suggestion matches a row.
 *  Unfiltered, so the lists hold still while a filter is being typed. */
export function suggestionsOf(trades: readonly Trade[]): Suggestions {
  return {
    symbol: distinct(trades, (trade) => trade.symbol),
    trader: distinct(trades, (trade) => trade.trader),
    book: distinct(trades, (trade) => trade.book),
    counterparty: distinct(trades, (trade) => trade.counterparty),
  }
}

function distinct(trades: readonly Trade[], of: (trade: Trade) => string): string[] {
  return [...new Set(trades.map(of))].sort()
}

type Props = { id: string; values: readonly string[] }

/** A datalist, not a select: the box filters by substring, so `LD` has to be
 *  accepted, as does a value that has left the tape. */
export function SuggestionList({ id, values }: Props): ReactElement {
  return (
    <datalist id={id}>
      {values.map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  )
}
