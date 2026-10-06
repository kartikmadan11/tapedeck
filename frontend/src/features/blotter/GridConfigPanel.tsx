import type { Column, Table } from '@tanstack/react-table'
import type { Trade } from '@tapedeck/shared'
import type { ReactElement, ReactNode } from 'react'
import type { SelectOption } from '../../components/Select.js'
import { Select } from '../../components/Select.js'
import { CHIP, CONTROL, MICRO_LABEL } from '../../lib/ui.js'
import { groupedVisibility, orderedColumnIds } from './columns.js'
import { SuggestionList } from './suggestions.js'

type Props = {
  table: Table<Trade>
  open: boolean
  /** Referenced by the toggle button's aria-controls, so it is passed in. */
  id: string
  /** The names the Counterparty box offers, taken off the tape. */
  counterparties: readonly string[]

  /** Row level, then the column the measures are pivoted across. A prop, not
   *  table state: the table is only ever told the first of the two. */
  grouping: readonly string[]

  /** Whether the split took, which decides what the Columns note says. */
  pivoted: boolean

  onGrouping: (next: string[]) => void

  /** Closes the panel from inside it. Expected to move focus, since the panel it
   *  was pressed in goes inert. */
  onHide: () => void
}

/** Darker than the panel it sits on, per the note in lib/ui.ts. */
const PANEL_CONTROL = `${CONTROL} w-full bg-tape-bg`

/** Tighter than CHIP: there are two of these on every one of twelve rows. */
const NUDGE =
  'shrink-0 cursor-pointer px-1 text-tape-muted hover:text-tape-accent disabled:cursor-not-allowed disabled:opacity-25'

/** One per grid. Holds no state: every control reads and writes the table's own
 *  state, so a header click shows up in Order By without being wired to it. */
export function GridConfigPanel({
  table,
  open,
  id,
  counterparties,
  grouping,
  pivoted,
  onGrouping,
  onHide,
}: Props): ReactElement {
  const { sorting, columnOrder } = table.getState()
  const groupBy = grouping[0]
  const splitBy = grouping[1]
  const order = sorting[0]

  const groupable = table.getAllLeafColumns().filter((column) => column.getCanGroup())
  const sortable = table.getAllLeafColumns().filter((column) => column.getCanSort())

  /** The same override the grid lays over its own state, so the two agree. */
  const grouped = groupedVisibility(groupBy, pivoted)

  /** The trader's own order, not the table's: a grouping hoists its column to
   *  the front, and reading that back would bake the hoist in on the first
   *  nudge. Hidden columns stay listed, so turning one on puts it back. */
  const ordered = orderedColumnIds(columnOrder)

  const move = (from: number, by: number): void => {
    const to = from + by
    const id = ordered[from]
    if (id === undefined || to < 0 || to >= ordered.length) {
      return
    }
    const next = [...ordered]
    next.splice(from, 1)
    next.splice(to, 0, id)
    table.setColumnOrder(next)
  }

  return (
    // inert and aria-hidden when closed: a zero-width panel still holds real
    // form controls, so Tab out of the grid would land in an invisible select.
    <div
      aria-hidden={!open}
      className={`tape-slide shrink-0 overflow-hidden ${open ? 'w-72' : 'w-0'}`}
      id={id}
      inert={!open}
    >
      {/* A stated width, so nothing in here relays out as the wrapper animates. */}
      <div className="tape-scroll ml-2 flex h-full w-70 flex-col gap-3 overflow-y-auto rounded-sm border border-tape-line bg-tape-panel p-2">
        {/* The panel's own way out: Config is otherwise reachable only from the
            pane's right-click menu. */}
        <div className="flex items-center justify-between">
          <h2 className={MICRO_LABEL}>Config</h2>
          <button className={CHIP} onClick={onHide} type="button">
            Hide
          </button>
        </div>

        <Section title="Group by">
          <Select
            className={PANEL_CONTROL}
            label="Group by"
            onChange={(next) => {
              // Clearing Group By clears Split By: a split is blocks of netted
              // columns across a group row, so it needs one to lie across.
              if (next === '') {
                onGrouping([])
                return
              }
              onGrouping(splitBy === undefined || splitBy === next ? [next] : [next, splitBy])
            }}
            options={[{ value: '', label: 'No grouping' }, ...choices(groupable)]}
            value={groupBy ?? ''}
          />
        </Section>

        <Section title="Split by">
          <Select
            className={PANEL_CONTROL}
            // Nothing to split until there are group rows. Group By's own choice
            // is excluded below: a block per symbol inside a group per symbol is
            // one block.
            disabled={groupBy === undefined}
            label="Split by"
            onChange={(next) => {
              if (groupBy === undefined) {
                return
              }
              onGrouping(next === '' ? [groupBy] : [groupBy, next])
            }}
            options={[
              { value: '', label: 'No split' },
              ...choices(groupable.filter((column) => column.id !== groupBy)),
            ]}
            value={splitBy ?? ''}
          />
        </Section>

        <Section title="Order by">
          {/* The same state the column headers write. */}
          <div className="flex gap-2">
            <Select
              className={PANEL_CONTROL}
              label="Order by"
              onChange={(next) => {
                // Carries the direction across a change of column.
                table.setSorting(next === '' ? [] : [{ id: next, desc: order?.desc ?? true }])
              }}
              options={[{ value: '', label: 'Unsorted' }, ...choices(sortable)]}
              value={order?.id ?? ''}
            />

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
          <Where
            column={table.getColumn('counterparty')}
            label="Counterparty"
            placeholder="Name"
            suggest={{ id: `${id}-counterparty`, values: counterparties }}
          />
          <Where
            column={table.getColumn('quantity')}
            label="Minimum quantity"
            placeholder="Shares"
          />
          <Where column={table.getColumn('notional')} label="Minimum notional" placeholder="0.00" />
        </Section>

        <Section title="Columns">
          <p className="text-tape-muted">Top to bottom is left to right.</p>

          {/* Says why most of them are unavailable. */}
          {groupBy === undefined ? null : (
            <p className="text-tape-muted">
              {pivoted
                ? 'Split, so the netted columns are repeated under each value.'
                : 'Grouped, so only the columns a group nets are shown.'}
            </p>
          )}

          {ordered.map((id, index) => {
            const column = table.getColumn(id)
            if (column === undefined) {
              return null
            }

            // Grouped by it, so hiding it loses the label and the expander. Or
            // the last one standing, which would leave a grid with no columns.
            const locked =
              column.getIsGrouped() ||
              (column.getIsVisible() && table.getVisibleLeafColumns().length === 1)

            // Taken off the grid by the grouping. The grid reads this box through
            // that override, so a tick would do nothing.
            const dropped = grouped[id] === false
            const name = headerText(column)

            return (
              <div className="flex items-center gap-1" key={id}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    checked={column.getIsVisible()}
                    className="accent-tape-accent disabled:cursor-not-allowed"
                    disabled={!column.getCanHide() || locked || dropped}
                    onChange={column.getToggleVisibilityHandler()}
                    type="checkbox"
                  />
                  <span className="truncate">{name}</span>
                </label>

                {/* Buttons, not a drag: operable from the keyboard. Outside the
                    label, or pressing one would toggle the column. */}
                <button
                  aria-label={`Move ${name} up`}
                  className={NUDGE}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label={`Move ${name} down`}
                  className={NUDGE}
                  disabled={index === ordered.length - 1}
                  onClick={() => move(index, 1)}
                  type="button"
                >
                  ↓
                </button>
              </div>
            )
          })}
        </Section>
      </div>
    </div>
  )
}

/** Every header in this grid is a plain string, so there is no element to render. */
function headerText(column: Column<Trade, unknown>): string {
  return String(column.columnDef.header)
}

/** Columns as a list to pick from, under the names their headers carry. */
function choices(columns: readonly Column<Trade, unknown>[]): SelectOption[] {
  return columns.map((column) => ({ value: column.id, label: headerText(column) }))
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
  /** Absent for the boxes a list would be noise on, like a 500-row trade id. */
  suggest?: { id: string; values: readonly string[] } | undefined
}

/** One filter box. The column is looked up by id, so an id that stops existing
 *  drops its control rather than throwing. */
function Where({ column, label, placeholder, suggest }: WhereProps): ReactElement | null {
  if (column === undefined) {
    return null
  }

  return (
    <>
      <input
        aria-label={label}
        className={PANEL_CONTROL}
        list={suggest?.id}
        // undefined, not '': an empty string is a filter that matches everything
        // and would leave the column listed in columnFilters forever.
        onChange={(event) =>
          column.setFilterValue(event.target.value === '' ? undefined : event.target.value)
        }
        placeholder={placeholder}
        value={(column.getFilterValue() as string) ?? ''}
      />
      {suggest === undefined ? null : <SuggestionList id={suggest.id} values={suggest.values} />}
    </>
  )
}
