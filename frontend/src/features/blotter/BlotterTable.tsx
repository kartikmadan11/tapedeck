import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { Trade } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import type { RowActions } from './columns.js'
import { createColumns } from './columns.js'
import { useRowFlash } from './useRowFlash.js'

type Props = {
  trades: Trade[]
  pendingIds: ReadonlySet<string>
  actions: RowActions
}

/** What the server orders by, so the first paint does not reshuffle. */
const DEFAULT_SORT: SortingState = [{ id: 'tradeTimestamp', desc: true }]

export function BlotterTable({ trades, pendingIds, actions }: Props): ReactElement {
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORT)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const flashing = useRowFlash(trades)

  const columns = useMemo(() => createColumns(actions), [actions])

  const table = useReactTable({
    data: trades,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    // Without this a sort or a filter would renumber the rows and React would
    // reuse the wrong row for the wrong trade.
    getRowId: (row) => row.tradeId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    meta: { pendingIds },
  })

  const rows = table.getRowModel().rows

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <FilterBar table={table} shown={rows.length} total={trades.length} />

      <div className="min-h-0 flex-1 overflow-auto rounded border border-tape-line">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-tape-panel">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    className={`whitespace-nowrap border-b border-tape-line px-2 py-1.5 font-semibold text-tape-muted ${
                      header.column.columnDef.meta?.className ?? ''
                    }`}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="hover:text-tape-text"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortMarker direction={header.column.getIsSorted()} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {rows.map((row) => {
              const cancelled = row.original.status === 'CANCELLED'
              const pending = pendingIds.has(row.original.tradeId)

              return (
                <tr
                  key={row.id}
                  className={[
                    'border-b border-tape-line/50 hover:bg-tape-panel/60',
                    cancelled ? 'text-tape-muted line-through' : '',
                    pending ? 'opacity-45' : '',
                    flashing.has(row.original.tradeId) ? 'tape-flash' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={`whitespace-nowrap px-2 py-1 ${cell.column.columnDef.meta?.className ?? ''}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>

        {rows.length === 0 ? (
          <p className="px-2 py-4 text-tape-muted">No trades match these filters.</p>
        ) : null}
      </div>
    </section>
  )
}

function SortMarker({ direction }: { direction: false | 'asc' | 'desc' }): ReactElement | null {
  if (direction === false) {
    return null
  }
  return <span className="ml-1 text-tape-accent">{direction === 'asc' ? '↑' : '↓'}</span>
}

type FilterBarProps = {
  table: ReturnType<typeof useReactTable<Trade>>
  shown: number
  total: number
}

/**
 * Filtering happens here rather than on the server, because the cache holds every
 * trade: a frame for a trade outside the current filter still belongs in the
 * cache, and clearing the filter must not need a round trip.
 */
function FilterBar({ table, shown, total }: FilterBarProps): ReactElement {
  const value = (id: string): string => (table.getColumn(id)?.getFilterValue() as string) ?? ''
  const set = (id: string, next: string): void => {
    table.getColumn(id)?.setFilterValue(next === '' ? undefined : next)
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <input
        aria-label="Filter by symbol"
        placeholder="Symbol"
        className="w-24 rounded border border-tape-line bg-tape-panel px-2 py-1 placeholder:text-tape-muted focus:border-tape-accent focus:outline-none"
        value={value('symbol')}
        onChange={(event) => set('symbol', event.target.value.toUpperCase())}
      />

      <input
        aria-label="Filter by trader"
        placeholder="Trader"
        className="w-32 rounded border border-tape-line bg-tape-panel px-2 py-1 placeholder:text-tape-muted focus:border-tape-accent focus:outline-none"
        value={value('trader')}
        onChange={(event) => set('trader', event.target.value)}
      />

      <input
        aria-label="Filter by book"
        placeholder="Book"
        className="w-32 rounded border border-tape-line bg-tape-panel px-2 py-1 placeholder:text-tape-muted focus:border-tape-accent focus:outline-none"
        value={value('book')}
        onChange={(event) => set('book', event.target.value)}
      />

      <select
        aria-label="Filter by side"
        className="rounded border border-tape-line bg-tape-panel px-2 py-1 focus:border-tape-accent focus:outline-none"
        value={value('side')}
        onChange={(event) => set('side', event.target.value)}
      >
        <option value="">Both sides</option>
        <option value="BUY">BUY</option>
        <option value="SELL">SELL</option>
      </select>

      <select
        aria-label="Filter by status"
        className="rounded border border-tape-line bg-tape-panel px-2 py-1 focus:border-tape-accent focus:outline-none"
        value={value('status')}
        onChange={(event) => set('status', event.target.value)}
      >
        <option value="">Any status</option>
        <option value="ACTIVE">ACTIVE</option>
        <option value="CANCELLED">CANCELLED</option>
      </select>

      <span className="ml-auto text-tape-muted">
        {shown === total ? `${total} trades` : `${shown} of ${total} trades`}
      </span>
    </div>
  )
}
