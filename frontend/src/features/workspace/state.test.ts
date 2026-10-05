import { describe, expect, it } from 'vitest'
import { createColumns } from '../blotter/columns.js'
import type { Leaf, Region } from './layout.js'
import { movedPane, regionOf, renamedPane, resizedSplit, sharesOf, withShares } from './layout.js'
import type { PaneConfig } from './paneConfig.js'
import { DEFAULT_VIEW } from './paneConfig.js'
import type { WorkspaceLink } from './state.js'
import {
  decodeWorkspace,
  encodeWorkspace,
  readWorkspace,
  SHAREABLE_COLUMNS,
  workspaceUrl,
} from './state.js'

/**
 * Everything a pane can hold, so the round trip has something to lose. Both
 * directions of the column toggle are in the first pane on purpose: `book` off
 * where the default has it on, and `tradeId` on where the default has it off.
 */
const ARRANGED: PaneConfig[] = [
  {
    sorting: [{ id: 'quantity', desc: false }],
    columnFilters: [{ id: 'symbol', value: 'VOD' }],
    grouping: ['symbol', 'book'],
    columnVisibility: { book: false, tradeId: true },
  },
  {
    sorting: [{ id: 'symbol', desc: false }],
    columnFilters: [],
    grouping: [],
    columnVisibility: { tradeId: false },
  },
]

/**
 * A pane nobody has configured, for the cases about panes that write no
 * parameters.
 *
 * The view one opens on rather than an empty object, because that is what
 * writing nothing now means: an empty sorting is a pane somebody unsorted and a
 * visibility of nothing is every column on, and both of those are decisions a
 * link has to carry.
 */
const PLAIN: PaneConfig = DEFAULT_VIEW

/**
 * A stacked workspace of evenly sized panes, which is what a link opens on and
 * what every case about the view rather than the arrangement starts from.
 */
function stacked(count: number): Region {
  const panes: Leaf[] = Array.from({ length: count }, (_, index) => ({
    kind: 'pane',
    id: `pane-${index + 1}`,
    weight: 1 / count,
  }))
  const only = panes[0]
  if (only === undefined) {
    throw new Error('a workspace has at least one pane')
  }
  return count === 1
    ? only
    : { kind: 'split', id: 'split-1', axis: 'rows', weight: 1, children: panes }
}

/** Panes named `pane-n` hold the nth view, which is how the fixtures line up with
 *  the trees built out of them. */
const viewer =
  (views: readonly PaneConfig[]) =>
  (id: string): PaneConfig =>
    views[Number(id.slice('pane-'.length)) - 1] ?? PLAIN

const query = (views: readonly PaneConfig[]): string =>
  encodeWorkspace(stacked(views.length), viewer(views)).toString()

const decode = (search: string): WorkspaceLink | null =>
  decodeWorkspace(new URLSearchParams(search))

/** Just the views, for the cases that are not about where the panes are. */
const views = (search: string): PaneConfig[] | null => decode(search)?.views ?? null

/** The tree the link asks for, as an expression, so an arrangement can be
 *  asserted as the shape it draws rather than as a nest of object literals. */
function shape(link: WorkspaceLink): string {
  let next = 0
  const region = regionOf(
    link.arrangement,
    link.axis,
    (index) => ({ kind: 'pane', id: `p${index + 1}`, weight: 1 }),
    () => {
      next += 1
      return `s${next}`
    },
  )
  const written = (region: Region): string =>
    region.kind === 'pane' ? region.id : `${region.axis}(${region.children.map(written).join(' ')})`
  return written(region)
}

describe('encoding a workspace', () => {
  it('comes back the same', () => {
    expect(views(query(ARRANGED))).toEqual(ARRANGED)
  })

  it('spells the view out, which is the whole point of the format', () => {
    // Asserted as the exact string rather than by parsing it back, because the
    // readability is the feature and a round-trip test would pass just as well
    // on an opaque blob.
    expect(query(ARRANGED)).toBe(
      'panes=2' +
        '&p1.group=symbol&p1.group=book' +
        '&p1.sort=quantity' +
        '&p1.where.symbol=VOD' +
        '&p1.show=tradeId&p1.hide=book' +
        '&p2.sort=symbol',
    )
  })

  it('says nothing about the view a pane opens on, and says when it is not that', () => {
    // The complaint this answers: the default view hides the trade id, so every
    // link carried p1.hide=tradeId and stated the obvious once per pane. What is
    // worth sending is the difference, and in this case the difference is the
    // other way round.
    expect(query([DEFAULT_VIEW])).toBe('panes=1')
    expect(query([{ ...PLAIN, columnVisibility: {} }])).toBe('panes=1&p1.show=tradeId')
  })

  it('states a pane with no order at all, since absence is the default order', () => {
    // Reachable by clicking a header until the arrow goes away, so it is a view
    // somebody chose and the one thing an omitted sort can no longer mean.
    const unsorted: PaneConfig[] = [{ ...PLAIN, sorting: [] }]

    expect(query(unsorted)).toBe('panes=1&p1.sort=')
    expect(views(query(unsorted))).toEqual(unsorted)
  })

  it('escapes nothing, because there is no separator to escape', () => {
    // The reason lists repeat the key instead of joining on a comma: a comma is
    // not in the form-urlencoded safe set, so one list would have put %2C in the
    // address bar and taken the readability with it.
    expect(query(ARRANGED)).not.toContain('%')
  })

  it('still escapes the one thing that has to be', () => {
    // A filter value is free text someone typed. It is the only part of the
    // query that is not drawn from a fixed list of column ids, so it is the only
    // part that can need escaping, and it round trips.
    const typed: PaneConfig[] = [{ ...PLAIN, columnFilters: [{ id: 'trader', value: 'Société' }] }]

    expect(query(typed)).toBe('panes=1&p1.where.trader=Soci%C3%A9t%C3%A9')
    expect(views(query(typed))).toEqual(typed)
  })

  it('counts a pane that has nothing to say about itself', () => {
    // A pane on the defaults writes no parameters of its own, so without the
    // count a workspace of three would read back as one.
    expect(query([PLAIN, PLAIN, PLAIN])).toBe('panes=3')
    expect(views('panes=3')).toEqual([PLAIN, PLAIN, PLAIN])
  })
})

describe('carrying the arrangement', () => {
  /** Three stacked panes with one stood beside another, which is the arrangement
   *  the whole tree exists for. */
  const BESIDE = movedPane(stacked(3), 'pane-3', 'pane-1', 'right', 'split-2')

  it('says nothing at all about a stack of even panes', () => {
    // The arrangement a link opens on, so stating it would be three paths that
    // each repeat the pane's own number and three sizes that are all a third.
    expect(query([PLAIN, PLAIN, PLAIN])).toBe('panes=3')
  })

  it('writes a path per pane once anything is nested', () => {
    // Numbered in the order they are drawn, so p2 is the pane that was moved and
    // sits beside p1, and p3 is the pane that stayed where it was.
    expect(encodeWorkspace(BESIDE, () => PLAIN).toString()).toBe(
      'panes=3&p1.at=0.0&p2.at=0.1&p3.at=1',
    )
  })

  it('comes back as the tree it was written from', () => {
    const written = encodeWorkspace(BESIDE, () => PLAIN).toString()

    expect(shape(decode(written) ?? never())).toBe('rows(columns(p1 p2) p3)')
  })

  it('states the root axis only when it is not a stack', () => {
    const sideways = movedPane(stacked(2), 'pane-2', 'pane-1', 'right', 'split-2')

    expect(encodeWorkspace(sideways, () => PLAIN).toString()).toBe('panes=2&axis=columns')
    expect(decode('panes=2&axis=columns')?.axis).toBe('columns')
    expect(decode('panes=2')?.axis).toBe('rows')
  })

  it('writes a size per pane once a splitter has been moved', () => {
    const dragged = resizedSplit(stacked(3), 'split-1', 0, 0.1)

    expect(encodeWorkspace(dragged, () => PLAIN).toString()).toBe(
      'panes=3&p1.size=0.4333&p2.size=0.2333&p3.size=0.3333',
    )
  })

  it('keeps the sizes it was given, to within the places it writes', () => {
    const dragged = resizedSplit(stacked(3), 'split-1', 0, 0.1)
    const { shares } = decode(encodeWorkspace(dragged, () => PLAIN).toString()) ?? never()

    // Four places on the way out and renormalised on the way back, so a pane
    // dragged to 43.33% of the window opens at 43.33% of it.
    expect(shares[0]).toBeCloseTo(1 / 3 + 0.1, 4)
    expect(shares[1]).toBeCloseTo(1 / 3 - 0.1, 4)
  })

  it('reconstructs the weights that produce the shares, at every depth', () => {
    // The two-pass reconstruction, end to end: a path puts the panes where the
    // link says and a share says how big, and a share is the only one of the two
    // numbers that means anything across a level.
    const link =
      decode('panes=3&p1.at=0.0&p2.at=0.1&p3.at=1&p1.size=0.1&p2.size=0.3&p3.size=0.6') ?? never()
    const panes: Leaf[] = ['a', 'b', 'c'].map((id) => ({ kind: 'pane', id, weight: 1 }))
    const region = withShares(
      regionOf(
        link.arrangement,
        link.axis,
        (index) => panes[index] ?? never(),
        () => 'split-9',
      ),
      new Map(panes.map((pane, index) => [pane.id, link.shares[index] ?? never()])),
    )
    const shares = sharesOf(region)

    expect(shares.get('a')).toBeCloseTo(0.1, 10)
    expect(shares.get('b')).toBeCloseTo(0.3, 10)
    expect(shares.get('c')).toBeCloseTo(0.6, 10)
  })
})

describe('carrying a name', () => {
  it('writes the name of a pane that has one, and nothing for the rest', () => {
    const named = renamedPane(stacked(2), 'pane-1', 'EU Flow')

    // A space comes out as `+`, which is in the safe set, so a name is as
    // readable in the address bar as it is on the bar it came off.
    expect(encodeWorkspace(named, () => PLAIN).toString()).toBe('panes=2&p1.name=EU+Flow')
  })

  it('comes back as the name it went out as', () => {
    const named = renamedPane(stacked(2), 'pane-2', 'Cancels')

    expect(decode(encodeWorkspace(named, () => PLAIN).toString())?.names).toEqual([null, 'Cancels'])
  })

  it('says nothing about a pane nobody has named', () => {
    // A name a pane gets from its position is not a decision anybody made, and
    // a link that stated it would be stating the pane's own number back.
    expect(query([PLAIN, PLAIN, PLAIN])).toBe('panes=3')
    expect(decode('panes=3')?.names).toEqual([null, null, null])
  })

  it('reads a name somebody typed straight into the address bar', () => {
    expect(decode('p1.name=EU Flow')?.names).toEqual(['EU Flow'])
  })

  it('takes a blank name as no name at all', () => {
    // Which is what clearing the box on screen does, so the two routes to an
    // unnamed pane agree.
    expect(decode('panes=2&p1.name=&p2.name=%20')?.names).toEqual([null, null])
  })
})

describe('reading a link somebody typed', () => {
  it('needs nothing but the setting that is wanted', () => {
    // The case the format exists for. Appending one parameter to a bare address
    // is a complete request, with no count to work out and no payload to mint.
    expect(views('p1.group=symbol')).toEqual([{ ...PLAIN, grouping: ['symbol'] }])
  })

  it('takes the stated count over the panes it can see', () => {
    const panes = views('panes=3&p1.group=symbol')

    expect(panes).toHaveLength(3)
    expect(panes?.[0]?.grouping).toEqual(['symbol'])
    expect(panes?.[2]).toEqual(PLAIN)
  })

  it('works out the count from the highest pane mentioned', () => {
    expect(views('p2.sort=-quantity')).toHaveLength(2)
  })

  it('reads a descending sort off the leading dash', () => {
    expect(views('p1.sort=-price&p1.sort=symbol')?.[0]?.sorting).toEqual([
      { id: 'price', desc: true },
      { id: 'symbol', desc: false },
    ])
  })

  it('reads a column turned on and a column turned off', () => {
    // Both directions are needed, because the default view has columns off:
    // hiding and un-hiding are not the same request with a different sign.
    expect(views('p1.hide=book&p1.show=tradeId')?.[0]?.columnVisibility).toEqual({
      book: false,
      tradeId: true,
    })
  })

  it('hides a column off the default view rather than off nothing', () => {
    // The other half of writing only the difference. A link that turns one
    // column off is not a link that turns every other column on, so the trade id
    // stays where the default put it.
    expect(views('p1.hide=book')?.[0]?.columnVisibility).toEqual({
      book: false,
      tradeId: false,
    })
  })

  it('takes a link that states the default, and stops stating it on the next share', () => {
    // Hand-edited links say more than Share would, and the two have to mean the
    // same thing. Reading one and writing it back is how the format stays
    // canonical without rejecting anything over it.
    const stated = views('panes=1&p1.sort=-tradeTimestamp&p1.hide=tradeId') ?? never()

    expect(stated).toEqual([DEFAULT_VIEW])
    expect(query(stated)).toBe('panes=1')
  })

  it('takes two paths as a complete request for a nested workspace', () => {
    // The pane that was not given a path sits at the top level in its own
    // numbered slot, so two paths are enough to ask for one pane beside another
    // with the third left where it was.
    expect(shape(decode('panes=3&p1.at=0.0&p2.at=0.1') ?? never())).toBe('rows(columns(p1 p2) p3)')
  })

  it('gives one pane the size it asks for and divides the rest evenly', () => {
    expect(decode('panes=3&p1.size=0.5')?.shares).toEqual([0.5, 0.25, 0.25])
  })

  it('reads a gap in the indices as an order and nothing more', () => {
    // Hand-editing a path means picking numbers, and 0 and 5 say the same thing
    // about which pane comes first as 0 and 1 do.
    expect(shape(decode('panes=2&p1.at=0&p2.at=5') ?? never())).toBe('rows(p1 p2)')
  })

  it('promotes a level that holds every pane, because it divides nothing', () => {
    // A splitter with one region on it is not a splitter, which is the same rule
    // that applies when a pane is closed.
    expect(shape(decode('panes=2&p1.at=0.0&p2.at=0.1') ?? never())).toBe('rows(p1 p2)')
  })
})

describe('decoding something that is not a workspace', () => {
  /**
   * A readable URL is a URL people edit, so these are reached far more often
   * than the base64 payload's were. All of them have to leave the blotter
   * working rather than put arbitrary names into table state.
   */
  it.each([
    ['nothing to do with a workspace', '?symbol=VOD'],
    ['an empty query string', ''],
    ['an empty workspace', 'panes=0'],
    ['more panes than a link should ask for', 'panes=9'],
    ['a count that is not a number', 'panes=lots'],
    ['a count that is not whole', 'panes=1.5'],
    ['a pane numbered past the ceiling', 'p9.group=symbol'],
    ['a column that does not exist', 'panes=1&p1.group=pnl'],
    ['a sort on a column that does not exist', 'panes=1&p1.sort=-pnl'],
    ['a filter on a column that does not exist', 'panes=1&p1.where.pnl=100'],
    ['a dash with no column after it', 'panes=1&p1.sort=-'],
    ['a third grouping level', 'p1.group=symbol&p1.group=book&p1.group=trader'],
    ['a filter value longer than the box could hold', `p1.where.trader=${'k'.repeat(65)}`],
    ['a name longer than the bar could hold', `p1.name=${'k'.repeat(25)}`],
    ['an axis that is neither', 'panes=2&axis=sideways'],
    ['a path that is not a path', 'panes=2&p1.at=here&p2.at=1'],
    ['a path deeper than there are panes to nest', `panes=2&p1.at=${'0.'.repeat(8)}0&p2.at=1`],
    ['a slot further along than a split could reach', 'panes=2&p1.at=0&p2.at=9'],
    ['two panes claiming the same slot', 'panes=2&p1.at=0&p2.at=0'],
    ['a pane and a split in the same slot', 'panes=2&p1.at=0&p2.at=0.1'],
    ['a size that is not a number', 'panes=2&p1.size=some'],
    ['a pane with none of the window', 'panes=2&p1.size=0'],
    ['a pane with more than the window', 'panes=1&p1.size=1.5'],
    ['the whole window spent before every pane is placed', 'panes=2&p1.size=1'],
  ])('rejects %s', (_case, search) => {
    expect(decode(search)).toBeNull()
  })

  it('refuses a huge count without building it first', () => {
    // The stated count is the number a loop runs to, so the ceiling is checked
    // before the loop rather than by the schema afterwards.
    expect(decode('panes=100000')).toBeNull()
  })
})

describe('the address bar', () => {
  it('reads a workspace out of the query string, and nothing out of an empty one', () => {
    expect(readWorkspace(`?${query(ARRANGED)}`)?.views).toEqual(ARRANGED)
    expect(readWorkspace('')).toBeNull()
    expect(readWorkspace('?symbol=VOD')).toBeNull()
  })

  it('writes the link it returns', () => {
    const url = workspaceUrl(stacked(2), viewer(ARRANGED))

    // The link handed over and the address bar have to be the same thing, or a
    // trader copies one and sends the other.
    expect(url).toBe(window.location.href)
    expect(readWorkspace(window.location.search)?.views).toEqual(ARRANGED)
  })

  it('clears what the last share left behind', () => {
    // The failure mode the single opaque parameter did not have. Sharing a
    // smaller workspace, or putting the panes back in a stack, has to remove the
    // parameters that went away, or the next read reassembles a workspace nobody
    // is looking at.
    const sideways = movedPane(stacked(2), 'pane-2', 'pane-1', 'right', 'split-2')
    workspaceUrl(sideways, viewer(ARRANGED))
    workspaceUrl(stacked(1), () => PLAIN)

    expect(window.location.search).toBe('?panes=1')
    expect(readWorkspace(window.location.search)?.views).toEqual([PLAIN])
  })

  it('leaves parameters it does not own alone', () => {
    // Shared links get forwarded with tracking parameters stapled on, and the
    // blotter has no business dropping them.
    window.history.replaceState(null, '', '/?utm_source=mail&panes=4')
    workspaceUrl(stacked(1), () => PLAIN)

    expect(window.location.search).toBe('?utm_source=mail&panes=1')
  })
})

describe('the shareable column list', () => {
  it('names every column the grid has', () => {
    // The schema duplicates the column ids on purpose, because a schema that
    // read its valid values out of the thing it validates would accept anything.
    // This is what stops the copy drifting: add a column and forget it here, and
    // it silently stops surviving a shared link.
    const defs = createColumns() as unknown as { id?: string; accessorKey?: string }[]
    const ids = defs.map((def) => def.id ?? def.accessorKey)

    expect([...SHAREABLE_COLUMNS].sort()).toEqual([...ids].sort())
  })
})

/** For the cases where a null link is the failure, so the assertion that follows
 *  reads as the thing being tested rather than as a fallback. */
function never(): never {
  throw new Error('the link did not parse')
}
