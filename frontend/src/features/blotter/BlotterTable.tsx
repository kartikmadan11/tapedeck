import type {
  Cell,
  Column,
  ColumnFiltersState,
  ColumnOrderState,
  ExpandedState,
  GroupingState,
  Header,
  Row,
  SortingState,
  Table,
  Updater,
  VisibilityState,
} from '@tanstack/react-table'
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DecimalString, Trade } from '@tapedeck/shared'
import { BLOTTER_LIMIT, toMinorUnits } from '@tapedeck/shared'
import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { SelectOption } from '../../components/Select.js'
import { Select } from '../../components/Select.js'
import { formatCount } from '../../lib/format.js'
import { CONTROL } from '../../lib/ui.js'
import type { PaneConfig } from '../workspace/paneConfig.js'
import { DEFAULT_VIEW } from '../workspace/paneConfig.js'
import {
  createColumns,
  DEFAULT_COLUMN,
  GroupToggle,
  groupedVisibility,
  splitBlocks,
  splitColumns,
} from './columns.js'
import { GridConfigPanel } from './GridConfigPanel.js'
import { barScale, MagnitudeScale } from './magnitude.js'
import type { Point } from './PaneMenu.js'
import { PaneMenu } from './PaneMenu.js'
import type { RowActions } from './SelectionBar.js'
import { canWrite, SelectionBar } from './SelectionBar.js'
import type { Suggestions } from './suggestions.js'
import { SuggestionList, suggestionsOf } from './suggestions.js'
import { useRowFlash } from './useRowFlash.js'

type Props = {
  trades: Trade[]
  pendingIds: ReadonlySet<string>
  actions: RowActions

  /** Names the pane. Two grids with one name cannot be told apart. */
  label?: string | undefined

  /** The view this pane opens on. Once mounted the pane owns its own state, so a
   *  keystroke in one pane's filter box does not re-render the other. */
  initialConfig?: PaneConfig | undefined

  /** Reports the view back out. Must be stable: it is a dependency of the effect
   *  that calls it, so a fresh function would report on every render. */
  onConfigChange?: ((config: PaneConfig) => void) | undefined

  /** Duplicates this pane on its current view. Omitted with no workspace. */
  onDuplicate?: ((config: PaneConfig) => void) | undefined

  /** Omitted on the first pane, which is permanent: absence is the mechanism. */
  onClose?: (() => void) | undefined

  /** Opens a pane on the default view. Omitted at the workspace ceiling, which
   *  greys the menu item rather than dropping it. */
  onNewPane?: (() => void) | undefined

  /** Copies a link to the whole workspace, not to this pane. */
  onShare?: (() => void) | undefined

  /** The handle this pane is moved by, at the head of its filter bar. A node, so
   *  moving a pane stays the arranging component's business. */
  grip?: ReactNode | undefined

  /** The pane's name as an editable node, beside the grip. `label` is the same
   *  name as a string, which is what the grid's accessible name needs. */
  nameplate?: ReactNode | undefined
}

/** Sticks the leftmost visible column. Positional, since which column is leftmost
 *  changes. The border is on the cell, which is why the table is border-separate. */
const PINNED = 'sticky left-0 z-10 border-r border-tape-line'

/** The `h-8` on the tr below, in pixels. The virtualiser is told this rather than
 *  measuring, so the two must change together or the tape scrolls wrong. */
const ROW_PX = 32

/** Divides one block of a split from the next, in the header and down the body. */
const BLOCK_EDGE = 'border-l border-tape-line'

/** Where a block starts: a block's own heading, or the first measure under it.
 *  Nothing starts a block without a split, since nothing has a parent. */
function startsBlock(column: Column<Trade, unknown>): boolean {
  const block = column.parent
  return block === undefined ? column.columns.length > 0 : block.columns[0]?.id === column.id
}

export function BlotterTable({
  trades,
  pendingIds,
  actions,
  label = 'Trades',
  initialConfig = DEFAULT_VIEW,
  onConfigChange,
  onDuplicate,
  onClose,
  onNewPane,
  onShare,
  grip,
  nameplate,
}: Props): ReactElement {
  const [sorting, setSorting] = useState<SortingState>(initialConfig.sorting)
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    initialConfig.columnFilters,
  )

  /** Two things, not two levels: [0] cuts the rows, [1] is the column the
   *  measures are pivoted across. The table is only ever told the first, since
   *  the second is columns rather than a second level of rows. */
  const [grouping, setGrouping] = useState<GroupingState>(initialConfig.grouping)
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const groupBy = grouping[0]
  const splitBy = grouping[1]

  /** The columns the trader chose, not the ones on screen: a grouping drops its
   *  own over the top. Kept separate, so clearing the grouping gives them back. */
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialConfig.columnVisibility,
  )

  /** Empty means definition order. A grouping still hoists its own column to the
   *  front on top of this, which is what keeps the group label leading. */
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(initialConfig.columnOrder)

  /** One level, whatever the grouping holds. */
  const rowGrouping = useMemo(() => (groupBy === undefined ? [] : [groupBy]), [groupBy])

  /** The split's blocks. Empty when there is no split, or none it can divide by. */
  const blocks = useMemo(() => splitBlocks(trades, splitBy), [trades, splitBy])
  const pivoted = blocks !== ''

  const shownColumns = useMemo(
    () => ({ ...columnVisibility, ...groupedVisibility(groupBy, pivoted) }),
    [columnVisibility, groupBy, pivoted],
  )

  /** Resolved against the trader's own record, not the one the table holds.
   *  TanStack hands an updater its own state, so one tick in the panel would
   *  bake every one of the grouping's drops into the trader's choice. */
  const onVisibilityChange = useCallback((updater: Updater<VisibilityState>) => {
    setColumnVisibility((own) => (typeof updater === 'function' ? updater(own) : updater))
  }, [])

  // `expanded` is left out on purpose: a reading position, not part of the view.
  useEffect(() => {
    onConfigChange?.({ sorting, columnFilters, grouping, columnVisibility, columnOrder })
  }, [onConfigChange, sorting, columnFilters, grouping, columnVisibility, columnOrder])

  const [configOpen, setConfigOpen] = useState(false)
  // Generated, not a literal: a second grid's aria-controls must not point at
  // this panel. The filter boxes hang their suggestion lists off it too.
  const configPanelId = useId()

  const suggestions = useMemo(() => suggestionsOf(trades), [trades])

  /** Back to the view a pane opens on, not to its trades, name or size. */
  const reset = useCallback(() => {
    setSorting(DEFAULT_VIEW.sorting)
    setColumnFilters(DEFAULT_VIEW.columnFilters)
    setGrouping(DEFAULT_VIEW.grouping)
    setColumnVisibility(DEFAULT_VIEW.columnVisibility)
    setColumnOrder(DEFAULT_VIEW.columnOrder)
    setExpanded({})
  }, [])

  /** Where the pane's menu was asked for, or null while it is closed. */
  const [menuAt, setMenuAt] = useState<Point | null>(null)
  const dismissMenu = useCallback(() => setMenuAt(null), [])

  const flashing = useRowFlash(trades)

  /** An id, not a row or an index: the trade is re-read each render, so a frame
   *  that amends it updates the bar, and a sort or filter cannot strand it. */
  const [selectedId, setSelectedId] = useState<string | null>(null)

  /** The base columns, plus one block of measures per split value. The base
   *  measures are hidden rather than removed: the Where boxes filter on them, and
   *  TanStack silently skips a filter whose column it cannot resolve. */
  const columns = useMemo(
    () =>
      splitBy === undefined || blocks === ''
        ? createColumns()
        : [...createColumns(), ...splitColumns(splitBy, blocks)],
    [splitBy, blocks],
  )

  const table = useReactTable({
    data: trades,
    columns,
    defaultColumn: DEFAULT_COLUMN,
    state: {
      sorting,
      columnFilters,
      grouping: rowGrouping,
      expanded,
      columnVisibility: shownColumns,
      columnOrder,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    // No onGroupingChange: the table is told only the row level, so taking its
    // report back would drop the split. The config panel writes it instead.
    onExpandedChange: setExpanded,
    onColumnVisibilityChange: onVisibilityChange,
    onColumnOrderChange: setColumnOrder,
    // Without this, a sort would renumber the rows and React would reuse the
    // wrong row for the wrong trade.
    getRowId: (row) => row.tradeId,
    // Hoists the grouped column to the front, where its label belongs. Safe only
    // because the grouping also drops the pinned Trade column: otherwise reorder
    // moves it off position 0 and takes the selection marker with it.
    groupedColumnMode: 'reorder',
    // Default is on, and the feed replaces the data every two seconds, so every
    // open group would snap shut on each frame.
    autoResetExpanded: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })

  const rows = table.getRowModel().rows
  const leaves = table.getFilteredRowModel().rows

  /** What the rail says while no row is picked. Leaves either way, so a grouping
   *  does not turn the count into a number of rails. A full window says `latest`:
   *  at the bound the figure is no longer a count of the book. */
  const held =
    trades.length === BLOTTER_LIMIT
      ? `latest ${BLOTTER_LIMIT} trades`
      : formatCount(trades.length, 'trade')
  const counted = leaves.length === trades.length ? held : `${leaves.length} of ${held}`

  /** Two bands under a split, the blocks above the measures they span. One otherwise. */
  const headerRows = table.getHeaderGroups()

  /** What a full-width bar means, over the filtered leaves so the bars measure
   *  what is on screen. Memoised on the row model's identity, not a length: the
   *  largest trade can change without the count changing. */
  const notionalScale = useMemo(() => {
    let max = 0n

    for (const row of leaves) {
      const value = toMinorUnits(row.getValue<DecimalString>('notional'))
      if (value > max) {
        max = value
      }
    }

    return barScale(max)
  }, [leaves])

  /** The shortcuts are bound to the table, and no cell is focusable, so clicking
   *  a row moves focus here. preventScroll at the call site, since the row is
   *  already in view. */
  const grid = useRef<HTMLTableElement>(null)

  /** The element the rows scroll inside, which the virtualiser measures. */
  const scroller = useRef<HTMLDivElement>(null)

  /** The pane itself, for telling a pointer inside it from one somewhere else. */
  const pane = useRef<HTMLElement>(null)

  /** estimateSize is constant: every row is exactly ROW_PX tall. No getItemKey,
   *  so the virtualiser keys by row-model position while React keys by trade id,
   *  which lets a sort reorder the tape without reusing a row for a wrong trade. */
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_PX,
    // Enough that an arrow-key walk off the bottom edge has somewhere to land.
    overscan: 12,
  })

  const drawn = virtualizer.getVirtualItems()

  /** The gaps above and below the drawn rows, held open by the spacer rows. */
  const above = drawn[0]?.start ?? 0
  const below = virtualizer.getTotalSize() - (drawn.at(-1)?.end ?? 0)

  /** Group rows are not selectable: TanStack builds one from its first leaf, so
   *  selecting it would offer Amend against an arbitrary trade. It opens instead. */
  const select = useCallback((row: Row<Trade>) => {
    if (row.getIsGrouped()) {
      row.toggleExpanded()
      return
    }

    setSelectedId(row.id)
    grid.current?.focus({ preventScroll: true })
  }, [])

  /** A pointer down away from the pane drops the selection. A raised layer does
   *  not count as away: dialogs, menus and dropdowns portal outside the pane, and
   *  confirming a cancel must not deselect the trade it names. */
  useEffect(() => {
    if (selectedId === null) {
      return
    }

    const away = (event: Event): void => {
      const target = event.target instanceof Element ? event.target : null
      if (
        target === null ||
        pane.current?.contains(target) === true ||
        target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null
      ) {
        return
      }
      setSelectedId(null)
    }

    // Capture, so a handler that stops the event on its way up cannot defeat this.
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [selectedId])

  /** Read by the buttons and the keys alike, so a hotkey cannot do what the
   *  matching disabled button refuses. */
  const selected = selectedId === null ? null : (rows.find((row) => row.id === selectedId) ?? null)
  const selectedTrade = selected?.original ?? null
  const writable =
    selectedTrade !== null && canWrite(selectedTrade, pendingIds.has(selectedTrade.tradeId))

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Otherwise the container scrolls as well as the selection moving.
      event.preventDefault()

      if (rows.length === 0) {
        return
      }

      // The sorted, filtered and grouped order, which is the order on screen.
      const current = rows.findIndex((row) => row.id === selectedId)
      const next = nextSelectable(rows, current, event.key === 'ArrowDown' ? 1 : -1)

      if (next === -1) {
        return
      }

      const id = rows[next]?.id

      if (id !== undefined) {
        setSelectedId(id)
        // Through the virtualiser, not the DOM: a row outside the drawn window
        // has no element, so a lookup by trade id would scroll nowhere, silently.
        virtualizer.scrollToIndex(next, { align: 'auto' })
      }
      return
    }

    if (event.key === 'Escape') {
      setSelectedId(null)
      return
    }

    if (selectedTrade === null) {
      return
    }

    const key = event.key.toLowerCase()

    if (key === 'a' && writable) {
      actions.onAmend(selectedTrade)
    } else if (key === 'c' && writable) {
      actions.onCancel(selectedTrade)
    } else if (key === 'h') {
      actions.onHistory(selectedTrade)
    }
  }

  return (
    // Wraps the grid, not the table, so the bars and the panel read the same rows.
    <MagnitudeScale minor={notionalScale}>
      {/* min-w-0 is load-bearing: a flex item keeps min-width:auto and every cell
          is whitespace-nowrap, so this would never shrink below twelve columns. */}
      <section
        aria-label={label}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        ref={pane}
        // On the pane, so the bar, the rows and the panel answer to one
        // right-click. Shift falls through to the browser's own menu, as does a
        // box someone is typing in: cut, copy and paste belong to the field.
        onContextMenu={(event) => {
          const field =
            event.target instanceof Element ? event.target.closest('input, select, textarea') : null
          if (event.shiftKey || field !== null) {
            return
          }
          event.preventDefault()

          // A right-click on a row picks it first, so the menu is about the row
          // under the pointer. Off a row, the selection is left alone.
          const id =
            event.target instanceof Element
              ? event.target.closest('[data-trade-id]')?.getAttribute('data-trade-id')
              : null
          if (id !== null && id !== undefined) {
            setSelectedId(id)
          }

          // Shift-F10 and the menu key raise a contextmenu with no coordinates,
          // so the pane's own corner is the fallback.
          const corner = event.currentTarget.getBoundingClientRect()
          const keyed = event.clientX === 0 && event.clientY === 0
          setMenuAt(
            keyed
              ? { x: corner.left + 8, y: corner.top + 8 }
              : { x: event.clientX, y: event.clientY },
          )
        }}
      >
        <FilterBar
          grip={grip}
          idPrefix={configPanelId}
          nameplate={nameplate}
          suggestions={suggestions}
          table={table}
        />

        {menuAt === null ? null : (
          <PaneMenu
            at={menuAt}
            items={[
              // The row's three actions first, since a right-click on a trade is
              // about the trade. Refused rather than left out when nothing is
              // picked, so the items below never move and no key beats a chip.
              {
                label: 'Amend trade',
                onSelect: () => {
                  if (selectedTrade !== null) {
                    actions.onAmend(selectedTrade)
                  }
                },
                disabled: !writable,
                keys: 'a',
              },
              {
                label: 'Cancel trade',
                onSelect: () => {
                  if (selectedTrade !== null) {
                    actions.onCancel(selectedTrade)
                  }
                },
                disabled: !writable,
                keys: 'c',
              },
              {
                label: 'Trade history',
                onSelect: () => {
                  if (selectedTrade !== null) {
                    actions.onHistory(selectedTrade)
                  }
                },
                disabled: selectedTrade === null,
                keys: 'h',
              },
              {
                label: 'New pane',
                onSelect: () => onNewPane?.(),
                disabled: onNewPane === undefined,
                separated: true,
              },
              {
                label: 'Duplicate',
                // The pane's own view, handed over as it stands.
                onSelect: () =>
                  onDuplicate?.({
                    sorting,
                    columnFilters,
                    grouping,
                    columnVisibility,
                    columnOrder,
                  }),
                disabled: onDuplicate === undefined,
                separated: true,
              },
              {
                label: configOpen ? 'Hide config' : 'Config',
                onSelect: () => setConfigOpen((open) => !open),
                // The panel outlives the menu, so the item is what says it is open.
                controls: configPanelId,
                expanded: configOpen,
              },
              { label: 'Reset', onSelect: reset },
              {
                label: 'Share workspace',
                onSelect: () => onShare?.(),
                disabled: onShare === undefined,
              },
              {
                label: 'Close',
                onSelect: () => onClose?.(),
                disabled: onClose === undefined,
                separated: true,
              },
            ]}
            label={label}
            onDismiss={dismissMenu}
          />
        )}

        {/* A sibling of the grid, so opening the panel shrinks the tape. */}
        <div className="flex min-h-0 flex-1">
          {/* pb keeps the horizontal scrollbar off the last row. focus-within, not
              focus: the table inside takes focus, and a ring on it would scroll
              away with it. */}
          <div
            ref={scroller}
            className="tape-scroll min-w-0 flex-1 overflow-auto rounded-sm border border-tape-line pb-2.5 focus-within:border-tape-focus"
          >
            {/* border-separate: collapsed mode paints borders on the table, so a
                sticky cell's border scrolls away and the pinned column is left
                unedged. Separate mode ignores row borders, hence borders on the
                cells. table-fixed and the colgroup take the widths from the
                columns, never from a measured cell, which virtualisation needs. */}
            <table
              ref={grid}
              style={{ minWidth: table.getTotalSize() }}
              // role=grid because this table is operated: it owns a selection and
              // the keys that move it. Bound here, not on the document, so they do
              // not fire under an open dialog or inside the filter boxes.
              //
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: table is the one element ARIA in HTML allows role=grid on, and it is the APG data-grid pattern. The rule's fix, replacing the table with a div, would cost the real row and cell semantics.
              role="grid"
              tabIndex={0}
              aria-label={`${label}. Use the arrow keys to select a row.`}
              // The whole tape plus the header bands: otherwise a virtualised grid
              // reports only the rows that happen to be drawn.
              aria-rowcount={rows.length + headerRows.length}
              onKeyDown={onKeyDown}
              className="w-full table-fixed border-separate border-spacing-0 text-left focus:outline-none"
            >
              {/* Driven by the visible leaves, so hiding a column takes its width
                  with it and the header, body and layout stay in step. */}
              <colgroup>
                {table.getVisibleLeafColumns().map((column) => (
                  <col key={column.id} style={{ width: column.getSize() }} />
                ))}
              </colgroup>

              {/* Opaque, not tinted: a sticky header shares a stacking context with
                  the rows under it, so transparency lets row text through. z-20
                  beats the pinned cell's z-10, so the header's corner wins. */}
              <thead className="sticky top-0 z-20 bg-tape-panel">
                {headerRows.map((group, band) => (
                  // The band height lives here; the cells carry no vertical padding.
                  <tr key={group.id} aria-rowindex={band + 1} className="h-8">
                    {group.headers.map((header, index) => {
                      const meta = header.column.columnDef.meta
                      // A block's own heading, centred over its measures rather
                      // than right-aligned on one of them.
                      const spanning = header.colSpan > 1

                      return (
                        <th
                          key={header.id}
                          // Without it the heading sits over the first measure.
                          colSpan={header.colSpan}
                          // A pinned header needs its own background: the thead's
                          // scrolls sideways with the table. meta.className stays
                          // last, since it right-aligns the numeric headers.
                          className={`whitespace-nowrap border-b border-tape-line bg-tape-panel px-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-tape-muted ${
                            index === 0 ? PINNED : ''
                          } ${startsBlock(header.column) ? BLOCK_EDGE : ''} ${
                            spanning ? 'text-center text-tape-accent' : ''
                          } ${meta?.className ?? ''}`}
                        >
                          <HeaderLabel header={header} />
                        </th>
                      )
                    })}
                  </tr>
                ))}
              </thead>

              <tbody>
                <Spacer height={above} />

                {drawn.map((item) => {
                  const row = rows[item.index]

                  if (row === undefined) {
                    return null
                  }

                  // Read first: a group row's original is its first leaf trade, so
                  // its status and pending state are not the group's.
                  const grouped = row.getIsGrouped()
                  const cancelled = !grouped && row.original.status === 'CANCELLED'
                  const pending = !grouped && pendingIds.has(row.original.tradeId)
                  const isSelected = !grouped && row.id === selectedId

                  if (grouped) {
                    return (
                      <tr
                        key={row.id}
                        // Past the header bands, plus one: aria-rowindex is 1-based.
                        aria-rowindex={item.index + headerRows.length + 1}
                        // No data-trade-id: this is not a trade row.
                        aria-expanded={row.getIsExpanded()}
                        // The header's colour, so a group reads as a rail rather
                        // than a trade. No flash and no pending fade either.
                        className="h-8 cursor-pointer bg-tape-panel hover:bg-tape-raised"
                        onClick={() => row.toggleExpanded()}
                      >
                        {row.getVisibleCells().map((cell, index) => (
                          <BodyCell cell={cell} index={index} isSelected={false} key={cell.id} />
                        ))}
                      </tr>
                    )
                  }

                  return (
                    <tr
                      key={row.id}
                      aria-rowindex={item.index + headerRows.length + 1}
                      data-trade-id={row.id}
                      // The only thing that tells a screen reader what the tint means.
                      aria-selected={isSelected}
                      className={[
                        // One background, chosen rather than layered: two utilities
                        // resolve by Tailwind's output order. Both opaque, since the
                        // pinned cell inherits this and must hide what is behind it.
                        // No transition, or it would smear the flash past its 900ms.
                        'h-8 cursor-pointer',
                        isSelected ? 'bg-tape-selected' : 'bg-tape-bg hover:bg-tape-raised',
                        cancelled ? 'text-tape-muted line-through' : '',
                        pending ? 'opacity-45' : '',
                        flashing.has(row.original.tradeId) ? 'tape-flash' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => select(row)}
                      // Guarded: a double click must not get round a disabled Amend.
                      onDoubleClick={() => {
                        if (canWrite(row.original, pending)) {
                          actions.onAmend(row.original)
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell, index) => (
                        <BodyCell cell={cell} index={index} isSelected={isSelected} key={cell.id} />
                      ))}
                    </tr>
                  )
                })}

                <Spacer height={below} />
              </tbody>
            </table>

            {rows.length === 0 ? (
              <p className="px-2 py-6 text-center text-tape-muted">
                No trades match these filters.
              </p>
            ) : null}
          </div>

          <GridConfigPanel
            counterparties={suggestions.counterparty}
            grouping={grouping}
            id={configPanelId}
            onGrouping={setGrouping}
            pivoted={pivoted}
            onHide={() => {
              setConfigOpen(false)
              // The panel goes inert with focus inside it, which would drop focus
              // to the document. The grid is what it configures.
              grid.current?.focus()
            }}
            open={configOpen}
            table={table}
          />
        </div>

        <SelectionBar
          trade={selectedTrade}
          pending={selectedTrade !== null && pendingIds.has(selectedTrade.tradeId)}
          actions={actions}
          count={counted}
        />
      </section>
    </MagnitudeScale>
  )
}

/** The next trade row in a direction, stepping over group rows. -1 when there is
 *  nothing to move to, so the selection stays put rather than wrapping. */
function nextSelectable(rows: Row<Trade>[], from: number, step: number): number {
  // With nothing selected, either key starts at the top.
  const direction = from === -1 ? 1 : step
  let index = from === -1 ? 0 : from + step

  while (index >= 0 && index < rows.length) {
    if (rows[index]?.getIsGrouped() !== true) {
      return index
    }
    index += direction
  }

  return -1
}

/** Holds the scroll extent open where rows are not drawn. A tr, not an absolutely
 *  positioned element: taking a tr out of flow destroys the table, and the table
 *  is where role=grid's row and cell semantics come from. */
function Spacer({ height }: { height: number }): ReactElement | null {
  if (height <= 0) {
    return null
  }

  // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: presentation is the role ARIA in HTML allows on a layout tr, and the rule's fix, wrapping it in a div, is not something a tbody may contain.
  return <tr role="presentation" style={{ height }} />
}

type BodyCellProps = {
  cell: Cell<Trade, unknown>
  index: number
  isSelected: boolean
}

/** Shared by trade and group rows, so the pinned column, the selection marker and
 *  the numeric alignment are declared once. */
function BodyCell({ cell, index, isSelected }: BodyCellProps): ReactElement {
  const meta = cell.column.columnDef.meta
  const leading = index === 0

  return (
    <td
      // bg-inherit, not a fixed colour: it has to follow the row through hover,
      // the selection, the flash and the pending fade, and inheritance tracks the
      // animated value. The selection marker is an inset shadow, since a border
      // would push the row 2px out of line with the column above it.
      className={`whitespace-nowrap border-b border-tape-line/60 px-1.5 ${
        leading ? `bg-inherit ${PINNED}` : ''
      } ${startsBlock(cell.column) ? BLOCK_EDGE : ''} ${
        leading && isSelected ? 'shadow-[inset_2px_0_0_0_var(--color-tape-accent)]' : ''
      } ${meta?.className ?? ''}`}
    >
      {renderCell(cell)}
    </td>
  )
}

/** Which of a column's renderers a cell gets. A placeholder is the grouped column
 *  on a leaf row, and renders empty: the value is on the group row above. */
function renderCell(cell: Cell<Trade, unknown>): ReactNode {
  if (cell.getIsPlaceholder()) {
    return null
  }

  const column = cell.column.columnDef

  if (cell.getIsGrouped()) {
    return <GroupToggle row={cell.row}>{flexRender(column.cell, cell.getContext())}</GroupToggle>
  }

  return flexRender(cell.getIsAggregated() ? column.aggregatedCell : column.cell, cell.getContext())
}

/** A heading, with the sort control where the column can be sorted. A placeholder
 *  is a column with no heading at this band: under a split that is the grouped
 *  column, whose name belongs on the band with the measures. */
function HeaderLabel({ header }: { header: Header<Trade, unknown> }): ReactNode {
  if (header.isPlaceholder) {
    return null
  }

  const label = flexRender(header.column.columnDef.header, header.getContext())

  if (!header.column.getCanSort()) {
    return label
  }

  return (
    <button
      type="button"
      className="cursor-pointer hover:text-tape-text"
      onClick={header.column.getToggleSortingHandler()}
    >
      {label}
      <SortMarker direction={header.column.getIsSorted()} />
    </button>
  )
}

function SortMarker({ direction }: { direction: false | 'asc' | 'desc' }): ReactElement | null {
  if (direction === false) {
    return null
  }
  return <span className="ml-1 text-tape-accent">{direction === 'asc' ? '↑' : '↓'}</span>
}

type FilterBarProps = {
  table: Table<Trade>
  grip: ReactNode | undefined
  nameplate: ReactNode | undefined
  suggestions: Suggestions
  /** Unique per grid, so a second pane's boxes do not read this one's lists. */
  idPrefix: string
}

/** Filtering is client-side: the cache holds every trade, so a frame outside the
 *  filter still belongs in it and clearing needs no round trip. */
function FilterBar({
  table,
  grip,
  nameplate,
  suggestions,
  idPrefix,
}: FilterBarProps): ReactElement {
  const value = (id: string): string => (table.getColumn(id)?.getFilterValue() as string) ?? ''
  const set = (id: string, next: string): void => {
    table.getColumn(id)?.setFilterValue(next === '' ? undefined : next)
  }
  const listId = (column: string): string => `${idPrefix}-${column}`

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {/* First, so the handle is in the same place on every pane. */}
      {grip}
      {nameplate}

      <input
        aria-label="Filter by symbol"
        placeholder="Symbol"
        className={`${FILTER} w-24`}
        list={listId('symbol')}
        value={value('symbol')}
        onChange={(event) => set('symbol', event.target.value.toUpperCase())}
      />
      <SuggestionList id={listId('symbol')} values={suggestions.symbol} />

      <input
        aria-label="Filter by trader"
        placeholder="Trader"
        className={`${FILTER} w-32`}
        list={listId('trader')}
        value={value('trader')}
        onChange={(event) => set('trader', event.target.value)}
      />
      <SuggestionList id={listId('trader')} values={suggestions.trader} />

      <input
        aria-label="Filter by book"
        placeholder="Book"
        className={`${FILTER} w-32`}
        list={listId('book')}
        value={value('book')}
        onChange={(event) => set('book', event.target.value)}
      />
      <SuggestionList id={listId('book')} values={suggestions.book} />

      <Select
        className={`${FILTER} w-28`}
        label="Filter by side"
        onChange={(next) => set('side', next)}
        options={SIDE_FILTER}
        value={value('side')}
      />

      <Select
        className={`${FILTER} w-44`}
        label="Filter by status"
        onChange={(next) => set('status', next)}
        options={STATUS_FILTER}
        value={value('status')}
      />
    </div>
  )
}

/** Stated widths on the boxes above: a button sizes to its label, so a filter row
 *  would otherwise move as it is used. */
const SIDE_FILTER: SelectOption[] = [
  { value: '', label: 'Both sides' },
  { value: 'BUY', label: 'BUY' },
  { value: 'SELL', label: 'SELL' },
]

const STATUS_FILTER: SelectOption[] = [
  { value: '', label: 'Any status' },
  { value: 'NEW', label: 'NEW' },
  { value: 'PARTIALLY_FILLED', label: 'PARTIALLY_FILLED' },
  { value: 'FILLED', label: 'FILLED' },
  { value: 'CANCELLED', label: 'CANCELLED' },
]

/** Lighter than the canvas it sits on, so the filter row reads as chrome. */
const FILTER = `${CONTROL} bg-tape-panel`
