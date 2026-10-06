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

/** Everything a pane can hold. Both directions of the column toggle sit in the
 *  first pane: `book` off where the default has it on, `tradeId` on where it is
 *  off. */
const ARRANGED: PaneConfig[] = [
  {
    sorting: [{ id: 'quantity', desc: false }],
    columnFilters: [{ id: 'symbol', value: 'VOD' }],
    grouping: ['symbol', 'book'],
    columnVisibility: { book: false, tradeId: true, version: false },
    // Partial on purpose: the columns left out follow in definition order.
    columnOrder: ['status', 'symbol'],
  },
  {
    sorting: [{ id: 'symbol', desc: false }],
    columnFilters: [],
    grouping: [],
    columnVisibility: { tradeId: false, version: false },
    columnOrder: [],
  },
]

/** A pane nobody has configured. The default view, not an empty object: an empty
 *  sorting is a pane somebody unsorted and an empty visibility is every column
 *  on. */
const PLAIN: PaneConfig = DEFAULT_VIEW

/** A stacked workspace of evenly sized panes, which is what a link opens on. */
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

/** Panes named `pane-n` hold the nth view. */
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

/** The tree the link asks for, as an expression, so a shape can be asserted. */
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
    // The exact string, not a round trip: readability is the feature here.
    expect(query(ARRANGED)).toBe(
      'panes=2' +
        '&p1.group=symbol&p1.group=book' +
        '&p1.order=status&p1.order=symbol' +
        '&p1.sort=quantity' +
        '&p1.where.symbol=VOD' +
        '&p1.show=tradeId&p1.hide=book' +
        '&p2.sort=symbol',
    )
  })

  it('says nothing about the view a pane opens on, and says when it is not that', () => {
    // Worth sending is the difference from the default, which here runs the other way.
    expect(query([DEFAULT_VIEW])).toBe('panes=1')
    expect(query([{ ...PLAIN, columnVisibility: {} }])).toBe(
      'panes=1&p1.show=tradeId&p1.show=version',
    )
  })

  it('states a pane with no order at all, since absence is the default order', () => {
    // Reachable by clicking a header until the arrow goes away, so somebody chose it.
    const unsorted: PaneConfig[] = [{ ...PLAIN, sorting: [] }]

    expect(query(unsorted)).toBe('panes=1&p1.sort=')
    expect(views(query(unsorted))).toEqual(unsorted)
  })

  it('escapes nothing, because there is no separator to escape', () => {
    // Why lists repeat the key: a comma is not in the safe set and would be %2C.
    expect(query(ARRANGED)).not.toContain('%')
  })

  it('still escapes the one thing that has to be', () => {
    // A filter value is the only part not drawn from the fixed column list.
    const typed: PaneConfig[] = [{ ...PLAIN, columnFilters: [{ id: 'trader', value: 'Société' }] }]

    expect(query(typed)).toBe('panes=1&p1.where.trader=Soci%C3%A9t%C3%A9')
    expect(views(query(typed))).toEqual(typed)
  })

  it('counts a pane that has nothing to say about itself', () => {
    // A pane on the defaults writes nothing, so three would read back as one.
    expect(query([PLAIN, PLAIN, PLAIN])).toBe('panes=3')
    expect(views('panes=3')).toEqual([PLAIN, PLAIN, PLAIN])
  })
})

describe('carrying the arrangement', () => {
  const BESIDE = movedPane(stacked(3), 'pane-3', 'pane-1', 'right', 'split-2')

  it('says nothing at all about a stack of even panes', () => {
    // The arrangement a link opens on, so there is nothing to state.
    expect(query([PLAIN, PLAIN, PLAIN])).toBe('panes=3')
  })

  it('writes a path per pane once anything is nested', () => {
    // Numbered in the order they are drawn, so p2 is the pane that was moved.
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

    // Four places out and renormalised back, so 43.33% opens at 43.33%.
    expect(shares[0]).toBeCloseTo(1 / 3 + 0.1, 4)
    expect(shares[1]).toBeCloseTo(1 / 3 - 0.1, 4)
  })

  it('reconstructs the weights that produce the shares, at every depth', () => {
    // Two passes: a path places the panes, a share sizes them across levels.
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

    // A space comes out as `+`, which is in the safe set.
    expect(encodeWorkspace(named, () => PLAIN).toString()).toBe('panes=2&p1.name=EU+Flow')
  })

  it('comes back as the name it went out as', () => {
    const named = renamedPane(stacked(2), 'pane-2', 'Cancels')

    expect(decode(encodeWorkspace(named, () => PLAIN).toString())?.names).toEqual([null, 'Cancels'])
  })

  it('says nothing about a pane nobody has named', () => {
    // A name a pane gets from its position is not a decision anybody made.
    expect(query([PLAIN, PLAIN, PLAIN])).toBe('panes=3')
    expect(decode('panes=3')?.names).toEqual([null, null, null])
  })

  it('reads a name somebody typed straight into the address bar', () => {
    expect(decode('p1.name=EU Flow')?.names).toEqual(['EU Flow'])
  })

  it('takes a blank name as no name at all', () => {
    // Which is what clearing the box does, so the two routes agree.
    expect(decode('panes=2&p1.name=&p2.name=%20')?.names).toEqual([null, null])
  })
})

describe('reading a link somebody typed', () => {
  it('needs nothing but the setting that is wanted', () => {
    // One parameter on a bare address is a complete request: no count to work out.
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
    // The default has columns off, so hiding and showing are different requests.
    expect(views('p1.hide=book&p1.show=tradeId')?.[0]?.columnVisibility).toEqual({
      book: false,
      tradeId: true,
      version: false,
    })
  })

  it('reads a column order, and takes an absent one as the order a pane opens on', () => {
    expect(views('p1.order=status&p1.order=side')?.[0]?.columnOrder).toEqual(['status', 'side'])
    expect(views('p1.hide=book')?.[0]?.columnOrder).toEqual([])
  })

  it('hides a column off the default view rather than off nothing', () => {
    // Turning one column off is not turning every other on: the trade id stays off.
    expect(views('p1.hide=book')?.[0]?.columnVisibility).toEqual({
      book: false,
      tradeId: false,
      version: false,
    })
  })

  it('takes a link that states the default, and stops stating it on the next share', () => {
    // Hand-edited links say more than Share would, and both have to mean the same.
    const stated = views('panes=1&p1.sort=-tradeTimestamp&p1.hide=tradeId') ?? never()

    expect(stated).toEqual([DEFAULT_VIEW])
    expect(query(stated)).toBe('panes=1')
  })

  it('takes two paths as a complete request for a nested workspace', () => {
    // The pane with no path sits at the top level in its own numbered slot.
    expect(shape(decode('panes=3&p1.at=0.0&p2.at=0.1') ?? never())).toBe('rows(columns(p1 p2) p3)')
  })

  it('gives one pane the size it asks for and divides the rest evenly', () => {
    expect(decode('panes=3&p1.size=0.5')?.shares).toEqual([0.5, 0.25, 0.25])
  })

  it('reads a gap in the indices as an order and nothing more', () => {
    // 0 and 5 say the same thing about which pane comes first as 0 and 1 do.
    expect(shape(decode('panes=2&p1.at=0&p2.at=5') ?? never())).toBe('rows(p1 p2)')
  })

  it('promotes a level that holds every pane, because it divides nothing', () => {
    // A splitter with one region on it is not a splitter.
    expect(shape(decode('panes=2&p1.at=0.0&p2.at=0.1') ?? never())).toBe('rows(p1 p2)')
  })
})

describe('decoding something that is not a workspace', () => {
  /** A readable URL is a URL people edit, and all of these have to leave the
   *  blotter working rather than put arbitrary names into table state. */
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
    ['an order naming a column that does not exist', 'panes=1&p1.order=pnl'],
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
    // The stated count is the number a loop runs to, so it is checked first.
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

    // The link handed over and the address bar have to be the same thing.
    expect(url).toBe(window.location.href)
    expect(readWorkspace(window.location.search)?.views).toEqual(ARRANGED)
  })

  it('clears what the last share left behind', () => {
    // Or the next read reassembles a workspace nobody is looking at.
    const sideways = movedPane(stacked(2), 'pane-2', 'pane-1', 'right', 'split-2')
    workspaceUrl(sideways, viewer(ARRANGED))
    workspaceUrl(stacked(1), () => PLAIN)

    expect(window.location.search).toBe('?panes=1')
    expect(readWorkspace(window.location.search)?.views).toEqual([PLAIN])
  })

  it('leaves parameters it does not own alone', () => {
    // Shared links get forwarded with tracking parameters stapled on.
    window.history.replaceState(null, '', '/?utm_source=mail&panes=4')
    workspaceUrl(stacked(1), () => PLAIN)

    expect(window.location.search).toBe('?utm_source=mail&panes=1')
  })
})

describe('the shareable column list', () => {
  it('names every column the grid has', () => {
    // The schema duplicates the column ids on purpose: one reading its values out
    // of what it validates would accept anything. This is what stops the drift.
    const defs = createColumns() as unknown as { id?: string; accessorKey?: string }[]
    const ids = defs.map((def) => def.id ?? def.accessorKey)

    expect([...SHAREABLE_COLUMNS].sort()).toEqual([...ids].sort())
  })
})

/** For the cases where a null link is the failure rather than a fallback. */
function never(): never {
  throw new Error('the link did not parse')
}
