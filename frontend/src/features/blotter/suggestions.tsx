import type { Trade } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useMemo } from 'react'
import type { SelectOption } from '../../components/Select.js'

/** The columns whose filter offers what is on the tape: a picklist for symbol,
 *  trader and book, a free text box for counterparty. */
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

/** No filter first, then each value on the tape. The value in force is kept
 *  when it is not on the tape, as from a shared link, or the control would show
 *  a blank over a filtered grid. */
export function filterChoices(
  values: readonly string[],
  value: string,
  all: string,
): SelectOption[] {
  const listed = value === '' || values.includes(value) ? values : [...values, value].sort()
  return [{ value: '', label: all }, ...listed.map((each) => ({ value: each, label: each }))]
}

/** Separates the values in a memo key. No symbol, trader or book holds it. */
const JOIN = '\u0000'

/** Keyed on the values rather than the array: every tick re-derives the lists, and
 *  a new array holding the same values should not hand the control new options. */
export function useFilterChoices(
  values: readonly string[],
  value: string,
  all: string,
): SelectOption[] {
  const key = values.join(JOIN)
  return useMemo(
    () => filterChoices(key === '' ? [] : key.split(JOIN), value, all),
    [key, value, all],
  )
}

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
