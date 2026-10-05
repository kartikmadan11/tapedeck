import type { ColumnDef, Row, RowData, VisibilityState } from '@tanstack/react-table'
import { createColumnHelper } from '@tanstack/react-table'
import type { DecimalString, Trade } from '@tapedeck/shared'
import {
  compareDecimal,
  decimalString,
  formatDecimal,
  netNotional,
  netQuantity,
  notional,
  vwap,
} from '@tapedeck/shared'
import type { ReactElement, ReactNode } from 'react'
import { formatDateTime, formatQuantity } from '../../lib/format.js'
import { Magnitude } from './magnitude.js'

// Right-aligning numbers is a property of the column, not of every cell, so the
// class travels on the column and the table applies it.
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string
  }
}

const helper = createColumnHelper<Trade>()

/**
 * Money columns sort by value, not by text. Price is an exact decimal string, so
 * the default comparator would place '10.000000' before '9.000000'. This is the
 * one place the decimal-string decision costs something, and it costs four lines.
 */
function byDecimal(rowA: Row<Trade>, rowB: Row<Trade>, columnId: string): number {
  return compareDecimal(
    rowA.getValue<DecimalString>(columnId),
    rowB.getValue<DecimalString>(columnId),
  )
}

/**
 * At least this many shares. A floor rather than a range, because the question
 * the panel is there to answer is "show me the size", not "show me between two
 * sizes".
 *
 * A value that is not yet a number passes everything through. The box is filtered
 * on every keystroke, and a half-typed bound that emptied the grid would read as
 * no matches rather than as not finished typing.
 */
function atLeastQuantity(row: Row<Trade>, columnId: string, value: string): boolean {
  const floor = Number(value)
  return !Number.isFinite(floor) || row.getValue<number>(columnId) >= floor
}

/** The same floor on an exact decimal, compared in bigint rather than parsed. */
function atLeastDecimal(row: Row<Trade>, columnId: string, value: string): boolean {
  const floor = decimalString.safeParse(value)
  return !floor.success || compareDecimal(row.getValue<DecimalString>(columnId), floor.data) >= 0
}

const NUMERIC = 'text-right tabular-nums'

/*
 * Every column states a `size`, and that is a requirement rather than a
 * preference. The table is laid out with `table-layout: fixed`, which takes the
 * widths from the colgroup and never measures a cell, and a virtualised grid has
 * no choice about that: column widths decided by the rows in view would change
 * as new rows scrolled in, so the digits down Quantity, Price and Notional would
 * drift out of line exactly while a trader was reading them.
 *
 * The numbers are the widest value each column holds, in Geist Mono at 13px,
 * plus the cell's own px-1.5. They total 1,340px, which still overflows a laptop
 * pane and is why the leftmost column is held against the edge.
 */

/**
 * Blanks a group row's cell for a column with nothing to net. Grouping now
 * drops those columns outright, so what is left for this to cover is the split:
 * grouping by symbol and splitting by book leaves the Book column aggregated on
 * the symbol rows above it, and TanStack's default of 'auto' would put some
 * reading of four book names in there.
 *
 * Set here rather than on useReactTable because what a cell shows is this file's
 * subject. Cheap as well as correct: a cell that never reads getValue never runs
 * the aggregation behind it.
 */
export const DEFAULT_COLUMN: Partial<ColumnDef<Trade>> = {
  aggregatedCell: () => null,
}

/**
 * The legs a group row nets: its leaves, minus the cancelled ones. A cancelled
 * trade did not happen, so netting it in would make a group row disagree with the
 * positions panel, which sums only active trades in SQL. Trade satisfies
 * PricedLeg structurally, so no mapping is needed.
 *
 * leafRows, not childRows, so a Split By level's parent nets every trade beneath
 * it rather than re-netting its sub-group rows.
 */
function activeLegs(leafRows: Row<Trade>[]): Trade[] {
  return leafRows.filter((row) => row.original.status !== 'CANCELLED').map((row) => row.original)
}

/** Matches the positions panel: a net short reads in the sell colour. */
function netFigure(text: string, short: boolean): ReactElement {
  return <span className={short ? 'text-tape-sell' : 'text-tape-buy'}>{text}</span>
}

/** Active trades under a group row. getLeafRows includes its sub-group rows. */
function activeLeaves(row: Row<Trade>): Trade[] {
  return activeLegs(row.getLeafRows().filter((leaf) => !leaf.getIsGrouped()))
}

/**
 * Opens a group and counts the trades it nets. Rides the grouped column, which
 * the config panel locks visible, so the control cannot be hidden. depth is the
 * indent, so a split reads as nested.
 */
export function GroupToggle({
  row,
  children,
}: {
  row: Row<Trade>
  children: ReactNode
}): ReactElement {
  const open = row.getIsExpanded()
  const legs = activeLeaves(row).length

  return (
    <button
      type="button"
      // The row behind this handles the same click, so without stopping it here
      // the group would toggle twice and appear not to respond at all.
      onClick={(event) => {
        event.stopPropagation()
        row.toggleExpanded()
      }}
      aria-expanded={open}
      aria-label={`${String(row.groupingValue)}, ${legs} trades`}
      className="flex cursor-pointer items-center gap-1.5 text-tape-text hover:text-tape-accent"
      style={{ paddingLeft: `${row.depth * 0.75}rem` }}
    >
      {/* Fixed width so the label does not shift when the group opens. */}
      <span aria-hidden="true" className="inline-block w-2 text-tape-accent">
        {open ? '▾' : '▸'}
      </span>
      {children}
      {/* Bracketed: a bare 2 beside VOD reads as a figure about VOD. */}
      <span className="tabular-nums text-tape-muted">({formatQuantity(legs)})</span>
    </button>
  )
}

// The return type is inferred on purpose. Annotating it as ColumnDef<Trade, T>[]
// needs one T for columns whose values are strings, numbers and decimals alike,
// which only `any` satisfies.
//
// Takes no arguments: every column is now a projection of the trade, and acting
// on one is the selection bar's job rather than a cell's.
export function createColumns() {
  return [
    // A reference key, not something read while scanning, so it is off by
    // default. Keeps position zero for when it is turned on, because then it is
    // what someone is looking for.
    helper.accessor('tradeId', {
      header: 'Trade',
      size: 104,
      // Grouping by it would make a group per trade.
      enableGrouping: false,
      cell: (info) => <span className="text-tape-muted">{info.getValue()}</span>,
    }),

    // Wider than a ticker needs, because grouping by symbol puts the expander
    // and the trade count in here beside it.
    helper.accessor('symbol', {
      header: 'Symbol',
      size: 104,
      cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
    }),

    helper.accessor('side', {
      header: 'Side',
      size: 76,
      // min-w is the point: BUY and SELL are different widths, so without a
      // floor the badges jag down the column.
      cell: (info) => (
        <span
          className={`inline-flex min-w-11 justify-center rounded-xs px-1.5 py-px text-[10px] font-semibold tracking-[0.1em] ${
            info.getValue() === 'BUY'
              ? 'bg-tape-buy/15 text-tape-buy'
              : 'bg-tape-sell/15 text-tape-sell'
          }`}
        >
          {info.getValue()}
        </span>
      ),
    }),

    helper.accessor('price', {
      header: 'Price',
      size: 96,
      meta: { className: NUMERIC },
      sortingFn: byDecimal,
      enableGrouping: false,
      cell: (info) => formatDecimal(info.getValue(), 4),
      // Volume-weighted and computed in bigint. An average execution price is
      // read as authoritative, and it is the one figure here a reviewer would
      // check against a calculator.
      aggregationFn: (_columnId, leafRows) => vwap(activeLegs(leafRows)),
      aggregatedCell: (info) => {
        const average = info.getValue<DecimalString | null>()
        // A group of nothing but cancelled trades has no average price to
        // report, and a zero would be a claim about where it dealt.
        if (average === null) {
          return <span className="text-tape-muted">-</span>
        }
        // Four places, as the leaf cells use, so the average lines up under the
        // prices it averages.
        return formatDecimal(average, 4)
      },
    }),

    helper.accessor('quantity', {
      header: 'Quantity',
      size: 120,
      meta: { className: NUMERIC },
      enableGrouping: false,
      filterFn: atLeastQuantity,
      cell: (info) => formatQuantity(info.getValue()),
      // Netted by side, so a group that is short reads negative. Whole shares,
      // so a number holds the total exactly.
      aggregationFn: (_columnId, leafRows) => netQuantity(activeLegs(leafRows)),
      aggregatedCell: (info) => {
        const net = info.getValue<number>()
        return netFigure(formatQuantity(net), net < 0)
      },
    }),

    // Computed in bigint minor units, so the column agrees with the positions
    // panel to the last place rather than approximately.
    helper.accessor((row) => notional(row.quantity, row.price), {
      id: 'notional',
      header: 'Notional',
      size: 136,
      meta: { className: NUMERIC },
      sortingFn: byDecimal,
      enableGrouping: false,
      filterFn: atLeastDecimal,
      // The one column that draws itself. Leaf rows only: a group row's net is
      // measured against other nets rather than against single trades, and one
      // bar cannot honestly carry both scales.
      cell: (info) => <Magnitude value={info.getValue()} />,
      // Signed exposure, the same computation selectPositions runs in SQL.
      aggregationFn: (_columnId, leafRows) => netNotional(activeLegs(leafRows)),
      aggregatedCell: (info) => {
        const net = info.getValue<DecimalString>()
        // Tested against the string, not Number(net): the sign is already in the
        // first character and crossing into float to read it would be gratuitous.
        return netFigure(formatDecimal(net, 2), net.startsWith('-'))
      },
    }),

    // After the economics, not in front of them: the tape is ordered by time, so
    // the sequence is already readable down the rows without reading the column.
    helper.accessor('tradeTimestamp', {
      header: 'Time (UTC)',
      size: 152,
      // Millisecond precision, so every trade is its own group.
      enableGrouping: false,
      cell: (info) => formatDateTime(info.getValue()),
    }),

    helper.accessor('trader', { header: 'Trader', size: 104 }),
    helper.accessor('book', { header: 'Book', size: 104 }),
    // The widest of these is Citadel Securities, so the column is sized for the
    // longest name the counterparty list holds rather than for the average.
    helper.accessor('counterparty', { header: 'Counterparty', size: 160 }),

    helper.accessor('status', {
      header: 'Status',
      size: 120,
      // The dot is an element and the label a bare text node, so the queries
      // that look up a row by its status still read exactly one word.
      cell: (info) => {
        const cancelled = info.getValue() === 'CANCELLED'
        return (
          <span
            className={`inline-flex items-center gap-1.5 ${
              cancelled ? 'text-tape-sell' : 'text-tape-muted'
            }`}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {cancelled ? 'CANCELLED' : 'ACTIVE'}
          </span>
        )
      },
    }),

    // Shown because it is the token the amend contract is built on: a reviewer
    // can watch it move and see why the second amend is rejected.
    helper.accessor('version', {
      header: 'Ver',
      size: 64,
      meta: { className: NUMERIC },
      // A sum of version numbers is not a number about anything, and grouping
      // trades by how many times they were amended is not a view of a book.
      enableGrouping: false,
    }),
  ]
}

/**
 * The columns a group row cannot answer for, which is every one with nothing to
 * net. Read off the definitions above rather than listed again: a column nets
 * exactly when it declares an aggregationFn, so there is no second list to
 * drift. Taken once, because the definitions do not change.
 */
const NOTHING_TO_NET: VisibilityState = Object.fromEntries(
  createColumns()
    .filter((def) => def.aggregationFn === undefined)
    // The id the table will give the column: its accessor key, or the stated id
    // for the one column computed from a trade rather than read off it.
    .map((def) => ['accessorKey' in def ? def.accessorKey : def.id, false]),
)

/**
 * What a grouped view shows, as an override to lay over the columns a trader
 * chose. Empty while there is no grouping, so their choice is all there is.
 *
 * Eight of the twelve columns were rendering as an empty cell on every group
 * row, which is eight columns to scroll past to reach the four figures a
 * grouped view is opened for. A group of forty trades has no one counterparty
 * and no one timestamp, so there is nothing to put there and no width worth
 * spending on it.
 *
 * Derived rather than stored, which is the whole of why this is a function and
 * not a setState. Clearing the grouping hands a trader back exactly the columns
 * they had, and a shared link carries what they chose rather than what the
 * grouping did to it.
 *
 * The columns being grouped on are forced visible: they carry the label and the
 * expander, so grouping by a column that happened to be hidden would otherwise
 * produce groups that can be neither read nor opened.
 */
export function groupedVisibility(grouping: readonly string[]): VisibilityState {
  if (grouping.length === 0) {
    return {}
  }

  return { ...NOTHING_TO_NET, ...Object.fromEntries(grouping.map((id) => [id, true])) }
}
