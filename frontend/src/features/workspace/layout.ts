/**
 * How the panes of a workspace are arranged: a tree of splits, each dividing its
 * own share of the screen along one axis.
 *
 * A tree, because the flat version was tried first and is wrong in a way a trader
 * notices in the first minute. One axis for the whole workspace makes "sideways"
 * a property of the workspace, so standing one pane beside another turns every
 * other pane sideways with it. What a drop on a left edge should mean is that the
 * pane lands beside that one pane, in that one pane's slot, and that nothing
 * outside the slot moves.
 *
 * Weights, not pixels. A region is a flex item with a flex-basis of 0 and a
 * flex-grow of its weight, so the browser divides whatever is left after the
 * separators and nothing here needs to know how wide the window is or how thick a
 * separator is. A weight only means anything beside its siblings, which is why
 * the children of every split sum to one and every operation that changes the set
 * of children renormalises them.
 *
 * Two invariants hold the shape down, and every operation here maintains both:
 * a split has at least two children, and no split has a child split on its own
 * axis. The second buys more than it looks like: it makes the axes alternate with
 * depth, so a shared link can state the root axis alone and every other axis
 * follows from how deep it sits.
 */

/** Stacked, or side by side. Each split has its own. */
export type Orientation = 'rows' | 'columns'

/** The edge of a pane that another pane can be dropped on. */
export type Edge = 'top' | 'bottom' | 'left' | 'right'

/**
 * One blotter, holding its share of the split it sits in.
 *
 * The name is here rather than in a map beside the tree because it belongs to the
 * pane and not to the slot: every operation below rebuilds a leaf by spreading
 * it, so a name follows its pane through a move, a promotion and a reshare
 * without any of them being told it exists. Absent means nobody has named it,
 * which is not the same as a name that happens to match the default: one is
 * carried in a shared link and the other is not.
 */
export type Leaf = { kind: 'pane'; id: string; weight: number; name?: string }

/** Two or more regions divided along one axis, holding their share of whatever
 *  is above them. */
export type Split = {
  kind: 'split'
  id: string
  axis: Orientation
  weight: number
  children: Region[]
}

export type Region = Leaf | Split

/**
 * The smallest share a separator can leave a region with. Below about an eighth a
 * pane is its own filter bar and no rows, which is a pane in the way rather than
 * a pane made small, and Close is how you get rid of one.
 */
export const MIN_WEIGHT = 0.12

/** Clockwise from the top, which is the order the drop zones are drawn in. */
export const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left']

/**
 * What dropping on an edge means: the axis it asks for, and which side of the
 * target it lands on.
 *
 * There is no separate orientation control, because a button that said "side by
 * side" would be a second way to express something the drag already says
 * unambiguously, and it would have to pick a subject the drag already names.
 */
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
  // An even split rather than a division by zero. Only reachable from weights
  // somebody else built, which a shared link is, and the alternative is a row of
  // NaN flex-grows and a workspace with no panes in it.
  return total > 0 ? weights.map((weight) => weight / total) : evenWeights(weights.length)
}

/**
 * Moves the boundary between `boundary` and the region after it, by a delta in
 * the same units as the weights.
 *
 * The total is untouched, so this does not renormalise: a separator takes from
 * one region and gives to its neighbour, and a region the trader is not dragging
 * must not move because of a rounding pass. Clamped against both floors rather
 * than one, so dragging past the end of the travel stops there instead of pushing
 * the far region under the floor.
 */
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

/**
 * Each pane's path from the root, as the child index at every level down to it.
 *
 * The form an arrangement travels in, because a path says where a pane sits
 * without naming anything that only exists in this browser: a split id is minted
 * on a drop and means nothing to whoever opens the link.
 */
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

/**
 * Each pane's share of the whole window, as opposed to of the split it sits in.
 *
 * The product of the weights down to it, which is the only form in which two
 * panes at different depths are comparable at all.
 */
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

/**
 * The tree with every weight re-derived from the shares named, bottom up.
 *
 * This is what makes a move rearrange without resizing. A removal and an
 * insertion are each sound on their own, but one renormalises the pane's old
 * neighbours and the other halves its new one, so the two together leave every
 * pane a different size than it started at. Restating the shares afterwards
 * means the only thing a drop changes is where the panes are.
 */
function reshared(
  region: Region,
  shares: ReadonlyMap<string, number>,
): { region: Region; total: number } {
  if (region.kind === 'pane') {
    // No share named means a pane that did not exist before this, and its own
    // weight is the only answer available.
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

/**
 * The tree with every weight re-derived from the shares named.
 *
 * What a shared link reconstructs with: a link states each pane's share of the
 * window, because that is the only figure that means the same thing to the
 * browser that opens it, and the weights that produce those shares fall out of
 * the arrangement.
 */
export function withShares(region: Region, shares: ReadonlyMap<string, number>): Region {
  return reshared(region, shares).region
}

/**
 * How a link arranges its panes: a number is a pane, as an index into the views
 * the link carries, and an array is a split of two or more regions.
 *
 * Indices rather than ids, because a link cannot name a pane that does not exist
 * yet. No axes, because they alternate with depth, so the root's is the only one
 * there is to state. Two children at least, in the type, so the one shape that is
 * not a split cannot be built by accident.
 */
export type Arrangement = number | readonly [Arrangement, Arrangement, ...Arrangement[]]

/**
 * An arrangement turned back into a tree, taking the panes and the split ids
 * from the caller.
 *
 * The weights are even, and a link that wants other ones restates the shares
 * through withShares afterwards. Doing it in two passes rather than threading
 * shares through here is what keeps this a function of the arrangement alone.
 */
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

/**
 * The split a region sits directly inside, or null for the root.
 *
 * Takes any region id, not just a pane's, because a separator names the split it
 * belongs to rather than a path down to it: an id survives the tree being
 * rebuilt around it, and an index into a list of children does not.
 */
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

/** Children renormalised, so the ones that are left keep their shares relative
 *  to each other rather than each growing by the same amount. */
function shared(children: readonly Region[]): Region[] {
  const weights = normalised(children.map((child) => child.weight))
  return children.map((child, index) => ({ ...child, weight: weights[index] ?? child.weight }))
}

function evened(children: readonly Region[]): Region[] {
  const weights = evenWeights(children.length)
  return children.map((child, index) => ({ ...child, weight: weights[index] ?? child.weight }))
}

/**
 * A split whose child splits on its own axis is the same split written twice. It
 * would draw two separators where there is one boundary, and it would let a pane
 * nest arbitrarily deep without ever looking any different.
 *
 * One level is enough, because the invariant held before the operation that
 * called this, so at most one new same-axis adjacency can have appeared.
 */
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

/**
 * The tree with that pane renamed, or put back on its default name when the name
 * given is empty.
 *
 * Empty rather than a second function, because clearing the box is how a trader
 * takes a name back off a pane and the two are one action to them. A pane with no
 * name of its own is named by where it is, so there is always a name to fall back
 * to and never a pane with no name at all.
 */
export function renamedPane(region: Region, id: string, name: string): Region {
  if (region.kind === 'pane') {
    if (region.id !== id) {
      return region
    }
    // Rebuilt without the field rather than set to an empty string, because a
    // name nobody chose is the thing a shared link leaves out, and "absent" is
    // how that is said.
    return name === ''
      ? { kind: 'pane', id: region.id, weight: region.weight }
      : { ...region, name }
  }
  return { ...region, children: region.children.map((child) => renamedPane(child, id, name)) }
}

/**
 * The tree without that pane, or null if it was the only one.
 *
 * A split left holding one child is not a split, so the child takes its place and
 * the share the split was holding.
 */
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

/**
 * `pane` put into a split beside the child at `at`, taking half of that child's
 * share so that no other region changes size.
 *
 * Shared by the two ways a pane arrives in a split that is already on the axis it
 * asked for: dropped against a pane sitting in it, and opened at its end.
 */
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
        ? // Halving would put the new pane and the one it came from both under
          // the floor and hide the two of them. Evening the split out is the
          // arrangement that needs a hand at that point anyway.
          evened(added)
        : added.map((child) => (child === slot ? { ...child, weight: half } : child)),
  }
}

/**
 * `pane` placed on the named edge of `target`.
 *
 * On the axis the target's split already divides, the pane joins that split as a
 * sibling. Across it, the target's own slot becomes a split of the two, which is
 * the whole point of the tree: the pane lands beside that one pane and nothing
 * outside the slot moves.
 *
 * Either way the pane takes half of the target's share and no other region
 * changes size, which is what makes a drop read as splitting something rather
 * than as rearranging everything.
 */
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
    // The target is a whole region with no split to join, so it becomes one,
    // keeping whatever share it was holding above.
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

  // Either the target is deeper, or it is a pane in this split but the drop asks
  // for the other axis, in which case the recursion reaches the leaf branch and
  // that pane's slot becomes a split.
  return {
    ...region,
    children: region.children.map((child) => withPane(child, pane, target, edge, splitId)),
  }
}

/**
 * The pane taken out of where it was and put on the named edge of the target,
 * which is what a drop means and what an arrow key on a grip means.
 *
 * Removal and insertion, in that order, so a pane dropped two levels away does
 * not leave a one-child split behind it.
 */
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
  // same shape. Not an optimisation: rebuilding would mint a new split id, and a
  // split is a React key, so both panes would remount and lose their sort,
  // filters and selection over a drop that changed nothing.
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
  // Restated against the shares from before the move, so the panes change place
  // and nothing changes size.
  const shares = sharesOf(root)
  return reshared(withPane(rest, moving, target, edge, splitId), shares).region
}

/**
 * A pane opened from the one named, which takes half of its share and sits
 * immediately after it on its own split's axis.
 *
 * After, rather than at the end, because that is where the duplicate of the pane
 * you are reading will be looked for.
 */
export function withDuplicate(root: Region, source: string, pane: Leaf, splitId: string): Region {
  const home = splitOf(root, source)
  const edge: Edge = (home?.axis ?? 'rows') === 'rows' ? 'bottom' : 'right'
  return withPane(root, pane, source, edge, splitId)
}

/**
 * A pane opened at the end of the workspace, along the axis the workspace is
 * already divided on.
 *
 * At the end, because this is the one way of opening a pane that names no pane to
 * open it from: it comes off a control whose subject is the whole workspace, so
 * the slot it divides is the last one there is. It takes half of whatever is at
 * that end, for the same reason a duplicate takes half of its source, so every
 * pane sized by hand keeps the size it was given.
 */
export function withPaneAtEnd(root: Region, pane: Leaf, splitId: string): Region {
  if (root.kind === 'pane') {
    // No split to join yet, so the window becomes one. Stacked rather than side
    // by side, which is the arrangement a workspace opens on.
    return withPane(root, pane, root.id, 'bottom', splitId)
  }
  return inserted(root, pane, root.children.length - 1, false)
}

/** The boundary at `boundary` inside the named split, moved by `delta`. */
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
