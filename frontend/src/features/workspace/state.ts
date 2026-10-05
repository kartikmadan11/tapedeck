import { z } from 'zod'
import type { Arrangement, Orientation, Region } from './layout.js'
import { panesOf, pathsOf, sharesOf } from './layout.js'
import type { PaneConfig } from './paneConfig.js'
import { DEFAULT_VIEW, showsByDefault } from './paneConfig.js'

/**
 * The columns a shared link is allowed to name.
 *
 * An enum rather than a free string, because sorting, grouping and filtering all
 * look the id up as a column and work with what they find. A link naming a
 * column that does not exist is not a view the grid can build, so it is rejected
 * here rather than half-applied there.
 *
 * Duplicated from the column definitions on purpose: a schema that read its own
 * valid values out of the thing it validates would accept whatever it was given.
 * The test holds the two lists together, so adding a column and forgetting to
 * make it shareable fails a test rather than quietly dropping out of links.
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
 * Panes have a floor of one and a ceiling of eight.
 *
 * The floor carries the one-pane-cannot-close invariant into the schema, so a
 * crafted link cannot produce the empty workspace the UI has no way to reach.
 * The ceiling is there because each pane is a table model and a virtualiser, and
 * a link is a thing someone else clicks.
 */
export const MAX_PANES = 8

const view = z.object({
  sorting: z.array(z.object({ id: columnId, desc: z.boolean() })).max(COLUMN_IDS.length),

  /**
   * Filter values are strings, always, and now unavoidably: they arrive as one
   * parameter value each, and a URLSearchParams value is a string or it is
   * absent. The bound is what still earns its place, since the box itself has no
   * maxlength and a link is a thing someone else clicks.
   */
  columnFilters: z
    .array(z.object({ id: columnId, value: z.string().max(64) }))
    .max(COLUMN_IDS.length),

  /** Group By and Split By, and there is no third control to undo a third level. */
  grouping: z.array(columnId).max(2),

  /**
   * The one place a column id is not checked, because this is the one place an
   * unrecognised id cannot do anything: visibility is read per column as
   * columnVisibility[column.id] ?? true, so a key for a column that is not there
   * is never looked at. Checking it would mean a Partial record, whose values are
   * boolean | undefined and so not a VisibilityState.
   */
  columnVisibility: z.record(z.string().max(64), z.boolean()),
})

/**
 * Where a pane sits and how much of the window it has, which together are the
 * arrangement.
 *
 * A path is bounded by the pane ceiling at both ends: it cannot be deeper than
 * the number of panes there are to nest, and no split can have more children
 * than the workspace has panes. A share is a fraction of the window rather than
 * of the split above it, because that is the figure that means the same thing
 * whatever the link does with the levels in between, and it is the one a person
 * reading the URL can interpret.
 */
/** No split can have more children than the workspace has panes to put in it. */
const LAST_SLOT = MAX_PANES - 1

const step = z.int().min(0).max(LAST_SLOT)

const placed = z.object({
  at: z.array(step).min(1).max(MAX_PANES),
  share: z.number().finite().gt(0).max(1),
})

/**
 * How long a pane's name can be.
 *
 * Short enough to sit on a bar that already holds five filters and four buttons.
 * Exported so the box enforces it as it is typed, rather than the schema
 * refusing the whole link once it is too late to say anything useful about it.
 */
export const NAME_LIMIT = 24

/**
 * A pane's own name, or null for one that has none.
 *
 * Free text someone typed, so there is nothing to validate but the length. Null
 * rather than absent, because a pane with no name of its own is named by where
 * it is, and that is a fact about the pane rather than a field that is missing.
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
 * Four decimal places, which is a tenth of a pixel on a 4K screen and two
 * characters a person can read. Weights are re-derived from these and
 * renormalised, so three thirds written as `0.3333` come back as three thirds
 * rather than as a workspace a ten-thousandth short.
 */
const PLACES = 1e4

/** Near enough to even that stating the sizes would be noise. */
const ROUNDING = 1 / PLACES

/**
 * Whether this is the order a pane opens on, which a link therefore leaves
 * unsaid.
 *
 * Compared field by field rather than by identity, because the sorting a grid
 * reports back is rebuilt by the table on every change and is only ever equal to
 * the default by value.
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
 * The view of one pane, as query parameters.
 *
 * Readable on purpose, and that is a decision with a cost attached. The payload
 * used to be base64url, which was shorter and immune to hand-editing. Spelling
 * it out means a trader can read a link before clicking it, change a grouping
 * without opening the app, and see from the address bar what a colleague is
 * actually looking at.
 *
 * Lists repeat the parameter rather than joining with a separator:
 *
 *     ?panes=2&p1.group=symbol&p1.group=book&p1.sort=-quantity&p1.where.symbol=VOD
 *
 * A comma would have been shorter and would not have survived. URLSearchParams
 * serialises to application/x-www-form-urlencoded, whose safe set is
 * alphanumerics plus `*`, `-`, `.` and `_`, so a comma comes out as `%2C` and
 * the readability is gone at the first list. Repeating the key needs no
 * separator at all, so nothing in the query is escaped except the two things
 * that should be: a filter value and a pane's name, which are both free text
 * someone typed into a box. A space in either comes out as `+`, which is in the
 * safe set and reads as a space.
 *
 * `-` marks a descending sort, as it does in most APIs that take one.
 *
 * The arrangement rides along as `axis` for the root, `p{n}.at` for where each
 * pane sits and `p{n}.size` for how much of the window it has, and `p{n}.name`
 * carries a name somebody gave a pane. All four are omitted when they say
 * nothing: a stacked workspace of evenly sized panes with no names on it is what
 * a link opens on, so the common case writes none of them and the old one-axis
 * links keep meaning what they meant.
 *
 * The view is written the same way, as what the pane does differently rather
 * than as what it holds. The default view hides the trade id and orders by time,
 * so a link that stated the visibility and the sorting it was handed would carry
 * `p1.hide=tradeId&p1.sort=-tradeTimestamp` on every pane of every workspace,
 * and the one fact worth sending, that this pane is not like that, would be the
 * hardest thing in the query to see.
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

    // Only a name somebody chose. A pane without one is named by where it sits,
    // and where it sits is in the link already.
    if (leaf.name !== undefined) {
      params.set(key('name'), leaf.name)
    }
    if (nested) {
      params.set(key('at'), (paths.get(leaf.id) ?? []).join('.'))
    }
    if (!even) {
      params.set(key('size'), String(Math.round((shares.get(leaf.id) ?? 0) * PLACES) / PLACES))
    }

    // In the order the config panel lists them, so reading the URL and reading
    // the panel are the same exercise.
    for (const id of config.grouping) {
      params.append(key('group'), id)
    }
    if (!opensOnOrder(config.sorting)) {
      const tokens = config.sorting.map((sort) => `${sort.desc ? '-' : ''}${sort.id}`)
      // A `sort` with nothing after it is a pane with no order at all, which has
      // to be stated now that an absent one means the default. Clicking a header
      // until the arrow goes away is a decision as much as sorting on it is.
      for (const token of tokens.length === 0 ? [''] : tokens) {
        params.append(key('sort'), token)
      }
    }
    // One parameter per filter rather than a list of id:value pairs. A value is
    // free text, so any separator chosen for it is a separator a trader can type
    // into the box and break their own link with.
    for (const filter of config.columnFilters) {
      params.set(key(`where.${filter.id}`), String(filter.value))
    }
    // Driven by the column list rather than by the record's own keys, because
    // the two are not the same question: a record with no entry for the trade id
    // is a pane showing it, and only the list knows which columns there are to
    // have no entry for.
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
 * otherwise the highest pane any parameter mentions.
 *
 * Deriving it is most of what makes the URL worth being able to read. Appending
 * `?p1.group=symbol` to a bare address is a complete request, and the count only
 * has to be stated to ask for a pane that carries no settings of its own.
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
 * over evenly.
 *
 * So `&p1.size=0.5` on a workspace of three is a complete request: pane one
 * takes half and the other two take a quarter each. Null when the link has
 * already spent the window and still has panes to place, which is a size for a
 * pane that could only be invisible.
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

  // The accumulator is stated, because the sizes it adds up are nullable and
  // reduce would otherwise take its type from them and make the running total
  // nullable too.
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
 * of a split is the order of the indices rather than the order of the pane
 * numbers: a path says where a pane is, and the numbering is how its parameters
 * are grouped. A link whose paths disagree with its numbering therefore draws
 * the panes where the paths put them and renumbers them on the next share.
 *
 * Forgiving about two things and strict about one. Gaps in the indices are an
 * order and nothing more, so `0` and `2` are the first and the second. A level
 * holding a single slot has nothing to divide, so what it holds moves up, the
 * same way closing a pane promotes the one region its splitter has left. But a
 * pane and a split in the same slot, or two panes claiming it, is a question
 * with no answer, and the whole link is rejected rather than guessed at.
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
 * default single pane.
 *
 * A readable URL is a URL people edit, so this is reached with typos in it far
 * more often than the base64 version was. It still rejects the whole link rather
 * than dropping the part it could not read: a link that half-applies shows a
 * view nobody chose, and looks like the app losing state rather than the link
 * being wrong.
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
      // Blank is the same as absent, which is what clearing the box on screen
      // does: a name of nothing is a pane back on the name its position gives it,
      // not a pane with an empty title.
      name: name === '' ? null : name,
      // A pane with no path stated sits at the top level in its own numbered
      // slot, so appending two paths to a bare link is a complete request and
      // the unnested workspace states no paths at all.
      at: at === null ? [number - 1] : at.split('.').map(Number),
      share: size === null ? null : Number(size),
      // Absent is the order a pane opens on, not no order, which is what makes
      // appending a grouping to a bare address a complete request rather than a
      // request for an unsorted tape. A parameter with no value is the no order
      // case, and it is the only thing absence can no longer say.
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

  // Shaped by hand above, validated here. Everything the parameters could not
  // get wrong structurally they can still get wrong by name or by number, and
  // the schema is the only thing that knows which names are columns.
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

  // Cleared before it is written, and this is the part the single opaque
  // parameter got for free. Closing a pane, clearing a filter or putting the
  // panes back in a stack now has to remove a parameter, or the next read picks
  // up what the last share left.
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
