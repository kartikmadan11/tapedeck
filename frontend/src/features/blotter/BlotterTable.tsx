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
import { toMinorUnits } from '@tapedeck/shared'
import type { KeyboardEvent, ReactElement, ReactNode } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { SelectOption } from '../../components/Select.js'
import { Select } from '../../components/Select.js'
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

  /**
   * Names the pane. Two grids with the same accessible name are two grids a
   * screen reader cannot tell apart.
   */
  label?: string | undefined

  /**
   * The view this pane opens on. Once mounted the pane owns its own state, which
   * keeps a keystroke in one pane's filter box from re-rendering the other.
   */
  initialConfig?: PaneConfig | undefined

  /**
   * Reports the view back out whenever it changes.
   *
   * Must be stable for the pane's life. It is a dependency of the effect that
   * calls it, so a fresh function on every render would report on every render.
   */
  onConfigChange?: ((config: PaneConfig) => void) | undefined

  /**
   * Opens another pane on the view this one currently holds. Omitted when there
   * is no workspace to add it to, which is also what hides the button.
   */
  onDuplicate?: ((config: PaneConfig) => void) | undefined

  /**
   * Omitted on the first pane, which is permanent. Absence is the whole
   * mechanism: there is no way to render a Close button that would empty the
   * workspace.
   */
  onClose?: (() => void) | undefined

  /**
   * Opens another pane on the default view. Omitted when the workspace is at its
   * ceiling, which greys the menu item rather than dropping it.
   */
  onNewPane?: (() => void) | undefined

  /** Copies a link to the whole workspace, not to this pane. */
  onShare?: (() => void) | undefined

  /**
   * The handle this pane is moved by, rendered at the head of its filter bar. A
   * node rather than a callback, because what it takes to move a pane is the
   * arranging component's business. Omitted when there is nothing to arrange.
   */
  grip?: ReactNode | undefined

  /**
   * The pane's name, shown on the bar beside the handle and edited there.
   * `label` is the same name as a string, which is what the grid needs for its
   * own accessible name.
   */
  nameplate?: ReactNode | undefined
}

/**
 * Sticks the leftmost visible column. Positional, not a named column: left-0 is
 * right for exactly one column, and which one is leftmost changes.
 *
 * The right border is drawn by the cell, which is why the table is
 * border-separate: in collapsed mode the table paints it and it scrolls away.
 */
const PINNED = 'sticky left-0 z-10 border-r border-tape-line'

/**
 * A row's height in pixels, which is `h-8` on the tr below. The virtualiser is
 * told this rather than measuring, so the two have to be changed together or
 * the tape scrolls to the wrong place.
 */
const ROW_PX = 32

/**
 * Divides one block of a split from the next, in the header and down the body,
 * so a row is read across in blocks rather than as one run of figures.
 */
const BLOCK_EDGE = 'border-l border-tape-line'

/**
 * Whether a column is where a block starts: either a block's own heading, which
 * spans the measures below it, or the first of those measures. Nothing starts a
 * block while there is no split, since nothing has a parent.
 */
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

  /**
   * Two things rather than two levels. grouping[0] cuts the rows; grouping[1] is
   * the column the measures are pivoted across, which is columns and not a
   * second level of rows, so the table is only ever told the first. Groups start
   * closed.
   */
  const [grouping, setGrouping] = useState<GroupingState>(initialConfig.grouping)
  const [expanded, setExpanded] = useState<ExpandedState>({})

  const groupBy = grouping[0]
  const splitBy = grouping[1]

  /**
   * The columns the trader chose, which is not the same thing as the columns on
   * screen: while there is a grouping, the ones a group row cannot answer for
   * are dropped over the top of this. Held separately rather than written into,
   * so clearing the grouping gives back exactly what they had.
   */
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialConfig.columnVisibility,
  )

  /** Empty means definition order. A grouping still hoists its own column to the
   *  front on top of this, which is what keeps the group label leading. */
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(initialConfig.columnOrder)

  /** One level, whatever the grouping holds. */
  const rowGrouping = useMemo(() => (groupBy === undefined ? [] : [groupBy]), [groupBy])

  /**
   * The split's blocks, which the column model below is rebuilt on. Empty when
   * the grouping asks for no split, or for one its column cannot divide.
   */
  const blocks = useMemo(() => splitBlocks(trades, splitBy), [trades, splitBy])
  const pivoted = blocks !== ''

  const shownColumns = useMemo(
    () => ({ ...columnVisibility, ...groupedVisibility(groupBy, pivoted) }),
    [columnVisibility, groupBy, pivoted],
  )

  /**
   * Resolved against the trader's own record, not against the one the table was
   * given. TanStack hands an updater the state it is holding, so taken as given
   * a single tick in the panel would bake every one of the grouping's drops into
   * the trader's choice.
   */
  const onVisibilityChange = useCallback((updater: Updater<VisibilityState>) => {
    setColumnVisibility((own) => (typeof updater === 'function' ? updater(own) : updater))
  }, [])

  /**
   * Which groups are open is deliberately not reported. It is a reading position
   * rather than a view, so it is not in PaneConfig and so it cannot be shared.
   */
  useEffect(() => {
    onConfigChange?.({ sorting, columnFilters, grouping, columnVisibility, columnOrder })
  }, [onConfigChange, sorting, columnFilters, grouping, columnVisibility, columnOrder])

  const [configOpen, setConfigOpen] = useState(false)
  // Generated rather than a literal, because the panel is per grid and a second
  // grid's toggle must not have its aria-controls pointing at this one's panel.
  // The filter boxes hang their suggestion lists off it for the same reason.
  const configPanelId = useId()

  const suggestions = useMemo(() => suggestionsOf(trades), [trades])

  /**
   * Back to the view a pane opens on: no sort, no filters, no grouping, and the
   * columns the default shows in the order it shows them. Not back to the
   * trades, the name or the size.
   */
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

  /**
   * Held as an id rather than as a row: the selected trade is re-read from the
   * data on every render, so a frame that amends or cancels it updates the bar
   * instead of leaving a stale copy there. An id also survives a sort, a filter
   * and a reorder, which an index would not.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null)

  /**
   * The base columns, plus one block of measures per split value. The base
   * measures stay in the model and go dark instead of being taken out: the Where
   * boxes filter on them, and TanStack silently skips a filter whose column it
   * cannot resolve.
   */
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
    // No onGroupingChange. The pane's grouping holds the row level and the
    // split, the table is told only the first, so a handler taking back what the
    // table reports would drop the second. The config panel writes it instead.
    onExpandedChange: setExpanded,
    onColumnVisibilityChange: onVisibilityChange,
    onColumnOrderChange: setColumnOrder,
    // Without this a sort or a filter would renumber the rows and React would
    // reuse the wrong row for the wrong trade.
    getRowId: (row) => row.tradeId,
    // Moves the columns being grouped on to the front, which is where the
    // labels belong: Book grouped and left in place would put the label after
    // the figures it heads. Safe only because of the drop above, which takes the
    // pinned Trade column off a grouped grid. Without that, reorder displaces it
    // from position 0 and takes the selection marker's first cell with it.
    groupedColumnMode: 'reorder',
    // Default is on, and the feed replaces the data every two seconds, so
    // without this every open group would snap shut on each frame.
    autoResetExpanded: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })

  const rows = table.getRowModel().rows
  const leaves = table.getFilteredRowModel().rows

  /**
   * What the rail under the tape says while no row is picked. Leaves either way,
   * so a grouping does not turn the count into a number of rails, and the figure
   * the pane was handed rather than the book: the server sends a window.
   */
  const counted =
    leaves.length === trades.length
      ? `${trades.length} trades`
      : `${leaves.length} of ${trades.length} trades`
  const hint =
    leaves.length === 0 ? counted : `${counted}, pick one to amend, cancel or see its history`

  /** Two bands under a split, the blocks above the measures they span. One otherwise. */
  const headerRows = table.getHeaderGroups()

  /**
   * What a full-width magnitude bar means. Taken over the filtered leaves, so
   * the bars measure what is on screen.
   *
   * useMemo on the row model's identity, not on a length, because the model is
   * replaced when the data is and the largest trade can change without the count
   * changing.
   */
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

  /**
   * The shortcuts are bound to the table, so focus has to be on it for them to
   * fire, and a cell is not focusable. Clicking a row therefore moves focus to
   * the table. preventScroll because the row is already in view and the browser
   * would otherwise jump the grid to it.
   */
  const grid = useRef<HTMLTableElement>(null)

  /** The element the rows scroll inside, which the virtualiser measures. */
  const scroller = useRef<HTMLDivElement>(null)

  /** The pane itself, for telling a pointer inside it from one somewhere else. */
  const pane = useRef<HTMLElement>(null)

  /**
   * estimateSize is a constant and nothing is measured, because every row is
   * exactly ROW_PX tall by construction: the height is on the tr and no cell
   * carries vertical padding. A group row is the same height as a trade row.
   *
   * No getItemKey. The virtualiser is keyed by position in the row model and
   * React is keyed by trade id below, which is the pairing that lets a sort
   * reorder the tape without reusing a row for the wrong trade.
   */
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_PX,
    // Enough that an arrow-key walk off the bottom edge has somewhere to land.
    overscan: 12,
  })

  const drawn = virtualizer.getVirtualItems()

  /**
   * The gaps above and below the drawn rows, held open by two empty tr elements.
   * A tr cannot be taken out of flow without destroying the table, which is
   * where the row and cell semantics behind role=grid come from.
   */
  const above = drawn[0]?.start ?? 0
  const below = virtualizer.getTotalSize() - (drawn.at(-1)?.end ?? 0)

  /**
   * Group rows are deliberately not selectable, as a correctness guard. TanStack
   * builds a group row from its first leaf trade's data, so a selected group
   * header would offer Amend and Cancel against an arbitrary row inside the
   * group. Clicking a group row opens it instead.
   */
  const select = useCallback((row: Row<Trade>) => {
    if (row.getIsGrouped()) {
      row.toggleExpanded()
      return
    }

    setSelectedId(row.id)
    grid.current?.focus({ preventScroll: true })
  }, [])

  /**
   * A pointer down away from the pane drops its selection, which is what
   * clicking off a row means. Escape already did it from the keyboard.
   *
   * A layer raised over the tape does not count as away: the two dialogs, the
   * history drawer, both menus and every dropdown are opened by the pane or by
   * the row that is selected, and they sit or portal outside it. Without that,
   * confirming a cancel would deselect the trade it names.
   */
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

    // Capture, as the menus do, so a handler that stops the event on its way up
    // cannot leave a row selected in a pane nobody is pointing at.
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [selectedId])

  /**
   * Resolved from what is actually on screen. Both the buttons and the keys read
   * these, so a hotkey cannot do what the matching disabled button refuses.
   */
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

      // Steps through the sorted, filtered and grouped order, which is the order
      // on screen.
      const current = rows.findIndex((row) => row.id === selectedId)
      const next = nextSelectable(rows, current, event.key === 'ArrowDown' ? 1 : -1)

      if (next === -1) {
        return
      }

      const id = rows[next]?.id

      if (id !== undefined) {
        setSelectedId(id)
        // Through the virtualiser, not the DOM. A row outside the drawn window
        // has no element, so looking one up by trade id would find nothing and
        // scroll nowhere, silently.
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
    // Wraps the whole grid rather than the table, so the bars and the config
    // panel are all reading the same filtered rows.
    <MagnitudeScale minor={notionalScale}>
      {/*
       * min-w-0 is load-bearing. A flex item keeps min-width:auto, and every cell
       * is whitespace-nowrap, so without it this section cannot shrink below the
       * full width of all twelve columns and pushes the positions panel off
       * screen.
       */}
      <section
        aria-label={label}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        ref={pane}
        // On the pane rather than on the tape, so the bar, the rows and the
        // config panel all answer to the same right-click. Shift is let through
        // to the browser's own menu, and so is a box someone is typing in: cut,
        // copy and paste belong to the field.
        onContextMenu={(event) => {
          const field =
            event.target instanceof Element ? event.target.closest('input, select, textarea') : null
          if (event.shiftKey || field !== null) {
            return
          }
          event.preventDefault()
          // A context menu raised from the keyboard carries no coordinates in
          // every browser, so the pane's own corner is the fallback.
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
              {
                label: 'New pane',
                onSelect: () => onNewPane?.(),
                disabled: onNewPane === undefined,
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
                // The panel outlives the menu that opened it, so the item is
                // the only thing left that can say it is open.
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

        {/* The panel is a sibling of the grid, not an overlay on it, so opening it
          shrinks the tape instead of covering the columns being read. */}
        <div className="flex min-h-0 flex-1">
          {/*
           * pb leaves the horizontal scrollbar somewhere to sit that is not on top
           * of the last row of the tape. focus-within rather than focus, because
           * what takes focus is the table inside, and a ring drawn on that would
           * scroll away with it.
           */}
          <div
            ref={scroller}
            className="tape-scroll min-w-0 flex-1 overflow-auto rounded-sm border border-tape-line pb-2.5 focus-within:border-tape-focus"
          >
            {/*
             * border-separate, not border-collapse. In collapsed mode the table
             * paints cell borders rather than the cell doing it, so the border on a
             * sticky cell scrolls away and leaves the pinned columns unedged.
             * Row borders are ignored in separate mode, so they move to the cells.
             *
             * table-fixed with the colgroup below is what virtualisation requires:
             * widths come from the columns and no cell is ever measured, so the
             * figures stay in line as rows scroll through. minWidth is the stated
             * total, and w-full lets a wide screen share out the slack.
             */}
            <table
              ref={grid}
              style={{ minWidth: table.getTotalSize() }}
              // grid rather than the default table role, because this one is
              // operated: it owns a selection and the keys that move it. Binding
              // those keys here rather than on the document keeps them from
              // firing underneath an open dialog, and from reaching a trader
              // typing BARC into the symbol filter.
              //
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: table is the one element ARIA in HTML allows role=grid on, and it is the APG data-grid pattern. The rule's fix, replacing the table with a div, would cost the real row and cell semantics.
              role="grid"
              tabIndex={0}
              aria-label={`${label}. Use the arrow keys to select a row.`}
              // The whole tape plus the header bands, not the handful of rows
              // drawn. Without it a virtualised grid tells a screen reader it
              // holds only the rows that happen to be on screen.
              aria-rowcount={rows.length + headerRows.length}
              onKeyDown={onKeyDown}
              className="w-full table-fixed border-separate border-spacing-0 text-left focus:outline-none"
            >
              {/* Driven by the visible leaves, so hiding a column takes its
                  width with it rather than leaving the header, the body and the
                  layout disagreeing about which column is which. */}
              <colgroup>
                {table.getVisibleLeafColumns().map((column) => (
                  <col key={column.id} style={{ width: column.getSize() }} />
                ))}
              </colgroup>

              {/*
               * Opaque, not tinted. A sticky header paints in the same stacking
               * context as the rows moving beneath it, so any transparency lets row
               * text slide through.
               *
               * z-20 against the pinned cell's z-10, so the header's own pinned
               * corner wins over the body cells it crosses.
               */}
              <thead className="sticky top-0 z-20 bg-tape-panel">
                {headerRows.map((group, band) => (
                  // The band height lives here and the cells carry no vertical
                  // padding.
                  <tr key={group.id} aria-rowindex={band + 1} className="h-8">
                    {group.headers.map((header, index) => {
                      const meta = header.column.columnDef.meta
                      // A block's own heading, which names the value its measures
                      // are netted over and so is centred over them rather than
                      // right-aligned on one of them.
                      const spanning = header.colSpan > 1

                      return (
                        <th
                          key={header.id}
                          // Without it the heading sits over the first of the
                          // measures it names instead of across them.
                          colSpan={header.colSpan}
                          // A pinned header needs its own background: the thead's
                          // scrolls sideways with the table, so it cannot be what
                          // hides the columns passing underneath.
                          // meta.className stays last: it is what right-aligns the
                          // numeric headers over their columns.
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

                  // Read first, because a group row's original is its first leaf
                  // trade: taken at face value it would show that trade's status
                  // and pending state as if they were the group's.
                  const grouped = row.getIsGrouped()
                  const cancelled = !grouped && row.original.status === 'CANCELLED'
                  const pending = !grouped && pendingIds.has(row.original.tradeId)
                  const isSelected = !grouped && row.id === selectedId

                  if (grouped) {
                    return (
                      <tr
                        key={row.id}
                        // Past the header bands, and one more because
                        // aria-rowindex is 1-based.
                        aria-rowindex={item.index + headerRows.length + 1}
                        // No data-trade-id: this is not a trade row.
                        aria-expanded={row.getIsExpanded()}
                        // bg-tape-panel, the header's colour, so a group reads as a
                        // rail across the tape rather than as a trade on it. No
                        // flash and no pending fade for the same reason.
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
                      // The only thing that tells a screen reader what the tint
                      // means.
                      aria-selected={isSelected}
                      className={[
                        // One background, chosen, not two layered: two background
                        // utilities in a class list resolve by Tailwind's output
                        // order rather than by which was written last.
                        //
                        // Both are opaque because the pinned cell inherits this
                        // colour and a translucent one would not hide the columns
                        // sliding behind it. No transition here, since one on
                        // background-color would smear the flash past its 900ms.
                        'h-8 cursor-pointer',
                        isSelected ? 'bg-tape-selected' : 'bg-tape-bg hover:bg-tape-raised',
                        cancelled ? 'text-tape-muted line-through' : '',
                        pending ? 'opacity-45' : '',
                        flashing.has(row.original.tradeId) ? 'tape-flash' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => select(row)}
                      // Guarded, not just wired: a double click must not be a way
                      // round the disabled Amend button on a cancelled row.
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
              // The panel is about to go inert with focus inside it, which would
              // drop focus to the document. The grid is what it configures.
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
          hint={hint}
        />
      </section>
    </MagnitudeScale>
  )
}

/**
 * The next trade row in the given direction, stepping over group rows. A group
 * is not a trade, so the selection must not be able to land on one. -1 when
 * there is nothing to move to, which leaves the selection where it is rather
 * than wrapping.
 */
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

/**
 * Holds the scroll extent open where rows are not drawn. A tr rather than an
 * absolutely positioned element, because a tr cannot be taken out of flow
 * without destroying the table, and the table is where the row and cell
 * semantics behind role=grid come from. Presentational because an empty row is a
 * layout device and not one of the grid's rows.
 */
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

/**
 * Shared by trade rows and group rows, so the pinned column, the selection
 * marker and the numeric alignment are declared once.
 */
function BodyCell({ cell, index, isSelected }: BodyCellProps): ReactElement {
  const meta = cell.column.columnDef.meta
  const leading = index === 0

  return (
    <td
      // bg-inherit, not a fixed colour: it has to follow the row through hover,
      // the selection, the flash and the pending fade, and inheritance tracks
      // the animated value.
      //
      // The selection marker rides the first cell as an inset shadow. A border
      // would push every cell in the row 2px out of line with the column above
      // it.
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

/**
 * Which of a column's renderers a cell gets. A placeholder is the grouped column
 * on a leaf row, and renders empty: the value is on the group row above it.
 */
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

/**
 * A heading, with the sort control on it where the column can be sorted.
 *
 * A placeholder is a column with no heading at this level, which under a split
 * is the grouped column: its name belongs on the band with the measures, not
 * repeated above them.
 */
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

/**
 * Filtering happens here rather than on the server, because the cache holds every
 * trade: a frame for a trade outside the current filter still belongs in the
 * cache, and clearing the filter must not need a round trip.
 */
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
      {/* First, so the handle is in the same place on every pane and does not
        move as the controls beside it wrap. */}
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

/** Stated widths, because a button takes its width from the label it is holding
 *  and a filter row that resized as it was used would move the box beside it. */
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
