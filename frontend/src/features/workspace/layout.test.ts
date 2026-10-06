import { describe, expect, it } from 'vitest'
import type { Leaf, Orientation, Region, Split } from './layout.js'
import {
  EDGES,
  evenWeights,
  MIN_WEIGHT,
  movedPane,
  normalised,
  panesOf,
  pathsOf,
  placementFor,
  regionOf,
  renamedPane,
  resized,
  resizedSplit,
  sharesOf,
  splitOf,
  withDuplicate,
  withoutPane,
  withPane,
  withPaneAtEnd,
  withShares,
} from './layout.js'

const pane = (id: string, weight = 1): Leaf => ({ kind: 'pane', id, weight })

const split = (id: string, axis: Orientation, children: Region[], weight = 1): Split => ({
  kind: 'split',
  id,
  axis,
  weight,
  children,
})

/** The tree as an expression, because these assertions are about shape. */
function shape(region: Region): string {
  if (region.kind === 'pane') {
    return region.id
  }
  return `${region.axis}(${region.children.map(shape).join(' ')})`
}

/** Each pane's share of the window, rounded so a third reads as a third. */
function shares(region: Region): Record<string, number> {
  return Object.fromEntries(
    [...sharesOf(region)].map(([id, share]) => [id, Math.round(share * 1e4) / 1e4]),
  )
}

const THIRD = 0.3333
const SIXTH = 0.1667

const STACK = split('s1', 'rows', [pane('a', 1 / 3), pane('b', 1 / 3), pane('c', 1 / 3)])

describe('what an edge means', () => {
  it('turns a drop into an axis and a side', () => {
    expect(placementFor('top')).toEqual({ orientation: 'rows', before: true })
    expect(placementFor('right')).toEqual({ orientation: 'columns', before: false })
  })

  it('tiles the pane with four of them', () => {
    expect([...EDGES].sort()).toEqual(['bottom', 'left', 'right', 'top'])
  })
})

describe('shares', () => {
  it('multiplies down the tree, which is the only comparable form', () => {
    const nested = split('s1', 'rows', [
      split('s2', 'columns', [pane('a', 0.5), pane('b', 0.5)], 0.5),
      pane('c', 0.5),
    ])

    // a is half of a half: weight 0.5, a quarter of the window.
    expect(shares(nested)).toEqual({ a: 0.25, b: 0.25, c: 0.5 })
  })

  it('evens out and renormalises', () => {
    expect(evenWeights(4)).toEqual([0.25, 0.25, 0.25, 0.25])
    expect(normalised([2, 2])).toEqual([0.5, 0.5])
    expect(normalised([0, 0])).toEqual([0.5, 0.5])
  })
})

describe('moving a boundary', () => {
  it('takes from one side and gives to the other', () => {
    expect(resized([0.5, 0.5], 0, 0.2)).toEqual([0.7, 0.3])
  })

  it('stops at the floor rather than pushing the far side under it', () => {
    const [before, after] = resized([0.5, 0.5], 0, 1)

    expect(after).toBeCloseTo(MIN_WEIGHT, 10)
    expect((before ?? 0) + (after ?? 0)).toBeCloseTo(1, 10)
  })

  it('finds the split by its id, however deep it is', () => {
    const nested = split('s1', 'rows', [
      split('s2', 'columns', [pane('a', 0.5), pane('b', 0.5)], 0.5),
      pane('c', 0.5),
    ])

    // Only the inner boundary moves: a separator names its split, not an index.
    expect(shares(resizedSplit(nested, 's2', 0, 0.2))).toEqual({ a: 0.35, b: 0.15, c: 0.5 })
    expect(shares(resizedSplit(nested, 's1', 0, 0.2))).toEqual({ a: 0.35, b: 0.35, c: 0.3 })
  })
})

describe('standing one pane beside another', () => {
  it('splits that pane’s slot and leaves the rest stacked', () => {
    const next = movedPane(STACK, 'c', 'a', 'right', 's2')

    // Splitting a pane's slot must not turn its siblings sideways with it.
    expect(shape(next)).toBe('rows(columns(a c) b)')
  })

  it('changes where the panes are and not how big they are', () => {
    const next = movedPane(STACK, 'c', 'a', 'right', 's2')

    // A removal renormalises the old neighbours and an insertion halves the new
    // one, so without restating the shares all three would change size.
    expect(shares(next)).toEqual({ a: THIRD, b: THIRD, c: THIRD })
    expect(sharesOf(next).get('b')).toBeCloseTo(1 / 3, 10)
  })

  it('joins the split it is already on rather than nesting inside it', () => {
    const next = movedPane(STACK, 'a', 'c', 'bottom', 's2')

    // Both ask for rows and the split is rows, so one boundary, not two.
    expect(shape(next)).toBe('rows(b c a)')
    expect(shares(next)).toEqual({ a: THIRD, b: THIRD, c: THIRD })
  })

  it('splits the whole window when there is nothing else in it', () => {
    const two = split('s1', 'rows', [pane('a', 0.5), pane('b', 0.5)])
    const next = movedPane(two, 'b', 'a', 'left', 's2')

    expect(shape(next)).toBe('columns(b a)')
    expect(shares(next)).toEqual({ a: 0.5, b: 0.5 })
  })

  it('nests two deep, and the root axis follows what is left', () => {
    const beside = movedPane(STACK, 'c', 'a', 'right', 's2')
    const next = movedPane(beside, 'b', 'c', 'bottom', 's3')

    // b leaves the outer split holding one child, so the columns split is
    // promoted to the root and c's slot divides to take b.
    expect(shape(next)).toBe('columns(a rows(c b))')
    expect(shares(next)).toEqual({ a: THIRD, b: THIRD, c: THIRD })
  })

  it('does nothing when the pane is already against that boundary', () => {
    // Returned as-is rather than rebuilt to the same shape: a rebuild mints a new
    // split id, which is a React key, so both panes would remount.
    expect(movedPane(STACK, 'b', 'a', 'bottom', 's2')).toBe(STACK)
    expect(movedPane(STACK, 'b', 'c', 'top', 's2')).toBe(STACK)
    expect(movedPane(STACK, 'a', 'a', 'right', 's2')).toBe(STACK)
  })

  it('does nothing with a pane that is not there', () => {
    expect(movedPane(STACK, 'zz', 'a', 'top', 's2')).toBe(STACK)
    expect(movedPane(STACK, 'a', 'zz', 'top', 's2')).toBe(STACK)
  })
})

describe('opening a pane', () => {
  it('puts the duplicate after its source, on its source’s own axis', () => {
    const next = withDuplicate(STACK, 'b', pane('d'), 's2')

    expect(shape(next)).toBe('rows(a b d c)')
    // Out of its source, not out of everyone, so hand-sized panes keep their size.
    expect(shares(next)).toEqual({ a: THIRD, b: SIXTH, d: SIXTH, c: THIRD })
  })

  it('stacks the duplicate of the only pane', () => {
    expect(shape(withDuplicate(pane('a'), 'a', pane('b'), 's1'))).toBe('rows(a b)')
  })

  it('puts one opened from nothing in particular at the end, on the axis there is', () => {
    const beside = movedPane(STACK, 'c', 'a', 'right', 's2')

    // The end of the workspace, not of whichever slot happens to be last.
    expect(shape(withPaneAtEnd(STACK, pane('d'), 's9'))).toBe('rows(a b c d)')
    expect(shape(withPaneAtEnd(beside, pane('d'), 's9'))).toBe('rows(columns(a c) b d)')
  })

  it('takes its half out of the end rather than out of everyone', () => {
    const next = withPaneAtEnd(STACK, pane('d'), 's9')

    expect(shares(next)).toEqual({ a: THIRD, b: THIRD, c: SIXTH, d: SIXTH })
  })

  it('stacks one opened on a workspace that is still a single pane', () => {
    // Nothing to join, so the window divides for the first time, as rows.
    expect(shape(withPaneAtEnd(pane('a'), pane('b'), 's1'))).toBe('rows(a b)')
  })

  it('evens the split out rather than halving under the floor', () => {
    // Five even panes, so halving one would hide it and its duplicate.
    const five = split(
      's1',
      'rows',
      ['a', 'b', 'c', 'd', 'e'].map((id) => pane(id, 0.2)),
    )
    const next = withPane(five, pane('f'), 'a', 'bottom', 's2')

    expect(shape(next)).toBe('rows(a f b c d e)')
    for (const share of Object.values(shares(next))) {
      expect(share).toBeGreaterThanOrEqual(MIN_WEIGHT)
    }
  })
})

describe('closing a pane', () => {
  it('gives the space back in proportion', () => {
    const uneven = split('s1', 'rows', [pane('a', 0.25), pane('b', 0.25), pane('c', 0.5)])

    expect(shares(withoutPane(uneven, 'b') ?? pane('gone'))).toEqual({ a: THIRD, c: 0.6667 })
  })

  it('promotes the one child a split has left, with the share the split held', () => {
    const nested = split('s1', 'rows', [
      split('s2', 'columns', [pane('a', 0.5), pane('b', 0.5)], 0.4),
      pane('c', 0.6),
    ])
    const next = withoutPane(nested, 'a')

    // s2 is not a split of one thing, so b takes its place and its 0.4.
    expect(shape(next ?? pane('gone'))).toBe('rows(b c)')
    expect(shares(next ?? pane('gone'))).toEqual({ b: 0.4, c: 0.6 })
  })

  it('flattens a split that promotion put inside its own axis', () => {
    const nested = split('s1', 'rows', [
      split(
        's2',
        'columns',
        [pane('a', 0.5), split('s3', 'rows', [pane('b', 0.5), pane('c', 0.5)], 0.5)],
        0.5,
      ),
      pane('d', 0.5),
    ])
    const next = withoutPane(nested, 'a')

    // Removing a promotes s3 into s1's axis: two separators for one boundary.
    expect(shape(next ?? pane('gone'))).toBe('rows(b c d)')
    expect(shares(next ?? pane('gone'))).toEqual({ b: 0.25, c: 0.25, d: 0.5 })
  })

  it('is null for the last one, which is what makes the first pane permanent', () => {
    expect(withoutPane(pane('a'), 'a')).toBeNull()
  })

  it('leaves a pane that is not there alone', () => {
    expect(shape(withoutPane(STACK, 'zz') ?? pane('gone'))).toBe('rows(a b c)')
  })
})

describe('naming a pane', () => {
  it('names the one pane, and resizes nothing', () => {
    const named = renamedPane(STACK, 'b', 'EU Flow')

    expect(panesOf(named).map((pane) => pane.name)).toEqual([undefined, 'EU Flow', undefined])
    expect(shares(named)).toEqual({ a: THIRD, b: THIRD, c: THIRD })
  })

  it('carries the name with the pane when it moves', () => {
    // Why a name is a field on the leaf: a move rebuilds the pane two levels away.
    const moved = movedPane(renamedPane(STACK, 'c', 'EU Flow'), 'c', 'a', 'right', 's2')

    expect(shape(moved)).toBe('rows(columns(a c) b)')
    expect(panesOf(moved).find((pane) => pane.id === 'c')?.name).toBe('EU Flow')
  })

  it('takes the name off again, rather than setting an empty one', () => {
    const cleared = renamedPane(renamedPane(STACK, 'b', 'EU Flow'), 'b', '')

    // Absent, not empty: a link leaves out a name nobody chose.
    expect(Object.keys(panesOf(cleared)[1] ?? {})).not.toContain('name')
  })

  it('leaves a pane that is not there alone', () => {
    expect(renamedPane(STACK, 'zz', 'EU Flow')).toEqual(STACK)
  })
})

describe('the form an arrangement travels in', () => {
  const BESIDE = movedPane(STACK, 'c', 'a', 'right', 's2')

  it('states each pane as the child index at every level down to it', () => {
    // What a link carries: a split id means nothing to whoever opens it.
    expect(Object.fromEntries(pathsOf(BESIDE))).toEqual({ a: [0, 0], c: [0, 1], b: [1] })
    expect(Object.fromEntries(pathsOf(pane('a')))).toEqual({ a: [] })
  })

  it('rebuilds the tree from the paths, alternating the axis with the depth', () => {
    let splits = 0
    const rebuilt = regionOf(
      [[0, 1], 2],
      'rows',
      (index) => pane(['a', 'c', 'b'][index] ?? 'missing'),
      () => {
        splits += 1
        return `s${splits}`
      },
    )

    // Only the root axis is stated: no split holds a split on its own axis.
    expect(shape(rebuilt)).toBe(shape(BESIDE))
  })

  it('restates the shares a link carries as the weights that produce them', () => {
    // A weight means something only beside its siblings, so a link states shares.
    const sized = withShares(
      regionOf(
        [[0, 1], 2],
        'rows',
        (index) => pane(['a', 'c', 'b'][index] ?? 'missing'),
        () => 's1',
      ),
      new Map([
        ['a', 0.1],
        ['c', 0.3],
        ['b', 0.6],
      ]),
    )

    expect(shares(sized)).toEqual({ a: 0.1, c: 0.3, b: 0.6 })
    // Within the split, which holds four tenths of the window, a is a quarter.
    expect(splitOf(sized, 'a')?.children[0]?.weight).toBeCloseTo(0.25, 10)
  })
})

describe('reading the tree', () => {
  it('lists the panes in the order they are drawn', () => {
    const next = movedPane(STACK, 'c', 'a', 'right', 's2')

    expect(panesOf(next).map((leaf) => leaf.id)).toEqual(['a', 'c', 'b'])
  })

  it('names the split a region sits in, and nothing for the root', () => {
    const next = movedPane(STACK, 'c', 'a', 'right', 's2')

    expect(splitOf(next, 'a')?.axis).toBe('columns')
    expect(splitOf(next, 'b')?.axis).toBe('rows')
    expect(splitOf(pane('a'), 'a')).toBeNull()
  })
})
