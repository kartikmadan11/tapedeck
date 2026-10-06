import type {
  ColumnFiltersState,
  ColumnOrderState,
  GroupingState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table'

/** A pane's view of the tape: order, filters, grouping, column visibility. Its own
 *  module to keep BlotterTable from importing the workspace back. Expanded state is
 *  excluded: which groups are open is a reading position, not a view. */
export type PaneConfig = {
  sorting: SortingState
  columnFilters: ColumnFiltersState
  grouping: GroupingState
  columnVisibility: VisibilityState
  columnOrder: ColumnOrderState
}

/** What the server orders by, so the first paint does not reshuffle. */
const DEFAULT_SORT: SortingState = [{ id: 'tradeTimestamp', desc: true }]

/** The view a pane opens on. Lives here because the workspace needs a real PaneConfig
 *  for a pane it has not heard from, and the link format writes against it. Stated
 *  rather than empty: an empty sorting is no order, not the default. */
export const DEFAULT_VIEW: PaneConfig = {
  sorting: DEFAULT_SORT,
  columnFilters: [],
  grouping: [],
  // A reference key and an audit detail, neither read while scanning. In the
  // view rather than on the column, so a link carries them.
  columnVisibility: { tradeId: false, version: false },
  // Empty means definition order; listing them would be a second order to keep.
  columnOrder: [],
}

/** Whether a column is on in the view a pane opens on. Read as
 *  columnVisibility[id] ?? true, so an absent key still means visible. */
export function showsByDefault(id: string): boolean {
  return DEFAULT_VIEW.columnVisibility[id] ?? true
}
