import type {
  ColumnFiltersState,
  GroupingState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'

/**
 * A pane's view of the tape: how it is ordered, filtered, grouped and which
 * columns it shows.
 *
 * Its own module rather than a type on BlotterTable, because the workspace
 * composes panes and a pane must not import the workspace back. Expanded state
 * is deliberately not here: which groups are open is a reading position.
 */
export type PaneConfig = {
  sorting: SortingState
  columnFilters: ColumnFiltersState
  grouping: GroupingState
  columnVisibility: VisibilityState
}

/** What the server orders by, so the first paint does not reshuffle. */
const DEFAULT_SORT: SortingState = [{ id: 'tradeTimestamp', desc: true }]

/**
 * The view a pane opens on when nobody has configured it. Here with the type
 * rather than on the grid, because the workspace wants a real PaneConfig for a
 * pane it has not heard from yet and the link format writes against it.
 *
 * Stated rather than left as an empty object: an empty sorting is no order, not
 * the default order.
 */
export const DEFAULT_VIEW: PaneConfig = {
  sorting: DEFAULT_SORT,
  columnFilters: [],
  grouping: [],
  // Off by default. In the view, not on the column, so a link carries it.
  columnVisibility: { tradeId: false },
}

/**
 * Whether a column is on in the view a pane opens on. Visibility is read per
 * column as columnVisibility[id] ?? true, so a record that says nothing about a
 * column still means something about it.
 */
export function showsByDefault(id: string): boolean {
  return DEFAULT_VIEW.columnVisibility[id] ?? true
}
