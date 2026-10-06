import type { Column, Table } from '@tanstack/react-table'
import type { Trade } from '@tapedeck/shared'
import type { ReactElement, ReactNode } from 'react'
import { CHIP, CONTROL, MICRO_LABEL } from '../../lib/ui.js'
import { groupedVisibility } from './columns.js'

type Props = {
  table: Table<Trade>
  open: boolean
  /** Referenced by the toggle button's aria-controls, so it is passed in. */
  id: string
}

/** Darker than the panel it sits on, per the note in lib/ui.ts. */
const PANEL_CONTROL = `${CONTROL} w-full bg-tape-bg`

/**
 * One per grid instance, because two panes are configured independently.
 *
 * It holds no state. Every control reads and writes the table's own state, so
 * the panel cannot drift from the grid it describes: a header click shows up in
 * Order By because both are looking at `sorting`.
 */
export function GridConfigPanel({ table, open, id }: Props): ReactElement {
  const { grouping, sorting } = table.getState()
  const groupBy = grouping[0]
  const splitBy = grouping[1]
  const order = sorting[0]

  const groupable = table.getAllLeafColumns().filter((column) => column.getCanGroup())
  const sortable = table.getAllLeafColumns().filter((column) => column.getCanSort())

  /**
   * Read from the same function the grid lays over its own state, so the boxes
   * below cannot disagree with the columns on screen.
   */
  const grouped = groupedVisibility(grouping)

  return (
    // Shrinks the grid rather than covering it. inert and aria-hidden when
    // closed, because a zero-width panel still holds real form controls:
    // without them the next Tab out of the grid lands in an invisible select.
    <div
      aria-hidden={!open}
      className={`tape-slide shrink-0 overflow-hidden ${open ? 'w-72' : 'w-0'}`}
      id={id}
      inert={!open}
    >
      {/* A stated width, not a derived one, so nothing in here relays out as
          the wrapper animates. */}
      <div className="tape-scroll ml-2 flex h-full w-70 flex-col gap-3 overflow-y-auto rounded-sm border border-tape-line bg-tape-panel p-2">
        <Section title="Group by">
          <select
            aria-label="Group by"
            className={`${PANEL_CONTROL} cursor-pointer`}
            onChange={(event) => {
              const next = event.target.value
              // Clearing Group By clears Split By with it. A grouping of
              // [undefined, 'book'] is not a view, and TanStack would read the
              // second level as the first.
              if (next === '') {
                table.setGrouping([])
                return
              }
              table.setGrouping(
                splitBy === undefined || splitBy === next ? [next] : [next, splitBy],
              )
            }}
            value={groupBy ?? ''}
          >
            <option value="">No grouping</option>
            {groupable.map((column) => (
              <option key={column.id} value={column.id}>
                {headerText(column)}
              </option>
            ))}
          </select>
        </Section>

        <Section title="Split by">
          <select
            aria-label="Split by"
            className={`${PANEL_CONTROL} cursor-pointer`}
            // Nothing to split until there is a level to split. The choice taken
            // above is excluded below: symbol inside symbol can never divide.
            disabled={groupBy === undefined}
            onChange={(event) => {
              if (groupBy === undefined) {
                return
              }
              const next = event.target.value
              table.setGrouping(next === '' ? [groupBy] : [groupBy, next])
            }}
            value={splitBy ?? ''}
          >
            <option value="">No split</option>
            {groupable
              .filter((column) => column.id !== groupBy)
              .map((column) => (
                <option key={column.id} value={column.id}>
                  {headerText(column)}
                </option>
              ))}
          </select>
        </Section>

        <Section title="Order by">
          {/* The same state the column headers write, so the two cannot
              disagree about what the grid is sorted by. */}
          <div className="flex gap-2">
            <select
              aria-label="Order by"
              className={`${PANEL_CONTROL} cursor-pointer`}
              onChange={(event) => {
                const next = event.target.value
                // Carries the direction across a change of column rather than
                // snapping back to ascending.
                table.setSorting(next === '' ? [] : [{ id: next, desc: order?.desc ?? true }])
              }}
              value={order?.id ?? ''}
            >
              <option value="">Unsorted</option>
              {sortable.map((column) => (
                <option key={column.id} value={column.id}>
                  {headerText(column)}
                </option>
              ))}
            </select>

            <button
              className={`${CHIP} shrink-0`}
              disabled={order === undefined}
              onClick={() => {
                if (order !== undefined) {
                  table.setSorting([{ id: order.id, desc: !order.desc }])
                }
              }}
              type="button"
            >
              {order?.desc === true ? 'Desc' : 'Asc'}
            </button>
          </div>
        </Section>

        <Section title="Where">
          {/* Filters whether or not the column itself is shown. */}
          <Where column={table.getColumn('tradeId')} label="Trade id" placeholder="TRD-" />
          <Where column={table.getColumn('counterparty')} label="Counterparty" placeholder="Name" />
          <Where
            column={table.getColumn('quantity')}
            label="Minimum quantity"
            placeholder="Shares"
          />
          <Where column={table.getColumn('notional')} label="Minimum notional" placeholder="0.00" />
        </Section>

        <Section title="Columns">
          {/* Says why most of them are unavailable. */}
          {groupBy === undefined ? null : (
            <p className="text-tape-muted">Grouped, so only the columns a group nets are shown.</p>
          )}

          {table.getAllLeafColumns().map((column) => {
            // Grouped by it, so hiding it would take the group label and the
            // expander with it. Or the last one standing, which would leave a
            // grid with no columns and no way back but this panel.
            const locked =
              column.getIsGrouped() ||
              (column.getIsVisible() && table.getVisibleLeafColumns().length === 1)

            // Nothing a group row could put in it, so the grouping has taken it
            // off the grid. The grid reads this box through the grouping's own
            // override, so a tick would be a control that does nothing.
            const dropped = grouped[column.id] === false

            return (
              <label className="flex cursor-pointer items-center gap-2" key={column.id}>
                <input
                  checked={column.getIsVisible()}
                  className="accent-tape-accent disabled:cursor-not-allowed"
                  disabled={!column.getCanHide() || locked || dropped}
                  onChange={column.getToggleVisibilityHandler()}
                  type="checkbox"
                />
                {headerText(column)}
              </label>
            )
          })}
        </Section>
      </div>
    </div>
  )
}

/**
 * The column's own header text. Every header in this grid is a plain string, so
 * there is no element to render here.
 */
function headerText(column: Column<Trade, unknown>): string {
  return String(column.columnDef.header)
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className={MICRO_LABEL}>{title}</h3>
      {children}
    </section>
  )
}

type WhereProps = {
  column: Column<Trade, unknown> | undefined
  label: string
  placeholder: string
}

/**
 * One filter box. The column is looked up by id, so it is typed as possibly
 * absent: an id that stops existing drops its control rather than throwing.
 */
function Where({ column, label, placeholder }: WhereProps): ReactElement | null {
  if (column === undefined) {
    return null
  }

  return (
    <input
      aria-label={label}
      className={PANEL_CONTROL}
      // undefined, not '': an empty string is a filter that matches everything
      // and would leave the column listed in columnFilters forever.
      onChange={(event) =>
        column.setFilterValue(event.target.value === '' ? undefined : event.target.value)
      }
      placeholder={placeholder}
      value={(column.getFilterValue() as string) ?? ''}
    />
  )
}
