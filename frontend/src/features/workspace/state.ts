import { z } from 'zod'
import type { Arrangement, Orientation, Region } from './layout.js'
import { panesOf, pathsOf, sharesOf } from './layout.js'
import type { PaneConfig } from './paneConfig.js'
import { DEFAULT_VIEW, showsByDefault } from './paneConfig.js'

/** The columns a shared link may name. An enum, because a link naming a column that
 *  does not exist is not a view the grid can build. Duplicated from the column
 *  definitions on purpose: a schema reading its valid values out of the thing it
 *  validates would accept anything. A test holds the two lists together. */
const COLUMN_IDS = [
  'tradeId',
  'tradeTimestamp',
  'symbol',
  'side',
  'quantity',
  'filledQuantity',
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

/** The ceiling on panes. The schema's matching floor of one carries the
 *  cannot-close-the-only-pane invariant, so no crafted link can empty a workspace. */
export const MAX_PANES = 8

const view = z.object({
  sorting: z.array(z.object({ id: columnId, desc: z.boolean() })).max(COLUMN_IDS.length),

  /** A URLSearchParams value is a string or it is absent. The bound is here
   *  because the filter box has no maxlength. */
  columnFilters: z
    .array(z.object({ id: columnId, value: z.string().max(64) }))
    .max(COLUMN_IDS.length),

  /** Group By and Split By, and there is no third control to undo a third level. */
  grouping: z.array(columnId).max(2),

  /** Empty is definition order. Checked against the column list because this one
   *  is read as a position, so an unknown id would silently move the rest. */
  columnOrder: z.array(columnId).max(COLUMN_IDS.length),

  /** The one place a column id is not checked: an unknown key is never read, and
   *  checking it would make this a Partial record, whose boolean | undefined values are
   *  not a VisibilityState. */
  columnVisibility: z.record(z.string().max(64), z.boolean()),
})

/** No split can have more children than the workspace has panes to put in it. */
const LAST_SLOT = MAX_PANES - 1

const step = z.int().min(0).max(LAST_SLOT)

/** Where a pane sits and how much of the window it has. A share is a fraction of
 *  the window, not of the split above it: the only figure that survives whatever
 *  the link does with the levels in between. */
const placed = z.object({
  at: z.array(step).min(1).max(MAX_PANES),
  share: z.number().finite().gt(0).max(1),
})

/** How long a pane's name can be. Exported so the box enforces it as it is
 *  typed, rather than the schema refusing the whole link afterwards. */
export const NAME_LIMIT = 24

/** A pane's own name, or null for one that has none. Free text, so only the
 *  length is validated. */
const paneName = z.string().min(1).max(NAME_LIMIT).nullable()

export const workspaceState = z.object({
  /** The root split's axis, and every other follows from it: no split holds a
   *  split on its own axis, so the axes alternate with depth. */
  axis: z.enum(['rows', 'columns']),
  panes: z
    .array(z.object({ ...view.shape, ...placed.shape, name: paneName }))
    .min(1)
    .max(MAX_PANES),
})

/** How many panes there are, stated only when it cannot be worked out. A pane carrying
 *  no settings of its own writes no parameters, so three panes with the last two
 *  untouched would otherwise read as one. */
export const PANES_PARAM = 'panes'

/** The root split's axis, stated only when it is not the stack a link opens on. */
const AXIS_PARAM = 'axis'

/** Marks a pane parameter. The capture is the pane number, counted from one so
 *  the URL matches the pane labels on screen. */
const PANE_KEY = /^p([1-9]\d*)\./

/** Every parameter this module owns, and so every one a share has to clear. */
function owned(key: string): boolean {
  return key === PANES_PARAM || key === AXIS_PARAM || PANE_KEY.test(key)
}

/** Four decimal places, a tenth of a pixel on a 4K screen. Weights are re-derived from
 *  these and renormalised, so three thirds written as `0.3333` come back as three
 *  thirds rather than a workspace a ten-thousandth short. */
const PLACES = 1e4

/** Near enough to even that stating the sizes would be noise. */
const ROUNDING = 1 / PLACES

/** Whether this is the order a pane opens on, which a link therefore leaves unsaid.
 *  Field by field rather than by identity: the table rebuilds the sorting it reports
 *  back on every change. */
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
 * Lists repeat the key rather than joining on a separator: form-urlencoding has a safe
 * set of alphanumerics, `*`, `-`, `.` and `_`, so a comma would come out as `%2C`. Only
 * a filter value and a pane's name can need escaping, and `-` marks a descending sort.
 * The arrangement rides along as `axis` for the root and `p{n}.at`, `p{n}.size` and
 * `p{n}.name` per pane. Anything matching the default is omitted, which the decoder's
 * own defaults are the other half of.
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

  // Paths only once something is nested: in a single split every path is the
  // pane's own number again. Sizes only once a splitter has been moved.
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
    // In full or not at all: the table reads the columns left out as last, so a
    // prefix is not shorthand for the rest.
    for (const id of config.columnOrder) {
      params.append(key('order'), id)
    }
    if (!opensOnOrder(config.sorting)) {
      const tokens = config.sorting.map((sort) => `${sort.desc ? '-' : ''}${sort.id}`)
      // An empty `sort` is a pane with no order at all, which has to be stated
      // because an absent one means the default.
      for (const token of tokens.length === 0 ? [''] : tokens) {
        params.append(key('sort'), token)
      }
    }
    // One parameter per filter, not a list of id:value pairs: a value is free
    // text, so any separator is one a trader can type and break the link with.
    for (const filter of config.columnFilters) {
      params.set(key(`where.${filter.id}`), String(filter.value))
    }
    // Driven by the column list, not the record's own keys: a column with no
    // entry is one the pane shows, and only the list knows which columns exist.
    for (const id of COLUMN_IDS) {
      const visible = config.columnVisibility[id] ?? true
      if (visible !== showsByDefault(id)) {
        params.append(key(visible ? 'show' : 'hide'), id)
      }
    }
  })

  return params
}

/** How many panes the link is asking for: the stated count, or the highest pane any
 *  parameter mentions. The ceiling is enforced here as well as in the schema, because
 *  this is the number a loop runs to and a link may ask for a hundred thousand. */
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

/** The sizes the link states, with whatever it left out dividing the rest evenly:
 *  `&p1.size=0.5` on a workspace of three gives a half and two quarters. Null once the
 *  window is spent and panes are still to place. Fully stated sizes pass through and
 *  are renormalised downstream, since four places need not sum to one. */
function sizes(stated: readonly (number | null)[]): number[] | null {
  const blanks = stated.filter((size) => size === null).length
  if (blanks === 0) {
    return stated.map((size) => size ?? 0)
  }

  // The accumulator type is stated because the sizes it adds up are nullable.
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
 * The paths the link states, read as a tree, or null if they do not describe one. Leaves
 * are pane numbers counted from zero, and a split's order is the order of the indices
 * rather than of the pane numbers: gaps are an order and nothing more, so `0` and `2`
 * are the first and the second. A level holding one slot promotes what it holds. Two
 * panes claiming a slot, or a pane and a split, is rejected rather than guessed at.
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

/** A workspace as a link describes it. */
export type WorkspaceLink = {
  axis: Orientation
  /** In the order the link numbers them, which the arrangement indexes into. */
  views: PaneConfig[]
  arrangement: Arrangement
  /** Each pane's share of the window, indexed as `views` is. */
  shares: number[]
  /** Each pane's own name, or null where the link leaves it to its position.
   *  Indexed as `views` is. */
  names: (string | null)[]
}

/**
 * Null for anything that is not a workspace; the caller falls back to the default single
 * pane. All or nothing, because a link that half-applies shows a view nobody chose.
 * Whatever a link leaves unsaid comes from the default view, the other half of the
 * encoder writing only what differs, so every pane comes back a whole PaneConfig and
 * the grid never has to know what came off a URL.
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
      // Blank is the same as absent: the pane goes back to its position's name.
      name: name === '' ? null : name,
      // No path means the top level, so two appended paths are a complete request.
      at: at === null ? [number - 1] : at.split('.').map(Number),
      share: size === null ? null : Number(size),
      // Absent is the order a pane opens on; a `sort` with no value is no order.
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
      columnOrder: params.getAll(key('order')),
      columnVisibility: {
        // The default underneath, so a link names only the columns it changes.
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

  // Shaped by hand above, validated here: only the schema knows the column names.
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
    // Field by field rather than spread, so `at` and `share` stay out of the view.
    views: parsed.data.panes.map((pane) => ({
      sorting: pane.sorting,
      columnFilters: pane.columnFilters,
      grouping: pane.grouping,
      columnVisibility: pane.columnVisibility,
      columnOrder: pane.columnOrder,
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

/** The link to hand over, and the address bar updated to match it. replaceState rather
 *  than pushState: four grouping changes must not become four presses of Back to
 *  leave. */
export function workspaceUrl(root: Region, viewOf: (id: string) => PaneConfig): string {
  const url = new URL(window.location.href)

  // Cleared first: closing a pane or clearing a filter removes parameters, and
  // otherwise the next read picks up what the last write left.
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
