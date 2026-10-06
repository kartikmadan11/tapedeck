import type { Trade } from '@tapedeck/shared'
import type { ReactElement } from 'react'

/** The columns whose filter box is free text and has something to offer. */
export type Suggestions = Record<'symbol' | 'trader' | 'book' | 'counterparty', string[]>

/**
 * Taken off the tape rather than from the reference lists, so every suggestion
 * matches a row and a value on the tape that is not in the list shows up here
 * instead of hiding, which is what the phantom `EQ-LDN-1` book was. Unfiltered,
 * so the lists do not shift while a filter is being typed.
 */
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

/**
 * A datalist rather than a select, because the box filters by substring: a
 * select would refuse `LD` for every London book. Typing still accepts anything,
 * so a value that has left the tape can still be filtered on.
 */
export function SuggestionList({ id, values }: Props): ReactElement {
  return (
    <datalist id={id}>
      {values.map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  )
}
