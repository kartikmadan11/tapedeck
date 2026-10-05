import type { Trade } from '@tapedeck/shared'
import type { CSSProperties, ReactElement } from 'react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CHIP, MICRO_LABEL } from '../../lib/ui.js'
import { BlotterTable } from '../blotter/BlotterTable.js'
import type { RowActions } from '../blotter/SelectionBar.js'
import type { Edge, Leaf, Region, Split } from './layout.js'
import {
  EDGES,
  movedPane,
  panesOf,
  placementFor,
  regionOf,
  renamedPane,
  resizedSplit,
  withDuplicate,
  withoutPane,
  withPaneAtEnd,
  withShares,
} from './layout.js'
import { NewPane } from './NewPane.js'
import { PaneName } from './PaneName.js'
import type { PaneConfig } from './paneConfig.js'
import { DEFAULT_VIEW } from './paneConfig.js'
import { Separator } from './Separator.js'
import { MAX_PANES, readWorkspace, workspaceUrl } from './state.js'

type Props = {
  trades: Trade[]
  pendingIds: ReadonlySet<string>
  actions: RowActions

  /**
   * Where in the nav to put the control that opens a pane, or null before the
   * nav has been laid out.
   *
   * The control belongs up there, because opening a pane is the one thing a
   * trader asks of the workspace without having a pane in mind. It is rendered
   * from here through a portal rather than by lifting the arrangement into the
   * app, which is the trade this prop exists to make: a pane tree held one level
   * up would put every rename, resize and rearrangement through the component
   * that also holds the booking form and the positions panel.
   */
  nav: HTMLElement | null
}

/** Said rather than copied, because the clipboard needs a secure context. */
const STRANDED = 'Copy failed, the link is in the address bar'

/**
 * How long the address bar waits behind the workspace.
 *
 * Exported for the tests, which assert both that a change reaches the bar and
 * that nothing reaches it on arrival, and the second of those is a claim about
 * time that has to be made against this number rather than beside it.
 *
 * A view arrives one keystroke at a time and `history.replaceState` is rate
 * limited by the browser, Safari at around a hundred calls in thirty seconds, so
 * writing per change would spend that budget on a filter box. Trailing only,
 * because the bar is a record to come back to rather than something being read
 * mid-gesture: the only write that matters is the last one.
 */
export const TRACK_MS = 250

/**
 * Whether a pane is reporting a view it has already reported.
 *
 * By reference, which is enough and is the point: a pane reports on mount as
 * well as on change, and on mount it reports the four objects it was opened
 * with. The table replaces whichever part of its state changed and keeps the
 * rest, so anything a trader actually did arrives as a new object.
 */
const same = (a: PaneConfig, b: PaneConfig): boolean =>
  a.sorting === b.sorting &&
  a.columnFilters === b.columnFilters &&
  a.grouping === b.grouping &&
  a.columnVisibility === b.columnVisibility

/** The direction each arrow key asks for, which is read as the edge of the
 *  neighbouring pane to land on. One rule covers moving and turning the axis. */
const KEY_EDGES: Record<string, Edge> = {
  ArrowUp: 'top',
  ArrowDown: 'bottom',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

/**
 * What a pane with no name of its own is called: where it is in the workspace.
 *
 * So there is always a name, for the region label, the grid's own accessible name
 * and the separators either side of it, before anyone has typed one. The first
 * keeps the name it had when there was only one of them, so the common case reads
 * as a blotter rather than as pane 1 of 1.
 */
const nameOf = (index: number): string => (index === 0 ? 'Trades' : `Trades, pane ${index + 1}`)

/**
 * A region's share of its split, as flex rather than as pixels: flex-basis 0
 * with flex-grow as the weight, so the browser divides whatever is left after
 * the separators and no weight ever has to be converted to a length.
 */
const grown = (region: Region): CSSProperties => ({ flexBasis: 0, flexGrow: region.weight })

const axisOf = (region: Region): string =>
  (region.kind === 'split' ? region.axis : 'rows') === 'rows' ? 'flex-col' : 'flex-row'

/**
 * One tape, read more than one way at a time.
 *
 * The use this exists for is a raw feed beside an aggregated view of the same
 * trades: group one pane by symbol to watch net exposure build, and leave the
 * other flat to watch the prints arrive.
 *
 * Costs nothing to add a pane, and that is the design rather than a happy
 * accident. Every pane renders the same `trades` array from the single
 * queryKeys.blotter cache entry, so a second pane opens no second fetch, no
 * second socket and no second cursor to reconcile. It is also why the rows are
 * virtualised first: two unvirtualised panes would be a thousand rows, which is
 * exactly the cost the 500-row window was introduced to remove.
 */
export function Workspace({ trades, pendingIds, actions, nav }: Props): ReactElement {
  /**
   * Each pane's current view, written by the pane and read when Share is pressed
   * or when a pane has to be remounted. A ref and not state on purpose: holding
   * it in state would put every pane's sort, filter and column changes through
   * this component, and one keystroke in one pane's filter box would re-render
   * all of them.
   */
  const views = useRef(new Map<string, PaneConfig>())

  /**
   * One reporter per pane, created once and kept. It is a dependency of the
   * effect in the pane that calls it, so a callback built in render would report
   * on every render, which with a feed arriving every two seconds is a lot of
   * nothing. Filled on demand rather than in `open`, because a pane that came
   * out of a link is drawn before anything here has heard from it.
   */
  const reporters = useRef(new Map<string, (config: PaneConfig) => void>())

  const reporterFor = (id: string): ((config: PaneConfig) => void) => {
    const existing = reporters.current.get(id)
    if (existing !== undefined) {
      return existing
    }
    const report = (config: PaneConfig): void => {
      const known = views.current.get(id)
      views.current.set(id, config)
      // A pane reports on mount as well as on change, and a mount report is the
      // view the address bar already describes, so writing on it would
      // canonicalise a link the moment it was opened.
      if (known === undefined || !same(known, config)) {
        track()
      }
    }
    reporters.current.set(id, report)
    return report
  }

  /**
   * Never reused, even after a pane is closed. Reusing an id would let React
   * match a new pane to the state of the one that just went away, and a split id
   * is a React key for a whole branch of the arrangement.
   */
  const nextPane = useRef(1)
  const nextSplit = useRef(1)

  const mintSplit = (): string => {
    const id = `split-${nextSplit.current}`
    nextSplit.current += 1
    return id
  }

  /** A pane with no name of its own, unless the caller has one for it: a link
   *  carries the names that were chosen and leaves the rest to the position. */
  const open = (view: PaneConfig = DEFAULT_VIEW, name: string | null = null): Leaf => {
    const id = `pane-${nextPane.current}`
    nextPane.current += 1
    views.current.set(id, view)
    return name === null ? { kind: 'pane', id, weight: 1 } : { kind: 'pane', id, weight: 1, name }
  }

  // The address bar, if it holds a workspace that parses, and otherwise the one
  // default pane. Lazy, so a link is read once on mount rather than on every
  // render, and so a later replaceState of our own cannot re-seed the state.
  const [root, setRoot] = useState<Region>(() => {
    const link = readWorkspace(window.location.search)
    if (link === null) {
      return open()
    }
    const leaves = link.views.map((view, index) => open(view, link.names[index] ?? null))
    // Two passes: the arrangement puts the panes where the link says, and then
    // the shares it states are restated as the weights that produce them.
    return withShares(
      regionOf(link.arrangement, link.axis, (index) => leaves[index] ?? open(), mintSplit),
      new Map(leaves.map((leaf, index) => [leaf.id, link.shares[index] ?? 0])),
    )
  })

  /**
   * The tree as it is now, for the writers that cannot close over it: a pane's
   * reporter is made once and kept, so the root it captured is the root the pane
   * was opened in.
   */
  const live = useRef(root)

  /** The address bar write that has not happened yet. */
  const pending = useRef<number | null>(null)

  /**
   * The workspace the address bar already describes.
   *
   * Nothing is written until something differs from it, because on arrival the
   * bar is the source rather than the record. Writing it back would rewrite a
   * link somebody typed into the canonical form of itself, and when the link
   * does not parse that is the only copy of what they typed.
   */
  const written = useRef(root)

  /**
   * The address bar follows the workspace, so a refresh comes back to the panes
   * that are on screen rather than to whatever the last Share wrote.
   *
   * The defect this answers: open a third pane, reload, and the workspace is
   * back to two, because the bar still held the link from before it.
   */
  const track = useCallback(() => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current)
    }
    pending.current = window.setTimeout(() => {
      pending.current = null
      // Read when it fires rather than when it was scheduled, so a burst of
      // changes of either kind writes the state they end in.
      workspaceUrl(live.current, (id) => views.current.get(id) ?? DEFAULT_VIEW)
    }, TRACK_MS)
  }, [])

  useEffect(() => {
    live.current = root
    // Compared rather than counted, because a development double mount runs this
    // twice and a flag for the first run would make the second one a write.
    if (root !== written.current) {
      written.current = root
      track()
    }
  }, [root, track])

  // A write in flight outlives the workspace otherwise, and lands in the address
  // bar of whatever is on screen by the time it fires.
  useEffect(
    () => () => {
      if (pending.current !== null) {
        window.clearTimeout(pending.current)
      }
    },
    [],
  )

  /** The pane being dragged, which is also what puts the drop zones on screen. */
  const [dragging, setDragging] = useState<string | null>(null)

  /** The pane and edge being aimed at, which is what the preview is drawn from. */
  const [over, setOver] = useState<{ pane: string; edge: Edge } | null>(null)

  const [shared, setShared] = useState<string | null>(null)

  /**
   * dragover fires continuously while a pointer is held still, so this is called
   * many times a second with the same answer. Compared before it is set, so
   * React bails out instead of re-rendering two virtualised grids per frame.
   */
  const aim = (pane: string, edge: Edge): void => {
    setOver((current) =>
      current?.pane === pane && current.edge === edge ? current : { pane, edge },
    )
  }

  /** Both halves of a drag ending, however it ended. */
  const release = (): void => {
    setDragging(null)
    setOver(null)
  }

  /** Opens the duplicate immediately after its source, where it will be looked for. */
  const duplicate = (source: string, config: PaneConfig): void => {
    // Built outside the updater. An updater has to be pure, and React runs it
    // twice in development, which would burn an id and leave a stray pane.
    //
    // The view is handed over and the name is not. Two panes called the same
    // thing are two panes nobody can tell apart, on screen or in a screen
    // reader, so the duplicate starts on the name its position gives it.
    const pane = open(config)
    const splitId = mintSplit()
    setRoot((current) => withDuplicate(current, source, pane, splitId))
  }

  /**
   * A pane opened from the nav, on the name it was given and on the default view.
   *
   * The default view rather than a copy is the difference from Duplicate, and it
   * is the reason both controls exist: one branches off the view in front of you,
   * and this one is the empty second reading of the tape. It lands at the end of
   * the workspace, because the control it comes off names no pane to open it
   * beside.
   */
  const addPane = (name: string): void => {
    // Guarded here as well as by withholding the control, since the ceiling is
    // the link format's rather than the nav's.
    if (panesOf(root).length >= MAX_PANES) {
      return
    }
    // Outside the updater, which has to be pure, for the same reason the
    // duplicate is.
    const pane = open(DEFAULT_VIEW, name === '' ? null : name)
    const splitId = mintSplit()
    setRoot((current) => withPaneAtEnd(current, pane, splitId))
  }

  /**
   * A workspace always has a pane in it. Guarded here as well as by withholding
   * the button from the only pane, because a workspace with nothing in it is not
   * a state this should be able to reach by any route.
   */
  const close = (id: string): void => {
    if (panesOf(root).length < 2) {
      return
    }
    views.current.delete(id)
    reporters.current.delete(id)
    setRoot((current) => withoutPane(current, id) ?? current)
  }

  const resize = (splitId: string, boundary: number, delta: number): void => {
    setRoot((current) => resizedSplit(current, splitId, boundary, delta))
  }

  /**
   * The name is held on the pane in the tree rather than in a map beside it, so
   * it follows the pane through every move, duplication and close without this
   * component keeping two things in step. An empty name takes it back off.
   */
  const rename = (id: string, name: string): void => {
    setRoot((current) => renamedPane(current, id, name))
  }

  /**
   * Puts `source` on the named edge of `target`, which is both what a drop means
   * and what an arrow key on a grip means.
   *
   * The split id is minted here rather than inside the updater, which has to be
   * pure. A move that turns out to be a no-op burns one, and that costs nothing:
   * the only thing asked of an id is that it is never seen twice.
   */
  const place = (source: string, target: string, edge: Edge): void => {
    const splitId = mintSplit()
    setRoot((current) => movedPane(current, source, target, edge, splitId))
  }

  /**
   * The keyboard equivalent of a drag, on the grip itself rather than as a
   * separate control: an arrow key asks for the edge of a neighbouring pane,
   * which is the same request a drop makes.
   *
   * Focus survives it when the pane keeps its place in the tree, because the
   * grip belongs to a pane keyed by its own id and React moves the element
   * rather than rebuilding it, so a pane can be walked along a split with one
   * key held down.
   */
  const nudge = (id: string, edge: Edge): void => {
    const { before } = placementFor(edge)
    const order = panesOf(root)
    const at = order.findIndex((pane) => pane.id === id)

    // The neighbour that way if there is one, and otherwise the one the other
    // way. Pressing Right on the pane at the end of a stack still means "stand
    // to the right of the pane beside me", which is the keyboard route to a
    // sideways arrangement that keeps the order. When the pane is already
    // against that edge of that neighbour the move is a no-op, which is the
    // right answer for pressing Down on the bottom pane.
    const neighbour = order[before ? at - 1 : at + 1] ?? order[before ? at + 1 : at - 1]
    if (neighbour === undefined) {
      return
    }
    place(id, neighbour.id, edge)
  }

  const share = (): void => {
    // The tree, so the link carries the arrangement as well as the views. The
    // pane reports on mount, so a view is only missing in the render a pane was
    // created in, where the default it opened on is the right answer anyway.
    //
    // Written again here rather than read out of the bar, because a debounced
    // write may still be pending and a trader who presses Share gets the link to
    // what is on screen now. It writes the same thing the pending one would.
    const url = workspaceUrl(root, (id) => views.current.get(id) ?? DEFAULT_VIEW)

    const copy = navigator.clipboard?.writeText(url)
    if (copy === undefined) {
      setShared(STRANDED)
      return
    }
    void copy.then(() => setShared('Link copied')).catch(() => setShared(STRANDED))
  }

  const order = panesOf(root)
  const names = new Map(order.map((pane, index) => [pane.id, pane.name ?? nameOf(index)]))
  const nameFor = (id: string): string => names.get(id) ?? 'Trades'

  /** What a separator is between. A split has no name of its own, and how many
   *  panes are on that side of the boundary is the useful thing to say. */
  const labelOf = (region: Region): string =>
    region.kind === 'pane' ? nameFor(region.id) : `${panesOf(region).length} panes`

  /**
   * The arrangement the drop would produce.
   *
   * Drawn as the whole outcome rather than as a mark on the pane being aimed at,
   * because the zone under the pointer is not where the pane lands. Aiming at the
   * bottom 30% of a pane standing beside another gives the dragged pane the lower
   * half of that one pane's slot, so highlighting the zone describes the hit test
   * rather than the result.
   *
   * Built by calling the same movedPane the drop itself calls, so the preview
   * cannot show one outcome and the drop produce another. A move that changes
   * nothing previews the arrangement unchanged, which is also the truth.
   */
  const preview = ((): { edge: Edge; root: Region } | null => {
    if (dragging === null || over === null) {
      return null
    }
    return { edge: over.edge, root: movedPane(root, dragging, over.pane, over.edge, 'preview') }
  })()

  /** The split the workspace divides, or null while it holds a single pane. */
  const top = root.kind === 'split' ? root : null

  /**
   * One empty div per region, at the axis, order and share the drop would
   * produce, with the pane being moved picked out. The ghosts carry no content,
   * so a preview costs a handful of divs rather than a second copy of two
   * virtualised grids.
   *
   * gap-2 rather than ghost separators, which is exactly the 8px each real
   * separator occupies as a flex item, so the ghosts land on the boundaries the
   * panes will.
   */
  function ghost(region: Region, edge: Edge): ReactElement {
    return region.kind === 'pane' ? (
      <div
        className={
          region.id === dragging
            ? 'rounded-sm bg-tape-accent/15 outline-2 -outline-offset-2 outline-tape-accent'
            : ''
        }
        data-drop-preview={region.id === dragging ? edge : undefined}
        data-ghost={region.id}
        key={region.id}
        style={grown(region)}
      />
    ) : (
      <div
        className={`flex min-h-0 min-w-0 gap-2 ${axisOf(region)}`}
        data-ghost={region.axis}
        key={region.id}
        style={grown(region)}
      >
        {region.children.map((child) => ghost(child, edge))}
      </div>
    )
  }

  /**
   * The regions of a split, with a separator on every boundary between them.
   *
   * The separator is a flex item between two regions rather than a gap, so a
   * split is one row of siblings and a separator can reach its two neighbours
   * without being told about them.
   *
   * Takes a null split for the workspace that holds a single pane, which has no
   * boundary to put a separator on. One path either way, because a pane has to
   * render as the same shape of child in both: a lone child becoming the second
   * entry of an array is not a keyed update to React, it is a rebuild, and the
   * pane would lose its selection the moment a second pane opened.
   */
  function divided(children: readonly Region[], split: Split | null): ReactElement[] {
    return children.map((child, index) => {
      const previous = children[index - 1]
      return (
        <Fragment key={child.id}>
          {previous === undefined || split === null ? null : (
            <Separator
              label={`Resize ${labelOf(previous)} against ${labelOf(child)}`}
              onResize={(delta) => resize(split.id, index - 1, delta)}
              orientation={split.axis}
              weightAfter={child.weight}
              weightBefore={previous.weight}
            />
          )}
          {draw(child)}
        </Fragment>
      )
    })
  }

  /**
   * The arrangement, drawn.
   *
   * A function rather than a component, because a component declared in render is
   * a new type on every render and React would remount every pane in the
   * workspace on each frame the feed arrives.
   */
  function draw(region: Region): ReactElement {
    if (region.kind === 'split') {
      return (
        <div
          className={`flex min-h-0 min-w-0 ${axisOf(region)}`}
          data-region={region.axis}
          style={grown(region)}
        >
          {divided(region.children, region)}
        </div>
      )
    }

    const name = nameFor(region.id)
    return (
      // relative, because the drop zones are drawn over the pane, and min-h-0
      // min-w-0 because every cell inside is nowrap and a flex item keeps
      // min-width:auto without it.
      <div
        className="relative flex min-h-0 min-w-0 flex-col"
        data-region={region.id}
        style={grown(region)}
      >
        <BlotterTable
          actions={actions}
          grip={
            order.length === 1 ? undefined : (
              <Grip
                label={name}
                onDragEnd={release}
                onDragStart={() => setDragging(region.id)}
                onNudge={(edge) => nudge(region.id, edge)}
              />
            )
          }
          // The view it is showing, not the one it opened on. Standing a pane
          // beside another reparents it into a new split, which React can only
          // do by remounting it, and a pane that came back on the defaults would
          // have dropped the sort and filters a trader had set.
          initialConfig={views.current.get(region.id) ?? DEFAULT_VIEW}
          label={name}
          nameplate={<PaneName name={name} onRename={(next) => rename(region.id, next)} />}
          onClose={order.length === 1 ? undefined : () => close(region.id)}
          onConfigChange={reporterFor(region.id)}
          // Withheld at the ceiling rather than refused: the link format numbers
          // its panes p1 to p8, so a ninth pane is a workspace that cannot be
          // shared.
          onDuplicate={
            order.length >= MAX_PANES ? undefined : (config) => duplicate(region.id, config)
          }
          pendingIds={pendingIds}
          trades={trades}
        />

        {dragging === null || dragging === region.id ? null : (
          <DropZones
            onDrop={(edge) => {
              place(dragging, region.id, edge)
              release()
            }}
            onLeave={() => setOver(null)}
            onOver={(edge) => aim(region.id, edge)}
            paneId={region.id}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      {/* In the nav, because opening a pane is the one thing asked of the
        workspace with no pane in mind, and rendered from here because the
        arrangement it adds to is here. Withheld at the ceiling for the same
        reason Duplicate is: the link numbers its panes p1 to p8. */}
      {nav === null || order.length >= MAX_PANES
        ? null
        : createPortal(<NewPane onOpen={addPane} />, nav)}

      {/* The workspace is the subject here too, so this cannot live on a pane's
        own bar: a Share button inside a pane could not say whether it meant that
        pane or all of them. It stays on the workspace's own strip rather than
        moving up beside New pane, because what it leaves behind is a line of
        text and the nav has no room for one. */}
      <div className="flex shrink-0 items-center justify-end gap-2">
        {shared === null ? null : (
          <span className={MICRO_LABEL} role="status">
            {shared}
          </span>
        )}
        <button className={CHIP} onClick={share} type="button">
          Share
        </button>
      </div>

      {/*
       * The root split, which is the one region that always fills what it is
       * given. Drawn here rather than through draw(), so a workspace going from
       * one pane to two adds a sibling to this container instead of wrapping the
       * pane in a new one: a pane React has to reparent is a pane React has to
       * remount, and the commonest arrangement change must not cost that.
       */}
      <div
        className={`relative flex min-h-0 min-w-0 flex-1 ${axisOf(root)}`}
        // Panes carry their id and splits their axis, so the arrangement can be
        // read off the DOM: by a test, and by anyone looking at why a boundary
        // ended up where it did.
        data-region={root.kind === 'split' ? root.axis : undefined}
      >
        {/*
         * Over the panes and over their drop zones, so pointer-events-none is
         * load-bearing twice: without it the preview would swallow the dragover
         * that draws it and the drop that ends it.
         */}
        {preview === null ? null : (
          <div className="pointer-events-none absolute inset-0 z-30 flex" key="preview">
            {ghost(preview.root, preview.edge)}
          </div>
        )}

        {divided(top?.children ?? [root], top)}
      </div>
    </div>
  )
}

/** Six keys rather than six indices, which is the same thing for a list that
 *  cannot reorder and leaves the lint rule meaning something on the lists that
 *  can. */
const DOTS = ['1', '2', '3', '4', '5', '6']

type GripProps = {
  label: string
  onDragEnd: () => void
  onDragStart: () => void
  onNudge: (edge: Edge) => void
}

/**
 * The handle a pane is moved by, offered only once there is more than one pane
 * to move it past.
 *
 * Native drag and drop rather than pointer events, because the drop targets are
 * then real elements the browser hit-tests for us, and the alternative is
 * measuring every pane on every pointer move to work out which edge the cursor
 * is nearest.
 */
function Grip({ label, onDragEnd, onDragStart, onNudge }: GripProps): ReactElement {
  return (
    <button
      aria-label={`Move ${label}. Use the arrow keys.`}
      className={`${CHIP} flex cursor-grab items-center justify-center px-1.5 active:cursor-grabbing`}
      draggable
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        // Firefox refuses to start a drag without data on the transfer, and the
        // pane id is carried in state rather than here because a drop has to
        // know it during dragover, which cannot read the transfer.
        event.dataTransfer.setData('text/plain', label)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onKeyDown={(event) => {
        const edge = KEY_EDGES[event.key]
        if (edge === undefined) {
          return
        }
        // Or the arrow key scrolls the workspace while the pane moves under it.
        event.preventDefault()
        onNudge(edge)
      }}
      type="button"
    >
      {/* Six dots, drawn rather than typed: a glyph this small depends on the
        font having it, and bg-current keeps it on the button's own colour
        through hover and focus. */}
      <span aria-hidden="true" className="grid grid-cols-2 gap-[2px]">
        {DOTS.map((dot) => (
          <span className="size-[2px] rounded-full bg-current" key={dot} />
        ))}
      </span>
    </button>
  )
}

/**
 * Where a dragged pane can be put down: the two ends of the pane for stacking,
 * and the two halves of its middle for standing it beside this one.
 *
 * Hidden from assistive technology on purpose. A drop zone exists only while a
 * pointer is dragging, so announcing four unreachable targets per pane would be
 * noise; the keyboard route is the grip's own arrow keys, which make the same
 * four requests. Addressed in tests by their attributes for the same reason.
 */
function DropZones({
  onDrop,
  onLeave,
  onOver,
  paneId,
}: {
  onDrop: (edge: Edge) => void
  onLeave: () => void
  onOver: (edge: Edge) => void
  paneId: string
}): ReactElement {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-20"
      onDragLeave={(event) => {
        // dragleave bubbles up from the zone being left, so crossing from one
        // zone to the next would clear the preview and flash it back on. Only a
        // pointer that has left the pane altogether counts as leaving.
        const to = event.relatedTarget
        if (!(to instanceof Node) || !event.currentTarget.contains(to)) {
          onLeave()
        }
      }}
    >
      {EDGES.map((edge) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only drop target, hidden from assistive technology, whose keyboard equivalent is the grip's arrow keys. An interactive role here would announce four targets per pane that no keyboard can reach.
        <div
          className={`absolute ${ZONES[edge]}`}
          data-drop={edge}
          data-pane={paneId}
          key={edge}
          // Preventing the default is what makes an element a drop target at
          // all. Without it the browser rejects the drop and onDrop never runs.
          // The aim is reported from here rather than from dragenter, because
          // dragenter does not fire again if a pointer re-enters the zone it
          // started in, and the preview would stay on the wrong edge.
          onDragOver={(event) => {
            event.preventDefault()
            onOver(edge)
          }}
          onDrop={(event) => {
            event.preventDefault()
            onDrop(edge)
          }}
        />
      ))}
    </div>
  )
}

/**
 * The four zones tile the pane exactly, so every point in it means one edge and
 * there is nowhere to drop that does nothing. The ends are shallower than the
 * halves because stacking is the more common of the two and an edge is where the
 * hand aims for it.
 */
const ZONES: Record<Edge, string> = {
  top: 'inset-x-0 top-0 h-[30%]',
  bottom: 'inset-x-0 bottom-0 h-[30%]',
  left: 'left-0 top-[30%] h-[40%] w-1/2',
  right: 'right-0 top-[30%] h-[40%] w-1/2',
}
