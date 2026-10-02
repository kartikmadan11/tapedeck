import type { Row, RowData } from '@tanstack/react-table'
import { createColumnHelper } from '@tanstack/react-table'
import type { DecimalString, Trade } from '@tapedeck/shared'
import { compareDecimal, formatDecimal, notional } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { formatDateTime, formatQuantity } from '../../lib/format.js'

// Right-aligning numbers is a property of the column, not of every cell, so the
// class travels on the column and the table applies it.
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string
  }

  // Which rows have a mutation in flight. Carried on the table rather than closed
  // over by the column definitions, so the set changing does not rebuild them.
  interface TableMeta<TData extends RowData> {
    pendingIds: ReadonlySet<string>
  }
}

export type RowActions = {
  onAmend: (trade: Trade) => void
  onCancel: (trade: Trade) => void
  onHistory: (trade: Trade) => void
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

const NUMERIC = 'text-right tabular-nums'

// The return type is inferred on purpose. Annotating it as ColumnDef<Trade, T>[]
// needs one T for columns whose values are strings, numbers and decimals alike,
// which only `any` satisfies.
export function createColumns(actions: RowActions) {
  return [
    helper.accessor('tradeId', {
      header: 'Trade',
      cell: (info) => <span className="text-tape-muted">{info.getValue()}</span>,
    }),

    helper.accessor('tradeTimestamp', {
      header: 'Time (UTC)',
      cell: (info) => formatDateTime(info.getValue()),
    }),

    helper.accessor('symbol', {
      header: 'Symbol',
      cell: (info) => <span className="font-semibold">{info.getValue()}</span>,
    }),

    helper.accessor('side', {
      header: 'Side',
      cell: (info) => (
        <span className={info.getValue() === 'BUY' ? 'text-tape-buy' : 'text-tape-sell'}>
          {info.getValue()}
        </span>
      ),
    }),

    helper.accessor('quantity', {
      header: 'Quantity',
      meta: { className: NUMERIC },
      cell: (info) => formatQuantity(info.getValue()),
    }),

    helper.accessor('price', {
      header: 'Price',
      meta: { className: NUMERIC },
      sortingFn: byDecimal,
      cell: (info) => formatDecimal(info.getValue(), 4),
    }),

    // Computed in bigint minor units, so the column agrees with the positions
    // panel to the last place rather than approximately.
    helper.accessor((row) => notional(row.quantity, row.price), {
      id: 'notional',
      header: 'Notional',
      meta: { className: NUMERIC },
      sortingFn: byDecimal,
      cell: (info) => formatDecimal(info.getValue(), 2),
    }),

    helper.accessor('trader', { header: 'Trader' }),
    helper.accessor('book', { header: 'Book' }),
    helper.accessor('counterparty', { header: 'Counterparty' }),

    helper.accessor('status', {
      header: 'Status',
      cell: (info) =>
        info.getValue() === 'CANCELLED' ? (
          <span className="text-tape-sell">CANCELLED</span>
        ) : (
          <span className="text-tape-muted">ACTIVE</span>
        ),
    }),

    // Shown because it is the token the amend contract is built on: a reviewer
    // can watch it move and see why the second amend is rejected.
    helper.accessor('version', {
      header: 'Ver',
      meta: { className: NUMERIC },
    }),

    helper.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row, table }) => (
        <RowButtons
          trade={row.original}
          actions={actions}
          pending={table.options.meta?.pendingIds.has(row.original.tradeId) ?? false}
        />
      ),
    }),
  ]
}

type RowButtonProps = { trade: Trade; actions: RowActions; pending: boolean }

function RowButtons({ trade, actions, pending }: RowButtonProps): ReactElement {
  const cancelled = trade.status === 'CANCELLED'

  return (
    <div className="flex gap-1">
      <button
        type="button"
        className="rounded border border-tape-line px-1.5 py-0.5 hover:border-tape-accent hover:text-tape-accent disabled:cursor-not-allowed disabled:opacity-35"
        disabled={cancelled || pending}
        onClick={() => actions.onAmend(trade)}
      >
        Amend
      </button>
      <button
        type="button"
        className="rounded border border-tape-line px-1.5 py-0.5 hover:border-tape-sell hover:text-tape-sell disabled:cursor-not-allowed disabled:opacity-35"
        disabled={cancelled || pending}
        onClick={() => actions.onCancel(trade)}
      >
        {pending ? 'Working' : 'Cancel'}
      </button>
      <button
        type="button"
        className="rounded border border-tape-line px-1.5 py-0.5 hover:border-tape-accent hover:text-tape-accent"
        onClick={() => actions.onHistory(trade)}
      >
        History
      </button>
    </div>
  )
}
