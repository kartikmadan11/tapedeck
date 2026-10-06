import type { CellContext, ColumnDef, Row, RowData, VisibilityState } from '@tanstack/react-table'
import { createColumnHelper, flexRender } from '@tanstack/react-table'
import type { DecimalString, Trade, TradeStatus } from '@tapedeck/shared'
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
import { formatCount, formatDateTime, formatQuantity } from '../../lib/format.js'
import { Magnitude } from './magnitude.js'

// Lets a column carry its alignment class, which the table applies to its cells.
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string
  }
}

const helper = createColumnHelper<Trade>()

/** Price is an exact decimal string, so the default comparator would sort
 *  '10.000000' before '9.000000'. */
function byDecimal(rowA: Row<Trade>, rowB: Row<Trade>, columnId: string): number {
  return compareDecimal(
    rowA.getValue<DecimalString>(columnId),
    rowB.getValue<DecimalString>(columnId),
  )
}

/** At least this many shares. A half-typed number passes everything through, or
 *  the grid would read as no matches mid-keystroke. */
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

/* Every column must state a `size`: the table is table-layout: fixed, so widths
 * come from the colgroup and no cell is measured. Each is its column's widest
 * value in Geist Mono at 13px with px-1.5, totalling 1,500px. */

/** Blanks a group row's cell where there is nothing to net. TanStack's default
 *  of 'auto' would otherwise put a sum or a first value there. */
export const DEFAULT_COLUMN: Partial<ColumnDef<Trade>> = {
  aggregatedCell: () => null,
}

/** A group row's leaves minus the cancelled ones, so a group agrees with the
 *  positions panel, which sums only active trades in SQL. */
function activeLegs(leafRows: Row<Trade>[]): Trade[] {
  return leafRows.filter((row) => row.original.status !== 'CANCELLED').map((row) => row.original)
}

/** Coloured by what the status asks of a trader: working, done, struck. */
const STATUS_COLOUR: Record<TradeStatus, string> = {
  NEW: 'text-tape-accent',
  PARTIALLY_FILLED: 'text-tape-warn',
  FILLED: 'text-tape-buy',
  CANCELLED: 'text-tape-sell',
}

/** Matches the positions panel: a net short reads in the sell colour. */
function netFigure(text: string, short: boolean): ReactElement {
  return <span className={short ? 'text-tape-sell' : 'text-tape-buy'}>{text}</span>
}

/** Active trades under a group row. getLeafRows includes its sub-group rows. */
function activeLeaves(row: Row<Trade>): Trade[] {
  return activeLegs(row.getLeafRows().filter((leaf) => !leaf.getIsGrouped()))
}

/** Opens a group and counts the trades it nets. Rides the grouped column, which
 *  the config panel locks visible so the control cannot be hidden. */
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
      // The row behind handles the same click: without stopping it, the group
      // toggles twice and appears not to respond.
      onClick={(event) => {
        event.stopPropagation()
        row.toggleExpanded()
      }}
      aria-expanded={open}
      aria-label={`${String(row.groupingValue)}, ${formatCount(legs, 'trade')}`}
      className="flex cursor-pointer items-center gap-1.5 text-tape-text hover:text-tape-accent"
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

// Return type inferred on purpose: one T over string, number and decimal columns
// could only be `any`.
export function createColumns() {
  return [
    // A reference key rather than something scanned, so off by default. Holds
    // position zero, which is the pinned column, for when it is turned on.
    helper.accessor('tradeId', {
      header: 'Trade',
      size: 104,
      // Grouping by it would make a group per trade.
      enableGrouping: false,
      cell: (info) => <span className="text-tape-muted">{info.getValue()}</span>,
    }),

    // Wider than a ticker: grouping puts the expander and the count in here too.
    helper.accessor('symbol', {
      header: 'Symbol',
      size: 104,
      cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
    }),

    helper.accessor('side', {
      header: 'Side',
      size: 76,
      // min-w: BUY and SELL differ in width, so the badges would jag otherwise.
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
      // Volume-weighted and computed in bigint.
      aggregationFn: (_columnId, leafRows) => vwap(activeLegs(leafRows)),
      aggregatedCell: (info) => {
        const average = info.getValue<DecimalString | null>()
        // An all-cancelled group: a zero would be a claim about where it dealt.
        if (average === null) {
          return <span className="text-tape-muted">-</span>
        }
        // Four places, as the leaf cells use, so the average lines up under them.
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

    helper.accessor('filledQuantity', {
      header: 'Filled',
      size: 120,
      meta: { className: NUMERIC },
      // Every value repeats a quantity, so grouping by it would group by nothing.
      enableGrouping: false,
      // Muted at zero: nothing has executed, so the figure to read is beside it.
      cell: (info) => {
        const value = info.getValue()
        return value === 0 ? <span className="text-tape-muted">0</span> : formatQuantity(value)
      },
      // Net executed quantity: the Quantity netting over what traded rather than
      // what was booked. The two read together are the remaining exposure.
      aggregationFn: (_columnId, leafRows) =>
        netQuantity(activeLegs(leafRows).map((leg) => ({ ...leg, quantity: leg.filledQuantity }))),
      aggregatedCell: (info) => {
        const net = info.getValue<number>()
        return netFigure(formatQuantity(net), net < 0)
      },
    }),

    // bigint minor units, so this agrees with the positions panel to the last place.
    helper.accessor((row) => notional(row.quantity, row.price), {
      id: 'notional',
      header: 'Notional',
      size: 136,
      meta: { className: NUMERIC },
      sortingFn: byDecimal,
      enableGrouping: false,
      filterFn: atLeastDecimal,
      // Leaf rows only: a group's net scales against other nets, and one bar
      // cannot carry both scales.
      cell: (info) => <Magnitude value={info.getValue()} />,
      // Signed exposure, the same computation selectPositions runs in SQL.
      aggregationFn: (_columnId, leafRows) => netNotional(activeLegs(leafRows)),
      aggregatedCell: (info) => {
        const net = info.getValue<DecimalString>()
        // Tested on the string, not Number(net): the sign is the first character.
        return netFigure(formatDecimal(net, 2), net.startsWith('-'))
      },
    }),

    helper.accessor('trader', { header: 'Trader', size: 104 }),
    helper.accessor('book', { header: 'Book', size: 104 }),
    // Sized for Citadel Securities, the longest name the counterparty list holds.
    helper.accessor('counterparty', { header: 'Counterparty', size: 160 }),

    helper.accessor('status', {
      // Wide enough for PARTIALLY_FILLED: the FIX name is not abbreviated.
      header: 'Status',
      size: 160,
      // The dot is an element and the label a bare text node, so queries that
      // look up a row by status still read one word.
      cell: (info) => (
        <span className={`inline-flex items-center gap-1.5 ${STATUS_COLOUR[info.getValue()]}`}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {info.getValue()}
        </span>
      ),
    }),

    helper.accessor('version', {
      header: 'Ver',
      size: 64,
      meta: { className: NUMERIC },
      // A sum of version numbers is not a number about anything.
      enableGrouping: false,
    }),

    // Last: the figures are scanned, the timestamp is checked after stopping.
    helper.accessor('tradeTimestamp', {
      header: 'Time (UTC)',
      size: 152,
      // Millisecond precision, so every trade is its own group.
      enableGrouping: false,
      cell: (info) => formatDateTime(info.getValue()),
    }),
  ]
}

// biome-ignore lint/suspicious/noExplicitAny: a heterogeneous column list has no single value type, which is why createColumns leaves its own return type inferred.
type AnyColumn = ColumnDef<Trade, any>

/** The id the table gives a column: its accessor key, or its stated id. */
function idOf(def: AnyColumn): string {
  return String('accessorKey' in def ? def.accessorKey : def.id)
}

/** The columns that net, read off the definitions rather than listed again: a
 *  column nets exactly when it declares an aggregationFn. */
const MEASURES: AnyColumn[] = createColumns().filter((def) => def.aggregationFn !== undefined)

/** The columns a group row cannot answer for, which is every other one. */
const NOTHING_TO_NET: VisibilityState = Object.fromEntries(
  createColumns()
    .filter((def) => def.aggregationFn === undefined)
    .map((def) => [idOf(def), false]),
)

/** The measures a split takes over, since it shows one of each per block. */
const MEASURES_OFF: VisibilityState = Object.fromEntries(MEASURES.map((def) => [idOf(def), false]))

/** The columns a grid may cut by, which is every one not opted out of grouping. */
const DIVIDERS: readonly string[] = createColumns()
  .filter((def) => def.enableGrouping !== false)
  .map(idOf)

/** Definition order, which is the order a pane opens on. */
export const BASE_ORDER: readonly string[] = createColumns().map(idOf)

/** The named ids, then the rest in definition order, which is how the table reads
 *  a partial order. Deduplicated: a hand-edited link can name a column twice. */
export function orderedColumnIds(columnOrder: readonly string[]): string[] {
  const named = [...new Set(columnOrder)].filter((id) => BASE_ORDER.includes(id))
  return [...named, ...BASE_ORDER.filter((id) => !named.includes(id))]
}

/** An override laid over the columns a trader chose, derived rather than stored so
 *  clearing the grouping gives their choice back. The grouped column is forced
 *  visible: it carries the label and the expander. Pivoted, the measures come off
 *  too, since the split shows one of each per block. */
export function groupedVisibility(groupBy: string | undefined, pivoted: boolean): VisibilityState {
  if (groupBy === undefined) {
    return {}
  }

  const grouped = { ...NOTHING_TO_NET, [groupBy]: true }
  return pivoted ? { ...grouped, ...MEASURES_OFF } : grouped
}

/** Every value is a whole block of measures, so an uncapped split is an uncapped grid. */
const MAX_BLOCKS = 8

/** Unit separator, which no value on the tape contains. */
const JOIN = '\u001f'

/** The blocks a split would lay across the grid, as one key. A string, not a list:
 *  the grid memoises its column model on it, and a fresh list every frame would
 *  rebuild the columns. Read off the whole book, so a filter cannot reshape the
 *  grid. Sorted before capped, so a block holds its place as the feed arrives. */
export function splitBlocks(trades: readonly Trade[], splitBy: string | undefined): string {
  if (splitBy === undefined || !DIVIDERS.includes(splitBy)) {
    return ''
  }

  const values = new Set<string>()
  for (const trade of trades) {
    const value = trade[splitBy as keyof Trade]
    if (typeof value === 'string') {
      values.add(value)
    }
  }

  return [...values].sort().slice(0, MAX_BLOCKS).join(JOIN)
}

/** One column group per block, holding the measures netted over that block's
 *  trades alone. The group header is what spans them. */
export function splitColumns(splitBy: string, blocks: string): AnyColumn[] {
  return blocks.split(JOIN).map((value) => ({
    id: `${splitBy}=${value}`,
    header: value,
    columns: MEASURES.map((measure) => blockMeasure(measure, splitBy, value)),
  }))
}

/** One measure narrowed to one block. Everything but the netting is the base
 *  column's, so a block reads exactly like the column it repeats. */
function blockMeasure(measure: AnyColumn, splitBy: string, value: string): AnyColumn {
  const within = (row: Row<Trade>): boolean => String(row.getValue(splitBy)) === value
  const net = measure.aggregationFn

  // Object.assign, not a spread into a literal: a ColumnDef is a union of four
  // shapes, and a literal is checked against all of them. The stated id wins
  // over the accessorKey carried across, so a block reads the same field under a
  // name of its own.
  return Object.assign({}, measure, {
    id: `${splitBy}=${value}:${idOf(measure)}`,
    // Structural, not a trader's to operate: sorting one block would reorder
    // rows the other blocks also describe, and a filter would empty them all.
    enableSorting: false,
    enableColumnFilter: false,
    enableGrouping: false,
    // A trade reports under its own block and leaves the rest of the row blank.
    cell: (info: CellContext<Trade, unknown>) =>
      within(info.row) ? flexRender(measure.cell, info) : null,
    // The base netting over this block's legs. leafRows, not childRows: a group
    // row nets every trade beneath it, and only some of them are in this block.
    aggregationFn:
      typeof net === 'function'
        ? (columnId: string, leafRows: Row<Trade>[], childRows: Row<Trade>[]) =>
            net(columnId, leafRows.filter(within), childRows)
        : net,
  })
}
