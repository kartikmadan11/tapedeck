/**
 * How the panes of a workspace are arranged: a tree of splits, each dividing its own
 * share of the screen along one axis, so a drop beside one pane moves nothing outside
 * that pane's slot. Weights, not pixels: a region is a flex item with flex-basis 0 and
 * flex-grow of its weight, and because a weight means something only beside its
 * siblings, the children of every split sum to one and every operation that changes
 * the set of them renormalises.
 *
 * Two invariants, held by every operation here: a split has at least two children, and
 * no split holds a child split on its own axis. The second makes the axes alternate
 * with depth, so a link states the root axis alone.
 */

/** Stacked, or side by side. Each split has its own. */
export type Orientation = 'rows' | 'columns'

/** The edge of a pane that another pane can be dropped on. */
export type Edge = 'top' | 'bottom' | 'left' | 'right'

/** One blotter, holding its share of the split it sits in. The name is on the leaf, so
 *  it follows its pane through the moves and promotions that rebuild one; absent means
 *  unnamed, which a link carries differently from a name matching the default. */
export type Leaf = { kind: 'pane'; id: string; weight: number; name?: string }

/** Two or more regions divided along one axis, holding their share of what is
 *  above them. */
export type Split = {
  kind: 'split'
  id: string
  axis: Orientation
  weight: number
  children: Region[]
}

export type Region = Leaf | Split

/** The smallest share a separator can leave a region with: below about an eighth
 *  a pane is all filter bar and no rows. */
export const MIN_WEIGHT = 0.12

/** Clockwise from the top, which is the order the drop zones are drawn in. */
export const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left']

/** What dropping on an edge means: which axis, and which side of the target. */
export function placementFor(edge: Edge): { orientation: Orientation; before: boolean } {
  return {
    orientation: edge === 'top' || edge === 'bottom' ? 'rows' : 'columns',
    before: edge === 'top' || edge === 'left',
  }
}

/** Equal shares, and the floor for every other operation to fall back to. */
export function evenWeights(count: number): number[] {
  return count <= 0 ? [] : Array.from({ length: count }, () => 1 / count)
}

export function normalised(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  // An even split rather than a division by zero: weights off a shared link can
  // sum to nothing, and NaN flex-grows would leave a workspace with no panes.
  return total > 0 ? weights.map((weight) => weight / total) : evenWeights(weights.length)
}

/** Moves the boundary between `boundary` and the region after it, by a delta in weight
 *  units. No renormalising: the pair's total is untouched, so a region nobody is
 *  dragging cannot move on a rounding pass. Clamped against MIN_WEIGHT on both sides,
 *  so dragging past the end of the travel stops there. */
export function resized(weights: readonly number[], boundary: number, delta: number): number[] {
  const before = weights[boundary]
  const after = weights[boundary + 1]
  if (before === undefined || after === undefined) {
    return [...weights]
  }

  const clamped = Math.min(Math.max(delta, MIN_WEIGHT - before), after - MIN_WEIGHT)
  const next = [...weights]
  next[boundary] = before + clamped
  next[boundary + 1] = after - clamped
  return next
}

/** Every pane in the tree, in the order they are drawn. */
export function panesOf(region: Region): Leaf[] {
  return region.kind === 'pane' ? [region] : region.children.flatMap(panesOf)
}

/** Each pane's path from the root, as the child index at every level down to it. The
 *  form an arrangement travels in: a split id is minted on a drop and means nothing to
 *  whoever opens the link. */
export function pathsOf(region: Region, at: readonly number[] = []): Map<string, number[]> {
  if (region.kind === 'pane') {
    return new Map([[region.id, [...at]]])
  }
  const paths = new Map<string, number[]>()
  region.children.forEach((child, index) => {
    for (const [id, path] of pathsOf(child, [...at, index])) {
      paths.set(id, path)
    }
  })
  return paths
}

/** Each pane's share of the window rather than of the split it sits in: the product of
 *  the weights down to it, and the only form comparable across depths. */
export function sharesOf(region: Region, scale = 1): Map<string, number> {
  if (region.kind === 'pane') {
    return new Map([[region.id, scale]])
  }
  const shares = new Map<string, number>()
  for (const child of region.children) {
    for (const [id, share] of sharesOf(child, scale * child.weight)) {
      shares.set(id, share)
    }
  }
  return shares
}

/** The tree with every weight re-derived from the shares named, bottom up. What makes
 *  a move rearrange without resizing: a removal renormalises the old neighbours and an
 *  insertion halves the new one, so the two together would resize every pane. */
function reshared(
  region: Region,
  shares: ReadonlyMap<string, number>,
): { region: Region; total: number } {
  if (region.kind === 'pane') {
    // A pane with no share named is new, so its own weight is the only answer.
    return { region, total: shares.get(region.id) ?? region.weight }
  }

  const parts = region.children.map((child) => reshared(child, shares))
  const total = parts.reduce((sum, part) => sum + part.total, 0)
  const weights = total > 0 ? parts.map((part) => part.total / total) : evenWeights(parts.length)
  return {
    region: {
      ...region,
      children: parts.map((part, index) => ({
        ...part.region,
        weight: weights[index] ?? part.region.weight,
      })),
    },
    total,
  }
}

/** reshared, for a caller that wants the tree. What a shared link rebuilds with: a
 *  share of the window is the only figure that means the same thing in the browser
 *  that opens it. */
export function withShares(region: Region, shares: ReadonlyMap<string, number>): Region {
  return reshared(region, shares).region
}

/** How a link arranges its panes: a number is an index into the views the link carries,
 *  an array is a split. Indices rather than ids, because a link cannot name a pane that
 *  does not exist yet. No axes: they alternate with depth, so only the root's is
 *  stated. Two children minimum, in the type. */
export type Arrangement = number | readonly [Arrangement, Arrangement, ...Arrangement[]]

/** An arrangement turned back into a tree, taking the panes and the split ids from the
 *  caller. Weights come out even; withShares afterwards restates the ones a link
 *  carries. */
export function regionOf(
  arrangement: Arrangement,
  axis: Orientation,
  pane: (index: number) => Leaf,
  splitId: () => string,
): Region {
  if (typeof arrangement === 'number') {
    return pane(arrangement)
  }
  const weight = 1 / arrangement.length
  const below = axis === 'rows' ? 'columns' : 'rows'
  return {
    kind: 'split',
    id: splitId(),
    axis,
    weight: 1,
    children: arrangement.map((child) => ({
      ...regionOf(child, below, pane, splitId),
      weight,
    })),
  }
}

/** The split a region sits directly inside, or null for the root. Takes any region id,
 *  not just a pane's: an id survives a rebuild, a child index does not. */
export function splitOf(region: Region, id: string): Split | null {
  if (region.kind === 'pane') {
    return null
  }
  if (region.children.some((child) => child.id === id)) {
    return region
  }
  for (const child of region.children) {
    const found = splitOf(child, id)
    if (found !== null) {
      return found
    }
  }
  return null
}

/** Children renormalised, so the ones left keep their shares relative to each
 *  other rather than each growing by the same amount. */
function shared(children: readonly Region[]): Region[] {
  const weights = normalised(children.map((child) => child.weight))
  return children.map((child, index) => ({ ...child, weight: weights[index] ?? child.weight }))
}

function evened(children: readonly Region[]): Region[] {
  const weights = evenWeights(children.length)
  return children.map((child, index) => ({ ...child, weight: weights[index] ?? child.weight }))
}

/** A split holding a child split on its own axis is the same split written twice, and
 *  would draw two separators on one boundary. One level is enough: the invariant held
 *  before the caller ran, so at most one adjacency can be new. */
function flattened(split: Split): Split {
  const children: Region[] = []
  for (const child of split.children) {
    if (child.kind === 'split' && child.axis === split.axis) {
      // The grandchild's share of its parent, times its parent's share here.
      for (const inner of child.children) {
        children.push({ ...inner, weight: inner.weight * child.weight })
      }
    } else {
      children.push(child)
    }
  }
  return { ...split, children }
}

/** The tree with that pane renamed. An empty name takes the name off, leaving the pane
 *  named by where it sits. */
export function renamedPane(region: Region, id: string, name: string): Region {
  if (region.kind === 'pane') {
    if (region.id !== id) {
      return region
    }
    // Rebuilt without the field rather than set to '': a link leaves out a name
    // nobody chose, and absent is how that is said.
    return name === ''
      ? { kind: 'pane', id: region.id, weight: region.weight }
      : { ...region, name }
  }
  return { ...region, children: region.children.map((child) => renamedPane(child, id, name)) }
}

/** The tree without that pane, or null if it was the only one. A split left holding one
 *  child is not a split, so the child takes its place and its share. */
export function withoutPane(region: Region, id: string): Region | null {
  if (region.kind === 'pane') {
    return region.id === id ? null : region
  }

  const kept = region.children
    .map((child) => withoutPane(child, id))
    .filter((child): child is Region => child !== null)

  const only = kept[0]
  if (only === undefined) {
    return null
  }
  if (kept.length === 1) {
    return { ...only, weight: region.weight }
  }
  return flattened({ ...region, children: shared(kept) })
}

/** `pane` put beside the child at `at`, taking half of that child's share so no
 *  other region changes size. */
function inserted(split: Split, pane: Leaf, at: number, before: boolean): Split {
  const slot = split.children[at]
  if (slot === undefined) {
    return split
  }

  const half = slot.weight / 2
  const added = split.children.toSpliced(before ? at : at + 1, 0, { ...pane, weight: half })
  return {
    ...split,
    children:
      half < MIN_WEIGHT
        ? // Halving would put the new pane and its source both under the floor and
          // hide them. Evening the split out is the best answer at that point.
          evened(added)
        : added.map((child) => (child === slot ? { ...child, weight: half } : child)),
  }
}

/** `pane` placed on the named edge of `target`. On the axis the target's split already
 *  divides, the pane joins that split as a sibling; across it, the target's own slot
 *  becomes a split of the two. Either way the pane takes half of the target's share and
 *  no other region changes size. */
export function withPane(
  region: Region,
  pane: Leaf,
  target: string,
  edge: Edge,
  splitId: string,
): Region {
  const { orientation: axis, before } = placementFor(edge)

  if (region.kind === 'pane') {
    if (region.id !== target) {
      return region
    }
    // No split to join, so the target becomes one, keeping the share it held.
    const kept: Leaf = { ...region, weight: 0.5 }
    const added: Leaf = { ...pane, weight: 0.5 }
    return {
      kind: 'split',
      id: splitId,
      axis,
      weight: region.weight,
      children: before ? [added, kept] : [kept, added],
    }
  }

  const at = region.children.findIndex((child) => child.kind === 'pane' && child.id === target)
  const slot = at < 0 ? undefined : region.children[at]

  if (slot !== undefined && region.axis === axis) {
    return inserted(region, pane, at, before)
  }

  // Either the target is deeper, or it is a pane here and the drop asks for the other
  // axis: the recursion reaches the leaf branch and that slot becomes a split.
  return {
    ...region,
    children: region.children.map((child) => withPane(child, pane, target, edge, splitId)),
  }
}

/** The pane taken out of where it was and put on the named edge of the target. Removal
 *  then insertion, in that order, so a pane dropped two levels away leaves no one-child
 *  split behind it. */
export function movedPane(
  root: Region,
  source: string,
  target: string,
  edge: Edge,
  splitId: string,
): Region {
  if (source === target) {
    return root
  }

  const panes = panesOf(root)
  const moving = panes.find((pane) => pane.id === source)
  if (moving === undefined || !panes.some((pane) => pane.id === target)) {
    return root
  }

  // Already there, so the tree is returned untouched rather than rebuilt to the
  // same shape. Not an optimisation: a rebuild mints a new split id, which is a
  // React key, so both panes would remount and lose their sort, filters and
  // selection.
  const { orientation: axis, before } = placementFor(edge)
  const home = splitOf(root, target)
  if (home !== null && home.axis === axis) {
    const at = home.children.findIndex((child) => child.kind === 'pane' && child.id === target)
    const neighbour = home.children[before ? at - 1 : at + 1]
    if (neighbour?.kind === 'pane' && neighbour.id === source) {
      return root
    }
  }

  const rest = withoutPane(root, source)
  if (rest === null) {
    return root
  }
  // Restated against the shares from before the move: panes change place, not size.
  const shares = sharesOf(root)
  return reshared(withPane(rest, moving, target, edge, splitId), shares).region
}

/** A pane opened from the one named: half of its share, immediately after it on
 *  that split's axis. */
export function withDuplicate(root: Region, source: string, pane: Leaf, splitId: string): Region {
  const home = splitOf(root, source)
  const edge: Edge = (home?.axis ?? 'rows') === 'rows' ? 'bottom' : 'right'
  return withPane(root, pane, source, edge, splitId)
}

/** A pane opened at the end of the workspace, on the axis it is already divided on.
 *  Takes half of whatever is at that end, so every pane sized by hand keeps the size it
 *  was given. */
export function withPaneAtEnd(root: Region, pane: Leaf, splitId: string): Region {
  if (root.kind === 'pane') {
    // No split to join yet, so the window becomes one. Stacked, which is the
    // arrangement a workspace opens on.
    return withPane(root, pane, root.id, 'bottom', splitId)
  }
  return inserted(root, pane, root.children.length - 1, false)
}

export function resizedSplit(
  region: Region,
  splitId: string,
  boundary: number,
  delta: number,
): Region {
  if (region.kind === 'pane') {
    return region
  }
  if (region.id === splitId) {
    const weights = resized(
      region.children.map((child) => child.weight),
      boundary,
      delta,
    )
    return {
      ...region,
      children: region.children.map((child, index) => ({
        ...child,
        weight: weights[index] ?? child.weight,
      })),
    }
  }
  return {
    ...region,
    children: region.children.map((child) => resizedSplit(child, splitId, boundary, delta)),
  }
}
