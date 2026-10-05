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
 * composes panes and a pane must not import the workspace back.
 *
 * Expanded state is deliberately not here. Which groups a trader has opened is a
 * reading position rather than a view, so duplicating a pane should hand over the
 * arrangement and not the scroll-and-click history of the person who made it.
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
 * The view a pane opens on when nobody has configured it.
 *
 * Here with the type rather than on the grid, because two things need it and
 * only one of them is a component: the workspace wants a real PaneConfig for a
 * pane it has not heard from yet, and the link format needs the baseline it
 * writes against, since a link states what a pane does differently and nothing
 * else.
 *
 * It is this and not an empty object because an empty sorting is not the default
 * order, it is no order, and a link made before the first interaction has to
 * reproduce what the trader was looking at.
 */
export const DEFAULT_VIEW: PaneConfig = {
  sorting: DEFAULT_SORT,
  columnFilters: [],
  grouping: [],
  // Off by default. In the view, not on the column, so a link carries it.
  columnVisibility: { tradeId: false },
}

/**
 * Whether a column is on in the view a pane opens on.
 *
 * Visibility is read per column as columnVisibility[id] ?? true, so a record
 * that says nothing about a column still means something about it. Asking per
 * column rather than comparing the two records is what lets a link carry the
 * difference between them.
 */
export function showsByDefault(id: string): boolean {
  return DEFAULT_VIEW.columnVisibility[id] ?? true
}
