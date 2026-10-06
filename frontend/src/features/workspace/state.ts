import { z } from 'zod'
import type { Arrangement, Orientation, Region } from './layout.js'
import { panesOf, pathsOf, sharesOf } from './layout.js'
import type { PaneConfig } from './paneConfig.js'
import { DEFAULT_VIEW, showsByDefault } from './paneConfig.js'

/**
 * The columns a shared link is allowed to name. An enum rather than a free
 * string, because a link naming a column that does not exist is not a view the
 * grid can build.
 *
 * Duplicated from the column definitions on purpose: a schema that read its own
 * valid values out of the thing it validates would accept whatever it was given.
 * A test holds the two lists together.
 */
const COLUMN_IDS = [
  'tradeId',
  'tradeTimestamp',
  'symbol',
  'side',
  'quantity',
  'price',
  'notional',
  'trader',
  'book',
  'counterparty',
  'status',
  'version',
] as const

export const SHAREABLE_COLUMNS: readonly string[] = COLUMN_IDS

const columnId = z.enum(COLUMN_IDS)

/**
 * Panes have a floor of one and a ceiling of eight. The floor carries the
 * one-pane-cannot-close invariant into the schema, so a crafted link cannot
 * produce the empty workspace the UI has no way to reach.
 */
export const MAX_PANES = 8

const view = z.object({
  sorting: z.array(z.object({ id: columnId, desc: z.boolean() })).max(COLUMN_IDS.length),

  /**
   * Filter values are always strings: they arrive as one parameter value each,
   * and a URLSearchParams value is a string or it is absent. The bound is here
   * because the box itself has no maxlength.
   */
  columnFilters: z
    .array(z.object({ id: columnId, value: z.string().max(64) }))
    .max(COLUMN_IDS.length),

  /** Group By and Split By, and there is no third control to undo a third level. */
  grouping: z.array(columnId).max(2),

  /**
   * The one place a column id is not checked. Visibility is read per column as
   * columnVisibility[column.id] ?? true, so a key for a column that is not there
   * is never looked at, and checking it would mean a Partial record, whose values
   * are boolean | undefined and so not a VisibilityState.
   */
  columnVisibility: z.record(z.string().max(64), z.boolean()),
})

/**
 * Where a pane sits and how much of the window it has. A share is a fraction of
 * the window rather than of the split above it, which is the figure that means
 * the same thing whatever the link does with the levels in between.
 */
/** No split can have more children than the workspace has panes to put in it. */
const LAST_SLOT = MAX_PANES - 1

const step = z.int().min(0).max(LAST_SLOT)

const placed = z.object({
  at: z.array(step).min(1).max(MAX_PANES),
  share: z.number().finite().gt(0).max(1),
})

/**
 * How long a pane's name can be. Exported so the box enforces it as it is typed,
 * rather than the schema refusing the whole link afterwards.
 */
export const NAME_LIMIT = 24

/**
 * A pane's own name, or null for one that has none. Free text someone typed, so
 * there is nothing to validate but the length.
 */
const paneName = z.string().min(1).max(NAME_LIMIT).nullable()

export const workspaceState = z.object({
  /**
   * The root split's axis, and every other axis follows from it: the tree holds
   * no split inside a split on its own axis, so the axes alternate with depth.
   */
  axis: z.enum(['rows', 'columns']),
  panes: z
    .array(z.object({ ...view.shape, ...placed.shape, name: paneName }))
    .min(1)
    .max(MAX_PANES),
})

/**
 * How many panes there are, stated only when it cannot be worked out.
 *
 * Needed because a pane carrying no settings of its own writes no parameters,
 * so three panes where the last two are untouched would otherwise read as one.
 */
export const PANES_PARAM = 'panes'

/** The root split's axis, stated only when it is not the stack a link opens on. */
const AXIS_PARAM = 'axis'

/**
 * The pane parameters, which is what tells them apart from anything else in the
 * query string. The capture is the pane number, counted from one so the URL
 * matches the pane labels on screen.
 */
const PANE_KEY = /^p([1-9]\d*)\./

/** Every parameter this module owns, and so every one a share has to clear. */
function owned(key: string): boolean {
  return key === PANES_PARAM || key === AXIS_PARAM || PANE_KEY.test(key)
}

/**
 * Four decimal places, which is a tenth of a pixel on a 4K screen. Weights are
 * re-derived from these and renormalised, so three thirds written as `0.3333`
 * come back as three thirds rather than a workspace a ten-thousandth short.
 */
const PLACES = 1e4

/** Near enough to even that stating the sizes would be noise. */
const ROUNDING = 1 / PLACES

/**
 * Whether this is the order a pane opens on, which a link therefore leaves
 * unsaid. Compared field by field rather than by identity, because the sorting a
 * grid reports back is rebuilt by the table on every change.
 */
function opensOnOrder(sorting: PaneConfig['sorting']): boolean {
  return (
    sorting.length === DEFAULT_VIEW.sorting.length &&
    sorting.every((sort, index) => {
      const same = DEFAULT_VIEW.sorting[index]
      return sort.id === same?.id && sort.desc === same.desc
    })
  )
}

/**
 * The view of one pane, as query parameters:
 *
 *     ?panes=2&p1.group=symbol&p1.group=book&p1.sort=-quantity&p1.where.symbol=VOD
 *
 * Lists repeat the parameter rather than joining with a separator. URLSearchParams
 * serialises to application/x-www-form-urlencoded, whose safe set is only
 * alphanumerics, `*`, `-`, `.` and `_`, so a comma comes out as `%2C`. Repeating
 * the key escapes nothing except a filter value and a pane's name, which are free
 * text someone typed into a box. `-` marks a descending sort.
 *
 * The arrangement rides along as `axis` for the root and `p{n}.at`, `p{n}.size`
 * and `p{n}.name` per pane. Everything here is omitted when it matches the
 * default, which the decoder's own defaults are the other half of.
 */
export function encodeWorkspace(root: Region, viewOf: (id: string) => PaneConfig): URLSearchParams {
  const params = new URLSearchParams()
  const panes = panesOf(root)
  const paths = pathsOf(root)
  const shares = sharesOf(root)

  params.set(PANES_PARAM, String(panes.length))
  if (root.kind === 'split' && root.axis === 'columns') {
    params.set(AXIS_PARAM, root.axis)
  }

  // Paths are worth stating only once something is nested, because in a single
  // split every path is the pane's own number over again. Sizes only once a
  // splitter has been moved.
  const nested = panes.some((leaf) => (paths.get(leaf.id)?.length ?? 1) > 1)
  const even = panes.every(
    (leaf) => Math.abs((shares.get(leaf.id) ?? 0) - 1 / panes.length) < ROUNDING,
  )

  panes.forEach((leaf, index) => {
    const config = viewOf(leaf.id)
    const key = (field: string): string => `p${index + 1}.${field}`

    // Only a name somebody chose. A pane without one is named by where it sits.
    if (leaf.name !== undefined) {
      params.set(key('name'), leaf.name)
    }
    if (nested) {
      params.set(key('at'), (paths.get(leaf.id) ?? []).join('.'))
    }
    if (!even) {
      params.set(key('size'), String(Math.round((shares.get(leaf.id) ?? 0) * PLACES) / PLACES))
    }

    for (const id of config.grouping) {
      params.append(key('group'), id)
    }
    if (!opensOnOrder(config.sorting)) {
      const tokens = config.sorting.map((sort) => `${sort.desc ? '-' : ''}${sort.id}`)
      // A `sort` with nothing after it is a pane with no order at all, which has
      // to be stated because an absent one means the default.
      for (const token of tokens.length === 0 ? [''] : tokens) {
        params.append(key('sort'), token)
      }
    }
    // One parameter per filter rather than a list of id:value pairs. A value is
    // free text, so any separator chosen for it is one a trader can type into the
    // box and break their own link with.
    for (const filter of config.columnFilters) {
      params.set(key(`where.${filter.id}`), String(filter.value))
    }
    // Driven by the column list rather than by the record's own keys: a record
    // with no entry for a column is a pane showing it, and only the list knows
    // which columns there are to have no entry for.
    for (const id of COLUMN_IDS) {
      const visible = config.columnVisibility[id] ?? true
      if (visible !== showsByDefault(id)) {
        params.append(key(visible ? 'show' : 'hide'), id)
      }
    }
  })

  return params
}

/**
 * How many panes the link is asking for: the stated count if there is one, and
 * otherwise the highest pane any parameter mentions. The count only has to be
 * stated to ask for a pane that carries no settings of its own.
 *
 * The ceiling is enforced here as well as in the schema, because this is the
 * number a loop runs to and a link may ask for a hundred thousand.
 */
function paneCount(params: URLSearchParams): number | null {
  const stated = params.get(PANES_PARAM)
  if (stated !== null) {
    const count = Number(stated)
    return Number.isInteger(count) && count >= 1 && count <= MAX_PANES ? count : null
  }

  let highest = 0
  for (const key of params.keys()) {
    const match = PANE_KEY.exec(key)
    if (match?.[1] !== undefined) {
      highest = Math.max(highest, Number(match[1]))
    }
  }
  return highest >= 1 && highest <= MAX_PANES ? highest : null
}

/**
 * The sizes the link states, with whatever it left out dividing what is left
 * over evenly: `&p1.size=0.5` on a workspace of three gives pane one half and
 * the other two a quarter each. Null when the link has already spent the window
 * and still has panes to place.
 *
 * Sizes that account for every pane are passed through untouched and
 * renormalised downstream, because four decimal places do not sum to one and a
 * link that says so exactly should not be rejected for rounding.
 */
function sizes(stated: readonly (number | null)[]): number[] | null {
  const blanks = stated.filter((size) => size === null).length
  if (blanks === 0) {
    return stated.map((size) => size ?? 0)
  }

  // The accumulator is stated because the sizes it adds up are nullable, and
  // reduce would otherwise take the running total's type from them.
  const spent = stated.reduce<number>((sum, size) => sum + (size ?? 0), 0)
  const spare = 1 - spent
  if (spare <= 0) {
    return null
  }
  return stated.map((size) => size ?? spare / blanks)
}

/** A pane, as the path the link puts it on and the number the link calls it. */
type Placement = { at: readonly number[]; of: number }

/**
 * The paths the link states, read as a tree, or null if they do not describe
 * one.
 *
 * The leaves are pane numbers rather than ids, counted from zero, and the order
 * of a split is the order of the indices rather than of the pane numbers. A link
 * whose paths disagree with its numbering draws the panes where the paths put
 * them and renumbers them on the next share.
 *
 * Gaps in the indices are an order and nothing more, so `0` and `2` are the
 * first and the second. A level holding a single slot has nothing to divide, so
 * what it holds moves up. A pane and a split in the same slot, or two panes
 * claiming it, is rejected rather than guessed at.
 */
function arrangementOf(placements: readonly Placement[]): Arrangement | null {
  const only = placements[0]
  if (only === undefined) {
    return null
  }
  if (placements.length === 1) {
    return only.of
  }
  if (placements.some((pane) => pane.at.length === 0)) {
    return null
  }

  const groups = new Map<number, Placement[]>()
  for (const pane of placements) {
    const step = pane.at[0] ?? 0
    groups.set(step, [...(groups.get(step) ?? []), { at: pane.at.slice(1), of: pane.of }])
  }

  const children: Arrangement[] = []
  for (const step of [...groups.keys()].sort((left, right) => left - right)) {
    const child = arrangementOf(groups.get(step) ?? [])
    if (child === null) {
      return null
    }
    children.push(child)
  }

  const [first, second, ...rest] = children
  if (first === undefined) {
    return null
  }
  return second === undefined ? first : [first, second, ...rest]
}

/** A workspace as a link describes it: the views, how they are arranged, and how
 *  much of the window each one has. */
export type WorkspaceLink = {
  axis: Orientation
  /** In the order the link numbers them, which the arrangement indexes into. */
  views: PaneConfig[]
  arrangement: Arrangement
  /** Each pane's share of the window, indexed as `views` is. */
  shares: number[]
  /** Each pane's own name where the link carries one, and null where it leaves
   *  the pane to be named by where it sits. Indexed as `views` is. */
  names: (string | null)[]
}

/**
 * Null for anything that is not a workspace, and the caller falls back to the
 * default single pane. The whole link is rejected rather than the part that could
 * not be read: a link that half-applies shows a view nobody chose.
 *
 * What a link does not state it gets from the default view, which is the other
 * half of the encoder writing only what differs. So this returns a whole
 * PaneConfig per pane whatever the query holds, and the grid never has to know
 * which of its settings came off a URL.
 */
export function decodeWorkspace(params: URLSearchParams): WorkspaceLink | null {
  const count = paneCount(params)
  if (count === null) {
    return null
  }

  const panes = []
  for (let number = 1; number <= count; number += 1) {
    const key = (field: string): string => `p${number}.${field}`
    const where = key('where.')
    const at = params.get(key('at'))
    const size = params.get(key('size'))
    const name = params.get(key('name'))?.trim() ?? ''
    const order = params.getAll(key('sort'))

    panes.push({
      // Blank is the same as absent: a name of nothing is a pane back on the
      // name its position gives it, not a pane with an empty title.
      name: name === '' ? null : name,
      // A pane with no path stated sits at the top level in its own numbered
      // slot, so appending two paths to a bare link is a complete request and
      // the unnested workspace states no paths at all.
      at: at === null ? [number - 1] : at.split('.').map(Number),
      share: size === null ? null : Number(size),
      // Absent is the order a pane opens on, not no order. A parameter with no
      // value is the no order case.
      sorting:
        order.length === 0
          ? DEFAULT_VIEW.sorting
          : order
              .filter((token) => token !== '')
              .map((token) =>
                token.startsWith('-')
                  ? { id: token.slice(1), desc: true }
                  : { id: token, desc: false },
              ),
      columnFilters: [...params]
        .filter(([name]) => name.startsWith(where))
        .map(([name, value]) => ({ id: name.slice(where.length), value })),
      grouping: params.getAll(key('group')),
      columnVisibility: {
        // The default underneath, so a link names the columns it changes and a
        // pane that names none opens with the columns a pane opens with.
        ...DEFAULT_VIEW.columnVisibility,
        ...Object.fromEntries([
          ...params.getAll(key('hide')).map((id) => [id, false]),
          ...params.getAll(key('show')).map((id) => [id, true]),
        ]),
      },
    })
  }

  const shares = sizes(panes.map((pane) => pane.share))
  if (shares === null) {
    return null
  }

  // Shaped by hand above, validated here: the schema is the only thing that
  // knows which names are columns.
  const parsed = workspaceState.safeParse({
    axis: params.get(AXIS_PARAM) ?? 'rows',
    panes: panes.map((pane, index) => ({ ...pane, share: shares[index] ?? 0 })),
  })
  if (!parsed.success) {
    return null
  }

  const arrangement = arrangementOf(parsed.data.panes.map((pane, of) => ({ at: pane.at, of })))
  if (arrangement === null) {
    return null
  }

  return {
    axis: parsed.data.axis,
    // Named one by one rather than spread, so the arrangement does not travel on
    // into a pane's view as two fields a grid has no idea what to do with.
    views: parsed.data.panes.map((pane) => ({
      sorting: pane.sorting,
      columnFilters: pane.columnFilters,
      grouping: pane.grouping,
      columnVisibility: pane.columnVisibility,
    })),
    arrangement,
    shares: parsed.data.panes.map((pane) => pane.share),
    names: parsed.data.panes.map((pane) => pane.name),
  }
}

/** The workspace in the address bar, if there is one that parses. */
export function readWorkspace(search: string): WorkspaceLink | null {
  return decodeWorkspace(new URLSearchParams(search))
}

/**
 * The link to hand over, and the address bar updated to match it.
 *
 * replaceState rather than pushState: the arrangement is not a place the back
 * button should return to, and a trader changing the grouping four times should
 * not have to press back four times to leave.
 */
export function workspaceUrl(root: Region, viewOf: (id: string) => PaneConfig): string {
  const url = new URL(window.location.href)

  // Cleared before it is written. Closing a pane, clearing a filter or putting
  // the panes back in a stack removes a parameter, or the next read picks up
  // what the last share left.
  for (const key of [...url.searchParams.keys()]) {
    if (owned(key)) {
      url.searchParams.delete(key)
    }
  }
  for (const [key, value] of encodeWorkspace(root, viewOf)) {
    url.searchParams.append(key, value)
  }

  window.history.replaceState(null, '', url)
  return url.toString()
}
