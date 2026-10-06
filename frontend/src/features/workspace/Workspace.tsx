import type { Trade } from '@tapedeck/shared'
import type { CSSProperties, ReactElement } from 'react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { CHIP, MICRO_LABEL } from '../../lib/ui.js'
import { BlotterTable } from '../blotter/BlotterTable.js'
import type { Point } from '../blotter/PaneMenu.js'
import { PaneMenu } from '../blotter/PaneMenu.js'
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
import { PaneName } from './PaneName.js'
import type { PaneConfig } from './paneConfig.js'
import { DEFAULT_VIEW } from './paneConfig.js'
import { Separator } from './Separator.js'
import { MAX_PANES, readWorkspace, workspaceUrl } from './state.js'

type Props = {
  trades: Trade[]
  pendingIds: ReadonlySet<string>
  actions: RowActions
  /** What a reset puts back outside the panes. Optional, for the tests. */
  onReset?: (() => void) | undefined
}

/** Said rather than copied, because the clipboard needs a secure context. */
const STRANDED = 'Copy failed, the link is in the address bar'

/** How long a copy's outcome stays on screen. */
const COPIED_MS = 4_000

/** How long the address bar waits behind the workspace. `history.replaceState` is
 *  rate limited, Safari at around a hundred calls in thirty seconds, so writing per
 *  keystroke would spend that on a filter box. Trailing only: the last write is the
 *  one that matters. Exported, so the tests wait against this number. */
export const TRACK_MS = 250

/** Whether a pane is reporting a view it has already reported. By reference, which
 *  is enough: the table replaces whichever part of its state changed, so anything a
 *  trader did arrives as a new object. */
const same = (a: PaneConfig, b: PaneConfig): boolean =>
  a.sorting === b.sorting &&
  a.columnFilters === b.columnFilters &&
  a.grouping === b.grouping &&
  a.columnVisibility === b.columnVisibility

/** The edge of a neighbouring pane each arrow key asks to land on. One rule
 *  covers moving and turning the axis. */
const KEY_EDGES: Record<string, Edge> = {
  ArrowUp: 'top',
  ArrowDown: 'bottom',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}

/** What a pane with no name of its own is called, so the region label, the grid's
 *  accessible name and the separators either side always have one. The first pane
 *  keeps plain `Trades`, so one pane does not read as pane 1 of 1. */
const nameOf = (index: number): string => (index === 0 ? 'Trades' : `Trades, pane ${index + 1}`)

/** A region's share of its split, as flex rather than pixels: flex-basis 0 with
 *  flex-grow as the weight, so the browser divides what is left after the separators
 *  and no weight has to become a length. */
const grown = (region: Region): CSSProperties => ({ flexBasis: 0, flexGrow: region.weight })

const axisOf = (region: Region): string =>
  (region.kind === 'split' ? region.axis : 'rows') === 'rows' ? 'flex-col' : 'flex-row'

/**
 * One tape, read more than one way at a time: a raw feed beside an aggregated view
 * of the same trades. Every pane renders the same `trades` array from the one
 * queryKeys.blotter cache entry, so a second pane costs no second fetch or socket,
 * and it is why the rows are virtualised first.
 */
export function Workspace({ trades, pendingIds, actions, onReset }: Props): ReactElement {
  /** Each pane's current view, written by the pane and read on Share and on remount.
   *  A ref, not state: in state, one keystroke in one pane's filter box would
   *  re-render every pane. */
  const views = useRef(new Map<string, PaneConfig>())

  /** One reporter per pane, created once and kept: it is a dependency of the pane's
   *  own effect, so one built in render would report on every render. Filled on
   *  demand, because a pane out of a link is drawn before this has heard from it. */
  const reporters = useRef(new Map<string, (config: PaneConfig) => void>())

  const reporterFor = (id: string): ((config: PaneConfig) => void) => {
    const existing = reporters.current.get(id)
    if (existing !== undefined) {
      return existing
    }
    const report = (config: PaneConfig): void => {
      const known = views.current.get(id)
      views.current.set(id, config)
      // A pane reports on mount too, and a mount report is the view the bar
      // already describes: writing on it would canonicalise a link on open.
      if (known === undefined || !same(known, config)) {
        track()
      }
    }
    reporters.current.set(id, report)
    return report
  }

  /** Never reused, even after a pane is closed: a reused id would let React match a
   *  new pane to the state of the one that went away, and a split id keys a whole
   *  branch of the arrangement. */
  const nextPane = useRef(1)
  const nextSplit = useRef(1)

  const mintSplit = (): string => {
    const id = `split-${nextSplit.current}`
    nextSplit.current += 1
    return id
  }

  /** Unnamed unless the caller has a name for it: a link carries only the names
   *  that were chosen. */
  const open = (view: PaneConfig = DEFAULT_VIEW, name: string | null = null): Leaf => {
    const id = `pane-${nextPane.current}`
    nextPane.current += 1
    views.current.set(id, view)
    return name === null ? { kind: 'pane', id, weight: 1 } : { kind: 'pane', id, weight: 1, name }
  }

  // The address bar if it holds a workspace that parses, otherwise one default
  // pane. Lazy, so a link is read once on mount and a later replaceState of our
  // own cannot re-seed the state.
  const [root, setRoot] = useState<Region>(() => {
    const link = readWorkspace(window.location.search)
    if (link === null) {
      return open()
    }
    const leaves = link.views.map((view, index) => open(view, link.names[index] ?? null))
    // Two passes: the arrangement places the panes, then the shares it states
    // become the weights that produce them.
    return withShares(
      regionOf(link.arrangement, link.axis, (index) => leaves[index] ?? open(), mintSplit),
      new Map(leaves.map((leaf, index) => [leaf.id, link.shares[index] ?? 0])),
    )
  })

  /** The tree as it is now, for writers that cannot close over it: a reporter is
   *  made once, so the root it captured is the one its pane opened in. */
  const live = useRef(root)

  /** The address bar write that has not happened yet. */
  const pending = useRef<number | null>(null)

  /** The workspace the address bar already describes. Nothing is written until
   *  something differs: on arrival the bar is the source, and rewriting a link that
   *  does not parse would destroy the only copy of what somebody typed. */
  const written = useRef(root)

  /** The address bar follows the workspace, so a reload comes back to the panes on
   *  screen rather than to whatever the last Share wrote. */
  const track = useCallback(() => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current)
    }
    pending.current = window.setTimeout(() => {
      pending.current = null
      // Read when it fires, not when it was scheduled, so a burst of changes
      // writes the state it ends in.
      workspaceUrl(live.current, (id) => views.current.get(id) ?? DEFAULT_VIEW)
    }, TRACK_MS)
  }, [])

  useEffect(() => {
    live.current = root
    // Compared, not counted: a development double mount runs this twice and a
    // first-run flag would turn the second into a write.
    if (root !== written.current) {
      written.current = root
      track()
    }
  }, [root, track])

  // Or a write in flight outlives the workspace and lands in the address bar of
  // whatever is on screen when it fires.
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

  /** An object, not a string, so pressing Share twice restarts the timer below. */
  const [shared, setShared] = useState<{ text: string } | null>(null)

  /** Where the application's own menu was asked for: anywhere a pane did not
   *  already answer. */
  const [menuAt, setMenuAt] = useState<Point | null>(null)
  const dismissMenu = useCallback(() => setMenuAt(null), [])

  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      // A pane's own menu has already claimed the event by the time this runs:
      // React's handlers sit on the root element, inside the document this is
      // bound to. Shift goes to the browser.
      if (event.defaultPrevented || event.shiftKey) {
        return
      }
      const target = event.target instanceof Element ? event.target : null
      // Cut, copy and paste belong to the field. Both menus portal out of the
      // pane that raised them, so a right-click on one would open the other.
      const own = target?.closest('input, select, textarea, [role="menu"], [role="listbox"]')
      if (own != null) {
        return
      }
      event.preventDefault()
      // A menu raised from the keyboard carries no coordinates; the sheet clamps
      // (0, 0) to the corner, which is where it belongs with no pointer to clear.
      setMenuAt({ x: event.clientX, y: event.clientY })
    }

    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])

  useEffect(() => {
    if (shared === null) {
      return
    }
    const timer = setTimeout(() => setShared(null), COPIED_MS)
    return () => clearTimeout(timer)
  }, [shared])

  /** dragover fires many times a second with the same answer, so this compares
   *  before it sets and React bails out instead of re-rendering both grids. */
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

  /** Opens the duplicate immediately after its source. */
  const duplicate = (source: string, config: PaneConfig): void => {
    // Built outside the updater, which has to be pure: React runs it twice in
    // development, which would burn an id and leave a stray pane. The view is
    // handed over and the name is not: two panes with one name tell neither apart.
    const pane = open(config)
    const splitId = mintSplit()
    setRoot((current) => withDuplicate(current, source, pane, splitId))
  }

  /** A new pane on the default view rather than a copy, which is the difference from
   *  Duplicate. It lands at the end of the workspace even when a pane's own menu
   *  opened it: putting a fresh view beside that pane is Duplicate's job. */
  const addPane = (name: string): void => {
    // Guarded as well as withheld: the ceiling belongs to the link format.
    if (panesOf(root).length >= MAX_PANES) {
      return
    }
    // Outside the updater, which has to be pure, as in duplicate.
    const pane = open(DEFAULT_VIEW, name === '' ? null : name)
    const splitId = mintSplit()
    setRoot((current) => withPaneAtEnd(current, pane, splitId))
  }

  /** A workspace always has a pane in it. Guarded here as well as by withholding
   *  the button, so no route can reach an empty one. */
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

  /** The name is held on the pane in the tree, so it follows every move and close
   *  with nothing to keep in step. An empty name takes it back off. */
  const rename = (id: string, name: string): void => {
    setRoot((current) => renamedPane(current, id, name))
  }

  /** Puts `source` on the named edge of `target`: what a drop means, and what an
   *  arrow key on a grip means. The split id is minted outside the updater, which
   *  has to be pure; a no-op move burns one, and only uniqueness is asked of an id. */
  const place = (source: string, target: string, edge: Edge): void => {
    const splitId = mintSplit()
    setRoot((current) => movedPane(current, source, target, edge, splitId))
  }

  /** The keyboard equivalent of a drag, on the grip itself: an arrow key asks for
   *  the edge of a neighbouring pane, the same request a drop makes. Focus survives
   *  because the grip is keyed by its pane's id, so React moves the element rather
   *  than rebuilding it and a key can be held down. */
  const nudge = (id: string, edge: Edge): void => {
    const { before } = placementFor(edge)
    const order = panesOf(root)
    const at = order.findIndex((pane) => pane.id === id)

    // The neighbour that way, else the one the other way: Right on the last pane
    // of a stack means "stand to the right of the one beside me", which turns the
    // axis. Already there is a no-op, the right answer for Down on the bottom.
    const neighbour = order[before ? at - 1 : at + 1] ?? order[before ? at + 1 : at - 1]
    if (neighbour === undefined) {
      return
    }
    place(id, neighbour.id, edge)
  }

  /** Back to one pane on the default view, names and all, and the frame around the
   *  panes with it. Labelled "Reset workspace" because a pane's own menu has a Reset
   *  that means the view in front of you. */
  const resetWorkspace = (): void => {
    // Cleared before the pane is opened, which writes its default view back in.
    views.current.clear()
    reporters.current.clear()
    // Outside the updater, which has to be pure, as in duplicate.
    const pane = open()
    setRoot(pane)
    onReset?.()
  }

  const share = (): void => {
    // Written again here rather than read out of the bar: a debounced write may
    // still be pending, and Share hands over what is on screen now. A view is only
    // missing in the render a pane was created in, where its default is right.
    const url = workspaceUrl(root, (id) => views.current.get(id) ?? DEFAULT_VIEW)

    const copy = navigator.clipboard?.writeText(url)
    if (copy === undefined) {
      setShared({ text: STRANDED })
      return
    }
    void copy
      .then(() => setShared({ text: 'Link copied' }))
      .catch(() => setShared({ text: STRANDED }))
  }

  const order = panesOf(root)
  const names = new Map(order.map((pane, index) => [pane.id, pane.name ?? nameOf(index)]))
  const nameFor = (id: string): string => names.get(id) ?? 'Trades'

  /** What a separator is between. A split has no name of its own, so the panes on
   *  that side of the boundary are counted instead. */
  const labelOf = (region: Region): string =>
    region.kind === 'pane' ? nameFor(region.id) : `${panesOf(region).length} panes`

  /**
   * The arrangement the drop would produce, drawn as the whole outcome rather than a
   * mark on the zone aimed at: aiming at the bottom 30% of a pane that stands beside
   * another gives the dragged pane the lower half of that one pane's slot. Built by
   * calling the same movedPane the drop calls, so the two cannot disagree.
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
   * One empty div per region, at the axis, order and share the drop would produce,
   * with the pane being moved picked out. No content, so a preview costs a handful of
   * divs. gap-2 rather than ghost separators: that is exactly the 8px a real
   * separator occupies as a flex item, so the ghosts land on the real boundaries.
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
   * The regions of a split, with a separator on every boundary. The separator is a
   * flex item rather than a gap, so it can reach its two neighbours in the DOM. A
   * null split is the single-pane workspace: one path either way, because to React a
   * lone child becoming the second entry of an array is a rebuild rather than a keyed
   * update, and the pane would lose its selection.
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

  /** The arrangement, drawn. A function rather than a component: a component declared
   *  in render is a new type on every render, and React would remount every pane on
   *  each frame the feed arrives. */
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
      // relative for the drop zones drawn over the pane. min-h-0 min-w-0 because
      // every cell inside is nowrap and a flex item defaults to min-width:auto.
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
          // The view it is showing, not the one it opened on: standing a pane
          // beside another reparents it, which React can only do by remounting,
          // and the defaults would drop the sort and filters it had.
          initialConfig={views.current.get(region.id) ?? DEFAULT_VIEW}
          label={name}
          nameplate={<PaneName name={name} onRename={(next) => rename(region.id, next)} />}
          onClose={order.length === 1 ? undefined : () => close(region.id)}
          onConfigChange={reporterFor(region.id)}
          // Withheld at the ceiling: the link format numbers its panes p1 to p8,
          // so a ninth is a workspace that cannot be shared.
          onDuplicate={
            order.length >= MAX_PANES ? undefined : (config) => duplicate(region.id, config)
          }
          // Withheld at the ceiling for the same reason Duplicate is.
          onNewPane={order.length >= MAX_PANES ? undefined : () => addPane('')}
          onShare={share}
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
      {/* Fixed, so four seconds of status costs the panes no height, and above the
        pane menu that usually raises it. The clipboard can refuse outright, and
        then this line is the only thing that says where the link is. */}
      {shared === null ? null : (
        <p
          className={`fixed right-3 bottom-3 z-50 rounded-xs border border-tape-line bg-tape-panel px-2 py-1 ${MICRO_LABEL}`}
          role="status"
        >
          {shared.text}
        </p>
      )}

      {/* The items that need no pane, so right-click answers off the tape too. A
        pane's own menu carries these as well, above its own four. */}
      {menuAt === null ? null : (
        <PaneMenu
          at={menuAt}
          items={[
            {
              label: 'New pane',
              onSelect: () => addPane(''),
              disabled: order.length >= MAX_PANES,
            },
            { label: 'Reset workspace', onSelect: resetWorkspace },
            { label: 'Share workspace', onSelect: share },
          ]}
          label="Workspace"
          onDismiss={dismissMenu}
        />
      )}

      {/* The root split, drawn here rather than through draw(), so going from one
        pane to two adds a sibling to this container instead of wrapping the pane in a
        new one: a reparented pane is a remounted pane. */}
      <div
        className={`relative flex min-h-0 min-w-0 flex-1 ${axisOf(root)}`}
        // Panes carry their id and splits their axis, so the arrangement can be
        // read off the DOM by a test.
        data-region={root.kind === 'split' ? root.axis : undefined}
      >
        {/* pointer-events-none is load-bearing: the preview sits over the panes and
          over their drop zones, and would otherwise swallow the dragover that
          draws it and the drop that ends it. */}
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

/** Six keys rather than six indices: the same thing for a list that cannot
 *  reorder, and it leaves the lint rule meaning something on the lists that can. */
const DOTS = ['1', '2', '3', '4', '5', '6']

type GripProps = {
  label: string
  onDragEnd: () => void
  onDragStart: () => void
  onNudge: (edge: Edge) => void
}

/** The handle a pane is moved by, offered only once there is another pane to move it
 *  past. Native drag and drop, so the drop zones are real elements the browser
 *  hit-tests; pointer events would mean measuring every pane on every move. */
function Grip({ label, onDragEnd, onDragStart, onNudge }: GripProps): ReactElement {
  return (
    <button
      aria-label={`Move ${label}. Use the arrow keys.`}
      className={`${CHIP} flex cursor-grab items-center justify-center px-1.5 active:cursor-grabbing`}
      draggable
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        // Firefox refuses to start a drag without data on the transfer. The pane
        // id is carried in state instead, because dragover cannot read it.
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
      {/* Drawn rather than typed: a glyph this small depends on the font having
        it. bg-current keeps the dots on the button's colour through hover. */}
      <span aria-hidden="true" className="grid grid-cols-2 gap-[2px]">
        {DOTS.map((dot) => (
          <span className="size-[2px] rounded-full bg-current" key={dot} />
        ))}
      </span>
    </button>
  )
}

/** Where a dragged pane can be put down: the two ends for stacking, the two halves
 *  of the middle for standing it beside this one. aria-hidden on purpose, because a
 *  zone exists only while a pointer is dragging and the keyboard route is the grip's
 *  arrow keys. Tests address them by attribute for the same reason. */
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
        // dragleave bubbles from the zone being left, so crossing between zones
        // would flash the preview off and back on. Only leaving the pane counts.
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
          // preventDefault is what makes an element a drop target: without it the
          // browser rejects the drop and onDrop never runs. From dragover, not
          // dragenter, which does not fire again on re-entering its own zone.
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

/** The four zones tile the pane exactly, so every point means one edge. The ends are
 *  shallower than the halves because stacking is the commoner request. */
const ZONES: Record<Edge, string> = {
  top: 'inset-x-0 top-0 h-[30%]',
  bottom: 'inset-x-0 bottom-0 h-[30%]',
  left: 'left-0 top-[30%] h-[40%] w-1/2',
  right: 'right-0 top-[30%] h-[40%] w-1/2',
}
