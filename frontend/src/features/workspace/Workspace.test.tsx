import type { Trade } from '@tapedeck/shared'
import { trade as tradeSchema } from '@tapedeck/shared'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MIN_WEIGHT } from './layout.js'
import { decodeWorkspace } from './state.js'
import { TRACK_MS, Workspace } from './Workspace.js'

function aTrade(overrides: Record<string, unknown> = {}): Trade {
  return tradeSchema.parse({
    tradeId: 'TRD-100001',
    symbol: 'VOD',
    side: 'BUY',
    quantity: 10_000,
    filledQuantity: 0,
    price: '72.465000',
    trader: 'k.madan',
    book: 'EQ-LDN-01',
    counterparty: 'GSIL',
    tradeTimestamp: '2026-10-02T09:15:00.000Z',
    status: 'NEW',
    version: 1,
    updatedAt: '2026-10-02T09:15:00.000Z',
    ...overrides,
  })
}

/** Two symbols, so a grouping and a symbol filter both have something to do. */
const BOOK = [
  aTrade(),
  aTrade({
    tradeId: 'TRD-100002',
    symbol: 'BARC',
    quantity: 1_000,
    price: '2.500000',
    tradeTimestamp: '2026-10-02T09:14:00.000Z',
  }),
]

function renderWorkspace(): void {
  render(
    <Workspace
      actions={{ onAmend: vi.fn(), onCancel: vi.fn(), onHistory: vi.fn() }}
      pendingIds={new Set()}
      trades={BOOK}
    />,
  )
}

/**
 * Every pane carries the same controls under the same names, so an unscoped
 * query would find two of each the moment a second pane exists. Panes are
 * addressed by the region label Workspace assigns them.
 */
function pane(name: string) {
  return within(screen.getByRole('region', { name }))
}

const first = () => pane('Trades')
const second = () => pane('Trades, pane 2')

/** A trade's row in one pane, by the id it carries rather than by a cell: the
 *  Trade column is off by default, and both panes hold the same trades. */
function row(paneName: string, tradeId: string): HTMLElement | null {
  return screen
    .getByRole('region', { name: paneName })
    .querySelector(`tr[data-trade-id="${tradeId}"]`)
}

const panes = (): HTMLElement[] => screen.getAllByRole('grid')

/**
 * A pane's own controls, which are behind its right-click rather than on its
 * bar. Portaled to the body, so the menu is not inside the region it belongs to
 * and has to be addressed on its own.
 *
 * Pointer down before the right-click, because that is the order a browser fires
 * the two in, and it is what closes a menu left open on another pane.
 */
function menu(paneName: string) {
  const region = screen.getByRole('region', { name: paneName })
  fireEvent.pointerDown(region)
  fireEvent.contextMenu(region)
  return within(screen.getByRole('menu'))
}

/** Opens a pane's menu and presses one of its items. */
function choose(paneName: string, item: string): void {
  fireEvent.click(menu(paneName).getByRole('menuitem', { name: item }))
}

/**
 * The application's own menu, raised from outside every pane. The body stands in
 * for the header, the ticket and the positions panel, which are all the same
 * thing to the listener: a right-click no pane claimed.
 */
function appMenu() {
  fireEvent.pointerDown(document.body)
  fireEvent.contextMenu(document.body)
  return within(screen.getByRole('menu'))
}

/** A pane's name on its own bar, which is also the control that changes it. */
const nameplate = (paneName: string): HTMLElement =>
  pane(paneName).getByRole('button', { name: `Rename ${paneName}` })

/** The box the nameplate turns into, under the same name: one control in two
 *  modes is one thing to address. */
const nameBox = (paneName: string): HTMLElement =>
  screen.getByRole('textbox', { name: `Rename ${paneName}` })

function rename(from: string, to: string): void {
  fireEvent.click(nameplate(from))
  fireEvent.change(nameBox(from), { target: { value: to } })
  fireEvent.keyDown(nameBox(from), { key: 'Enter' })
}

/** Opens one from a pane's menu. It arrives unnamed, so a name is a rename. */
function openPane(name: string): void {
  const opened = `Trades, pane ${panes().length + 1}`
  choose('Trades', 'New pane')
  if (name !== '') {
    rename(opened, name)
  }
}

/** The workspace reads the address bar on mount, and follows it as it changes. */
function address(query = ''): void {
  window.history.replaceState(null, '', `/${query}`)
}

/** Long enough for a write to have happened, for the cases whose claim is that
 *  none did. Off the constant itself, so the two cannot drift apart. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, TRACK_MS * 2))

beforeEach(() => address())

describe('the workspace', () => {
  it('opens on one pane, so the ordinary case is just a blotter', () => {
    renderWorkspace()

    expect(panes()).toHaveLength(1)
    // Not "pane 1 of 1". The name it had before panes existed.
    expect(screen.getByRole('region', { name: 'Trades' })).toBeInTheDocument()
  })

  it('never offers to close the only pane', () => {
    renderWorkspace()

    // Offered and refused rather than missing, which is the one thing the menu
    // changed: an item that disappears is an item the one below it moves up
    // into, and a workspace still cannot be emptied by any route a user has.
    const items = menu('Trades')
    expect(items.getByRole('menuitem', { name: 'Close' })).toBeDisabled()
    expect(items.getByRole('menuitem', { name: 'Duplicate' })).toBeEnabled()
  })

  it('offers to close either of two panes, since neither of them is the slot', () => {
    renderWorkspace()
    choose('Trades', 'Duplicate')

    // Not "the first pane is permanent". Which pane is first is a position, and
    // a position changes when panes are moved, so that rule would hand the Close
    // button to whichever pane happened to be drawn first. One pane minimum is
    // the invariant that means something.
    expect(menu('Trades').getByRole('menuitem', { name: 'Close' })).toBeEnabled()
    expect(menu('Trades, pane 2').getByRole('menuitem', { name: 'Close' })).toBeEnabled()
  })

  it('adds a pane that closes, and closes only that pane', () => {
    renderWorkspace()
    choose('Trades', 'Duplicate')

    expect(panes()).toHaveLength(2)

    choose('Trades, pane 2', 'Close')
    expect(panes()).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Trades' })).toBeInTheDocument()
  })

  it('answers a right-click outside every pane, carrying what needs no pane', () => {
    renderWorkspace()

    const items = appMenu()
    expect(items.getByRole('menuitem', { name: 'New pane' })).toBeEnabled()
    expect(items.getByRole('menuitem', { name: 'Reset workspace' })).toBeEnabled()
    expect(items.getByRole('menuitem', { name: 'Share workspace' })).toBeEnabled()

    // The four that are about the pane you clicked are not offered here, since
    // there is no pane to be about.
    expect(items.queryByRole('menuitem', { name: 'Close' })).toBeNull()
    expect(items.queryByRole('menuitem', { name: 'Duplicate' })).toBeNull()
    expect(items.queryByRole('menuitem', { name: 'Config' })).toBeNull()
  })

  it('leaves a right-click over a pane to the pane', () => {
    renderWorkspace()

    // One menu, and the longer one. The pane's handler runs first and takes the
    // event, which is what the application-wide listener reads to stand down.
    const items = menu('Trades')
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(items.getByRole('menuitem', { name: 'Duplicate' })).toBeInTheDocument()
  })

  it('gives Shift back to the browser outside a pane as well as over one', () => {
    renderWorkspace()

    fireEvent.contextMenu(document.body, { shiftKey: true })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('resets the workspace to the one pane it opens on', () => {
    renderWorkspace()
    choose('Trades', 'Duplicate')
    rename('Trades', 'Risk')

    fireEvent.click(appMenu().getByRole('menuitem', { name: 'Reset workspace' }))

    // The arrangement, the views and the names all go: a reset that kept the
    // names would leave a pane called Risk on the default view.
    expect(panes()).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Trades' })).toBeInTheDocument()
  })

  it('stops offering to duplicate at the ceiling the link format can carry', () => {
    address('?panes=8')
    renderWorkspace()

    // Refused rather than missing. The link numbers its panes p1 to p8, so a
    // ninth would be a workspace that cannot be shared. One pane's menu rather
    // than all eight, since the items come off the same two props for every pane
    // and only one menu is open at a time.
    expect(panes()).toHaveLength(8)
    const items = menu('Trades')
    expect(items.getByRole('menuitem', { name: 'Duplicate' })).toBeDisabled()
    expect(items.getByRole('menuitem', { name: 'New pane' })).toBeDisabled()
    expect(items.getByRole('menuitem', { name: 'Close' })).toBeEnabled()
  })

  it('opens the duplicate on the view it was duplicated from', () => {
    renderWorkspace()

    // A duplicate that arrived on the defaults would make the button useless:
    // the whole point is to branch off the arrangement in front of you.
    choose('Trades', 'Config')
    fireEvent.change(first().getByLabelText('Group by'), { target: { value: 'symbol' } })
    choose('Trades', 'Duplicate')

    expect(second().getByRole('button', { name: 'VOD, 1 trades' })).toBeInTheDocument()
    expect(second().getByLabelText('Group by')).toHaveValue('symbol')
  })

  it('leaves each pane holding its own view', () => {
    renderWorkspace()
    choose('Trades', 'Duplicate')

    // Filtering one pane must not reach the other. The panes share the single
    // cache entry they read from, and that is all they share.
    fireEvent.change(second().getByLabelText('Filter by symbol'), { target: { value: 'BARC' } })

    expect(row('Trades, pane 2', 'TRD-100002')).not.toBeNull()
    expect(row('Trades, pane 2', 'TRD-100001')).toBeNull()
    expect(row('Trades', 'TRD-100001')).not.toBeNull()
    expect(row('Trades', 'TRD-100002')).not.toBeNull()
  })

  it('hands over the view and not the reading position', () => {
    renderWorkspace()

    fireEvent.click(row('Trades', 'TRD-100001') as HTMLElement)
    choose('Trades', 'Duplicate')

    // Which row someone had selected is where they were, not how they were
    // looking, so the duplicate starts with nothing selected and the pane that
    // was duplicated keeps its selection. The second pane arriving must not
    // remount the first one, which is what would clear it.
    expect(first().getByRole('status')).toHaveTextContent('TRD-100001')
    expect(second().getByRole('status')).toBeEmptyDOMElement()
  })

  it('names the panes apart, so two grids are two things to a screen reader', () => {
    renderWorkspace()
    choose('Trades', 'Duplicate')

    const named = panes().map((grid) => grid.getAttribute('aria-label'))
    expect(named).toEqual([
      'Trades. Use the arrow keys to select a row.',
      'Trades, pane 2. Use the arrow keys to select a row.',
    ])
  })
})

describe('naming a pane', () => {
  it('shows the name on the bar and takes another one in its place', () => {
    renderWorkspace()
    expect(nameplate('Trades')).toHaveTextContent('Trades')

    rename('Trades', 'EU Flow')

    // One name wherever the pane is named: the title on its bar, the region a
    // screen reader and these tests address it by, and the grid's own label.
    expect(nameplate('EU Flow')).toBeInTheDocument()
    expect(screen.getByRole('grid')).toHaveAttribute(
      'aria-label',
      'EU Flow. Use the arrow keys to select a row.',
    )
  })

  it('puts the cursor in the box, on the name it is replacing', () => {
    renderWorkspace()
    fireEvent.click(nameplate('Trades'))

    // Clicking a name is asking to type one, so the commonest rename of all,
    // replacing the default outright, takes no further aim.
    expect(document.activeElement).toBe(nameBox('Trades'))
  })

  it('leaves the name alone when the rename is abandoned', () => {
    renderWorkspace()
    fireEvent.click(nameplate('Trades'))
    fireEvent.change(nameBox('Trades'), { target: { value: 'EU Flow' } })
    fireEvent.keyDown(nameBox('Trades'), { key: 'Escape' })

    expect(nameplate('Trades')).toBeInTheDocument()
  })

  it('keeps a name typed and then clicked away from', () => {
    renderWorkspace()
    fireEvent.click(nameplate('Trades'))
    fireEvent.change(nameBox('Trades'), { target: { value: 'EU Flow' } })
    fireEvent.blur(nameBox('Trades'))

    // Someone who types a name and goes back to the tape has said what they
    // wanted. Escape is how to leave without saying it.
    expect(nameplate('EU Flow')).toBeInTheDocument()
  })

  it('gives the pane its position back when the box is emptied', () => {
    renderWorkspace()
    rename('Trades', 'EU Flow')
    rename('EU Flow', '  ')

    // Clearing the box is how a name comes off, and what is left is the name the
    // pane had before anyone typed one rather than a pane with no title.
    expect(nameplate('Trades')).toBeInTheDocument()
  })

  it('does not hand a name to a duplicate', () => {
    renderWorkspace()
    rename('Trades', 'EU Flow')
    choose('EU Flow', 'Duplicate')

    // The view is handed over and the name is not. Two panes with one name
    // between them are two panes nobody can tell apart.
    expect(panes()).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Trades, pane 2' })).toBeInTheDocument()
  })

  it('carries the names that were chosen in the link, and no others', () => {
    address('?panes=2')
    renderWorkspace()
    rename('Trades, pane 2', 'Cancels')
    choose('Trades', 'Share workspace')

    // The second pane was named and the first was not, so the link states one
    // name. A name a position gives a pane is not a decision to carry.
    expect(window.location.search).toContain('p2.name=Cancels')
    expect(window.location.search).not.toContain('p1.name')

    cleanup()
    address(window.location.search)
    renderWorkspace()

    expect(screen.getByRole('region', { name: 'Cancels' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Trades' })).toBeInTheDocument()
  })
})

describe('opening a pane', () => {
  it('opens one with no name, which the workspace then names by where it put it', () => {
    renderWorkspace()
    choose('Trades', 'New pane')

    // The name comes off the position, and the nameplate changes it.
    expect(panes()).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Trades, pane 2' })).toBeInTheDocument()
  })

  it('opens it on the default view rather than on the view in front of you', () => {
    renderWorkspace()
    choose('Trades', 'Config')
    fireEvent.change(first().getByLabelText('Group by'), { target: { value: 'symbol' } })
    openPane('EU Flow')

    // The difference from Duplicate: that one branches off what you are reading.
    expect(first().getByRole('button', { name: 'VOD, 1 trades' })).toBeInTheDocument()
    expect(pane('EU Flow').queryByRole('button', { name: 'VOD, 1 trades' })).toBeNull()
    // Flat, so both trades are rows of their own rather than inside a group.
    expect(row('EU Flow', 'TRD-100001')).not.toBeNull()
    expect(row('EU Flow', 'TRD-100002')).not.toBeNull()
  })
})

describe('arranging the panes', () => {
  /**
   * The arrangement, read back off the DOM: a pane carries its own id and a
   * split carries its axis, so what is rendered can be asserted as the same
   * expression layout.test.ts uses. Shares are the flex-grow the layout actually
   * renders, multiplied down the tree, which is the only form in which two panes
   * at different depths are comparable.
   *
   * `data-ghost` is the same tree, drawn for a drop preview.
   */
  function tree(attribute = 'data-region'): { shape: string; shares: Record<string, number> } {
    const root = document.querySelector(`[${attribute}]`)
    if (root === null) {
      throw new Error(`nothing carrying ${attribute} on screen`)
    }

    const name = (node: Element): string => node.getAttribute(attribute) ?? '?'
    const regions = (node: Element): Element[] =>
      [...node.children].filter((child) => child.hasAttribute(attribute))

    const shape = (node: Element): string => {
      const kids = regions(node)
      const only = kids[0]
      if (only === undefined) {
        return name(node)
      }
      // The container is a split of one while there is a single pane in it,
      // which the tree itself has no way to say. Collapsed, so these read the
      // way the tree reads.
      return kids.length === 1 ? shape(only) : `${name(node)}(${kids.map(shape).join(' ')})`
    }

    const shares: Record<string, number> = {}
    const measure = (node: Element, scale: number): void => {
      const kids = regions(node)
      if (kids.length === 0) {
        shares[name(node)] = Math.round(scale * 1e4) / 1e4
        return
      }
      for (const kid of kids) {
        const grow = kid instanceof HTMLElement ? Number(kid.style.flexGrow || '1') : 1
        measure(kid, scale * grow)
      }
    }
    measure(root, 1)

    return { shape: shape(root), shares }
  }

  const grip = (name: string) =>
    pane(name).getByRole('button', { name: `Move ${name}. Use the arrow keys.` })

  /**
   * Starts a drag on a pane's handle. jsdom implements no DataTransfer, so the
   * one the browser always supplies is stubbed here: the handle writes to it
   * because Firefox will not start a drag without it.
   */
  function drag(name: string): void {
    fireEvent.dragStart(grip(name), {
      dataTransfer: { effectAllowed: '', setData: () => undefined },
    })
  }

  /** A drop target, addressed by its attributes: the zones are aria-hidden,
   *  since they exist only while a pointer is dragging. */
  function zone(paneIndex: number, edge: string): HTMLElement {
    const found = document.querySelector(`[data-pane="pane-${paneIndex}"][data-drop="${edge}"]`)
    if (!(found instanceof HTMLElement)) {
      throw new Error(`no ${edge} drop zone on pane-${paneIndex}`)
    }
    return found
  }

  function two(): void {
    renderWorkspace()
    choose('Trades', 'Duplicate')
  }

  /** Three even panes, which is the arrangement the nesting defect was found in
   *  and the smallest one where a move has a bystander to leave alone. */
  function three(): void {
    address('?panes=3')
    renderWorkspace()
  }

  it('offers no handle while there is only one pane', () => {
    renderWorkspace()

    // Nothing to move it past, so the control would be chrome that cannot act.
    expect(first().queryByRole('button', { name: /^Move Trades/ })).toBeNull()
  })

  it('opens stacked, and the duplicate takes its share out of its source', () => {
    two()

    expect(tree().shape).toBe('rows(pane-1 pane-2)')
    expect(tree().shares).toEqual({ 'pane-1': 0.5, 'pane-2': 0.5 })
  })

  it('opens one from the nav at the end, on the axis the workspace already has', () => {
    two()
    drag('Trades, pane 2')
    fireEvent.drop(zone(1, 'right'))
    openPane('EU Flow')

    // Side by side, so the third pane stands beside the other two rather than
    // under the one that happens to be last, and it takes its half out of the
    // end: the pane at the other end keeps the width it was given.
    expect(tree().shape).toBe('columns(pane-1 pane-2 pane-3)')
    expect(tree().shares).toEqual({ 'pane-1': 0.5, 'pane-2': 0.25, 'pane-3': 0.25 })
  })

  it('gives a closed pane space back in proportion', () => {
    renderWorkspace()
    choose('Trades', 'Duplicate')
    choose('Trades', 'Duplicate')

    // Opening twice off the first pane leaves it a quarter, so closing the
    // middle pane has to leave the other two one to two, not evened out.
    expect(tree().shares).toEqual({ 'pane-1': 0.25, 'pane-3': 0.25, 'pane-2': 0.5 })

    choose('Trades, pane 2', 'Close')
    expect(tree().shares).toEqual({ 'pane-1': 0.3333, 'pane-2': 0.6667 })
  })

  it('resizes from the keyboard, which is the path that needs no geometry', () => {
    two()

    // jsdom lays nothing out, so a pointer drag has nothing to measure. The
    // separator is a real splitter either way: arrow keys move the boundary.
    const separator = screen.getByRole('separator', {
      name: 'Resize Trades against Trades, pane 2',
    })
    expect(separator).toHaveAttribute('aria-valuenow', '50')

    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    fireEvent.keyDown(separator, { key: 'ArrowDown' })

    expect(tree().shares).toEqual({ 'pane-1': 0.54, 'pane-2': 0.46 })
    expect(
      screen.getByRole('separator', { name: 'Resize Trades against Trades, pane 2' }),
    ).toHaveAttribute('aria-valuenow', '54')
  })

  it('will not let a boundary squeeze a pane out of existence', () => {
    two()
    const separator = screen.getByRole('separator', {
      name: 'Resize Trades against Trades, pane 2',
    })

    // Forty presses is far more travel than there is. A pane that can be
    // reduced to nothing is a pane you cannot get back without closing it.
    for (let press = 0; press < 40; press += 1) {
      fireEvent.keyDown(separator, { key: 'ArrowDown' })
    }

    expect(Math.min(...Object.values(tree().shares))).toBeCloseTo(MIN_WEIGHT, 10)
  })

  it('ignores the keys for the other axis', () => {
    two()
    const separator = screen.getByRole('separator', {
      name: 'Resize Trades against Trades, pane 2',
    })

    // The boundary of a stack moves up and down. Left on it is not a smaller
    // version of the same request, it is a different one, so it does nothing.
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(tree().shares).toEqual({ 'pane-1': 0.5, 'pane-2': 0.5 })
  })

  it('stands one pane beside another without turning the rest sideways', () => {
    three()
    expect(tree().shape).toBe('rows(pane-1 pane-2 pane-3)')

    drag('Trades, pane 3')
    fireEvent.drop(zone(1, 'right'))

    // The whole reason the arrangement is a tree. One axis for the workspace made
    // sideways a property of the workspace, so standing one pane beside another
    // turned the third sideways with it. pane-3 lands inside pane-1's own slot,
    // and pane-2 is still stacked under both of them.
    expect(tree().shape).toBe('rows(columns(pane-1 pane-3) pane-2)')
  })

  it('changes where the panes are and not how big they are', () => {
    three()

    drag('Trades, pane 3')
    fireEvent.drop(zone(1, 'right'))

    // Every pane keeps the third of the window it had. Taking a pane out
    // renormalises its old neighbours and putting it back halves its new one, so
    // without restating the shares afterwards a drop that was meant to rearrange
    // would have resized all three.
    expect(tree().shares).toEqual({ 'pane-1': 0.3333, 'pane-2': 0.3333, 'pane-3': 0.3333 })
  })

  it('keeps a moved pane on the view it was showing', () => {
    three()
    fireEvent.change(pane('Trades, pane 3').getByLabelText('Filter by symbol'), {
      target: { value: 'BARC' },
    })

    drag('Trades, pane 3')
    fireEvent.drop(zone(1, 'right'))

    // Standing a pane beside another reparents it into a new split, which React
    // can only do by remounting it. The view each pane reports out is the view it
    // is mounted back on, so the filter survives a move the component does not.
    // The names follow the position, so the pane that moved is now the second.
    expect(pane('Trades, pane 2').getByLabelText('Filter by symbol')).toHaveValue('BARC')
    expect(pane('Trades, pane 3').getByLabelText('Filter by symbol')).toHaveValue('')
  })

  it('keeps a named pane on its name through a move, where a position would not', () => {
    three()
    rename('Trades, pane 3', 'EU Flow')

    drag('EU Flow')
    fireEvent.drop(zone(1, 'right'))

    // The pane that moved is drawn second now, so a name from its position would
    // have become "Trades, pane 2" on the way. A name is a thing a trader gave
    // this pane, so it goes where the pane goes.
    expect(tree().shape).toBe('rows(columns(pane-1 pane-3) pane-2)')
    expect(screen.getByRole('region', { name: 'EU Flow' })).toBeInTheDocument()
    // And it is what the boundary that arrived with the move is described by.
    expect(
      screen.getByRole('separator', { name: 'Resize Trades against EU Flow' }),
    ).toBeInTheDocument()
  })

  it('moves the boundary of the split it belongs to and no other', () => {
    three()
    drag('Trades, pane 3')
    fireEvent.drop(zone(1, 'right'))

    // Two boundaries now, and they are not interchangeable. The inner one stands
    // between the panes that are side by side, so it takes from one and gives to
    // the other; the pane underneath both is in the outer split and does not move.
    const inner = screen.getByRole('separator', { name: 'Resize Trades against Trades, pane 2' })
    expect(inner).toHaveAttribute('aria-orientation', 'vertical')
    expect(
      screen.getByRole('separator', { name: 'Resize 2 panes against Trades, pane 3' }),
    ).toHaveAttribute('aria-orientation', 'horizontal')

    for (let press = 0; press < 5; press += 1) {
      fireEvent.keyDown(inner, { key: 'ArrowRight' })
    }

    expect(tree().shares).toEqual({ 'pane-1': 0.4, 'pane-3': 0.2667, 'pane-2': 0.3333 })
  })

  it('stands the workspace up sideways when a pane is dropped on a left edge', () => {
    two()
    // Filtered, so which pane ended up where is read off the view it holds
    // rather than off a name that follows the position.
    fireEvent.change(second().getByLabelText('Filter by symbol'), { target: { value: 'BARC' } })

    drag('Trades, pane 2')
    fireEvent.dragOver(zone(1, 'left'))
    fireEvent.drop(zone(1, 'left'))

    // Dropped to the left of the only other pane, so there is nothing left to
    // nest inside and the whole workspace turns. The drop is the only thing that
    // turns it.
    expect(tree().shape).toBe('columns(pane-2 pane-1)')
    expect(first().getByLabelText('Filter by symbol')).toHaveValue('BARC')
    expect(second().getByLabelText('Filter by symbol')).toHaveValue('')
  })

  it('carries a share with the pane when it moves', () => {
    two()
    const separator = screen.getByRole('separator', {
      name: 'Resize Trades against Trades, pane 2',
    })
    for (let press = 0; press < 10; press += 1) {
      fireEvent.keyDown(separator, { key: 'ArrowUp' })
    }
    expect(tree().shares).toEqual({ 'pane-1': 0.3, 'pane-2': 0.7 })

    drag('Trades, pane 2')
    fireEvent.drop(zone(1, 'top'))

    // The small pane was the top one and is now the bottom one, still small. A
    // share is something a trader set for a view, not for a slot.
    expect(tree().shape).toBe('rows(pane-2 pane-1)')
    expect(tree().shares).toEqual({ 'pane-1': 0.3, 'pane-2': 0.7 })
  })

  it('moves a pane with the arrow keys, and keeps the handle focused', () => {
    two()
    fireEvent.change(second().getByLabelText('Filter by symbol'), { target: { value: 'BARC' } })

    const handle = grip('Trades, pane 2')
    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowUp' })

    // Up is the same request a drop on a top edge makes, so the pane that was
    // second is now first and its filter went with it. Still stacked: up and down
    // are the axis it is already on.
    expect(tree().shape).toBe('rows(pane-2 pane-1)')
    expect(first().getByLabelText('Filter by symbol')).toHaveValue('BARC')
    // The same element, moved rather than rebuilt, so the key can be held down
    // and walk the pane along the split.
    expect(document.activeElement).toBe(grip('Trades'))
  })

  it('turns the axis for a pane with no neighbour that way, and keeps the order', () => {
    two()
    fireEvent.change(second().getByLabelText('Filter by symbol'), { target: { value: 'BARC' } })

    // Right on the last pane of a stack. There is no neighbour to its right, so
    // the request is read against the one beside it: stand to the right of that,
    // which turns the axis and leaves the order alone. Reaching sideways any
    // other way would have to swap the two panes over to do it.
    fireEvent.keyDown(grip('Trades, pane 2'), { key: 'ArrowRight' })

    expect(tree().shape).toBe('columns(pane-1 pane-2)')
    expect(second().getByLabelText('Filter by symbol')).toHaveValue('BARC')
  })

  it('does nothing for a pane already against the edge it is sent to', () => {
    two()

    // Down on the bottom pane of a stack. It is already there, so the tree is
    // left alone rather than rebuilt to the same shape: a rebuild mints a new
    // split id, which is a React key, and both panes would remount and lose
    // their selection over a keypress that changed nothing.
    fireEvent.click(row('Trades, pane 2', 'TRD-100001') as HTMLElement)
    fireEvent.keyDown(grip('Trades, pane 2'), { key: 'ArrowDown' })

    expect(tree().shape).toBe('rows(pane-1 pane-2)')
    expect(second().getByRole('status')).toHaveTextContent('TRD-100001')
  })

  it('opens on the arrangement in the link, and not on a stack of whatever it holds', () => {
    // The report this came from: a link carried the views and lost the shape, so
    // sending a colleague one pane standing beside another sent them three
    // stacked panes instead.
    address('?panes=3&p1.at=0.0&p2.at=0.1&p3.at=1')
    renderWorkspace()

    expect(tree().shape).toBe('rows(columns(pane-1 pane-2) pane-3)')
  })

  it('opens on the sizes in the link', () => {
    address('?panes=3&p1.size=0.5&p2.size=0.3&p3.size=0.2')
    renderWorkspace()

    // Shares of the window on the way in, weights relative to siblings on the
    // way out, and the point of carrying the first is that it survives the
    // second at any depth.
    expect(tree().shares).toEqual({ 'pane-1': 0.5, 'pane-2': 0.3, 'pane-3': 0.2 })
  })

  it('carries the arrangement back out again', () => {
    // The round trip that matters, driven through the UI rather than through the
    // encoder: nest a pane, move the boundary it arrived on, share, and open
    // what was shared in a workspace that knows nothing about the first one.
    three()
    drag('Trades, pane 3')
    fireEvent.drop(zone(1, 'right'))
    // The inner boundary, which only exists because of the drop: pane-3 is the
    // second pane in drawing order now, so it is the one called pane 2.
    fireEvent.keyDown(
      screen.getByRole('separator', { name: 'Resize Trades against Trades, pane 2' }),
      { key: 'ArrowRight' },
    )
    choose('Trades', 'Share workspace')
    const written = window.location.search

    cleanup()
    address(written)
    renderWorkspace()

    expect(tree().shape).toBe('rows(columns(pane-1 pane-2) pane-3)')
    // A weight is relative to siblings and a share is relative to the window, so
    // only the second can be stated in a link. Both panes inside the split are
    // back on their share of the window, not on their share of the split.
    expect(tree().shares).toEqual({ 'pane-1': 0.3467, 'pane-2': 0.32, 'pane-3': 0.3333 })
  })

  it('leaves the arrangement in the address bar without being asked to', async () => {
    two()
    drag('Trades, pane 2')
    fireEvent.drop(zone(1, 'right'))

    // So a reload comes back side by side. The link carried the arrangement
    // already; what is new is that nobody has to press Share for it.
    await waitFor(() => expect(window.location.search).toBe('?panes=2&axis=columns'))
  })

  /** The edge the preview is drawn for, or null while nothing is aimed at. */
  function aimed(): string | null {
    return document.querySelector('[data-drop-preview]')?.getAttribute('data-drop-preview') ?? null
  }

  it.each(['top', 'bottom', 'left', 'right'])(
    'previews the drop while the pointer is over the %s zone',
    (edge) => {
      two()
      drag('Trades, pane 2')
      fireEvent.dragOver(zone(1, edge))

      // Driven by dragover and not by :hover, which a browser stops updating
      // once a native drag is in progress, so the hover outline this replaced
      // never actually appeared.
      expect(aimed()).toBe(edge)
    },
  )

  it('previews the arrangement rather than the zone under the pointer', () => {
    two()
    // Side by side, then aim at the bottom of the other pane: the drop stacks the
    // two, so the pane lands as a full-width band and not in the bottom third of
    // the pane being aimed at, which is only where the hit test lives.
    fireEvent.keyDown(grip('Trades, pane 2'), { key: 'ArrowRight' })
    expect(tree().shape).toBe('columns(pane-1 pane-2)')

    drag('Trades, pane 2')
    fireEvent.dragOver(zone(1, 'bottom'))

    // One ghost per region, at the axis, order and shares the drop would produce.
    expect(tree('data-ghost').shape).toBe('rows(pane-1 pane-2)')
    expect(tree('data-ghost').shares).toEqual({ 'pane-1': 0.5, 'pane-2': 0.5 })
    expect(document.querySelectorAll('[data-drop-preview]')).toHaveLength(1)
  })

  it('previews a drop that nests, down to the slot it would divide', () => {
    three()
    drag('Trades, pane 3')
    fireEvent.dragOver(zone(1, 'right'))

    // The preview is built by calling the same movedPane the drop calls, so it
    // cannot promise one arrangement and the drop deliver another.
    expect(tree('data-ghost').shape).toBe('rows(columns(pane-1 pane-3) pane-2)')
    expect(tree('data-ghost').shares).toEqual({
      'pane-1': 0.3333,
      'pane-2': 0.3333,
      'pane-3': 0.3333,
    })
  })

  it('previews uneven panes at the shares they keep', () => {
    renderWorkspace()
    choose('Trades', 'Duplicate')
    choose('Trades', 'Duplicate')

    drag('Trades, pane 3')
    fireEvent.dragOver(zone(1, 'top'))

    // A pane carries its share with it when it moves, so the preview has to
    // reorder the shares rather than even them out.
    expect(tree('data-ghost').shape).toBe('rows(pane-2 pane-1 pane-3)')
    expect(tree('data-ghost').shares).toEqual({
      'pane-1': 0.25,
      'pane-2': 0.5,
      'pane-3': 0.25,
    })
  })

  it('moves the preview as the pointer crosses between zones', () => {
    two()
    drag('Trades, pane 2')

    fireEvent.dragOver(zone(1, 'top'))
    fireEvent.dragOver(zone(1, 'left'))

    // One preview, for the zone the pointer is in now. Two at once would be two
    // claims about where a single drop is going.
    expect(document.querySelectorAll('[data-drop-preview]')).toHaveLength(1)
    expect(aimed()).toBe('left')
  })

  it('keeps the preview while the pointer crosses from one zone to the next', () => {
    two()
    drag('Trades, pane 2')
    fireEvent.dragOver(zone(1, 'top'))

    // dragleave bubbles from the zone being left, so the naive handler clears on
    // every crossing and the preview strobes across a pane. Leaving for another
    // zone inside the same pane is not leaving.
    fireEvent.dragLeave(zone(1, 'top'), { relatedTarget: zone(1, 'left') })

    expect(aimed()).toBe('top')
  })

  it('drops the preview when the pointer leaves the pane', () => {
    two()
    drag('Trades, pane 2')
    fireEvent.dragOver(zone(1, 'bottom'))
    fireEvent.dragLeave(zone(1, 'bottom'), { relatedTarget: document.body })

    expect(aimed()).toBeNull()
  })

  it.each([
    ['the drop lands', (edge: string) => fireEvent.drop(zone(1, edge))],
    ['the drag is abandoned', () => fireEvent.dragEnd(grip('Trades, pane 2'))],
  ])('clears the preview once %s', (_case, finish) => {
    two()
    drag('Trades, pane 2')
    fireEvent.dragOver(zone(1, 'top'))
    expect(aimed()).toBe('top')

    finish('top')

    // A preview left on screen after a drag is a pane that looks like it is still
    // moving, drawn over the arrangement that actually resulted.
    expect(aimed()).toBeNull()
  })

  it('puts no drop zones on the pane being dragged', () => {
    two()
    drag('Trades')

    // Dropping a pane on itself is not a move, so there is nothing to aim at.
    expect(document.querySelectorAll('[data-pane="pane-1"][data-drop]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-pane="pane-2"][data-drop]')).toHaveLength(4)

    fireEvent.dragEnd(grip('Trades'))
    expect(document.querySelectorAll('[data-drop]')).toHaveLength(0)
  })
})

describe('a shared workspace', () => {
  /**
   * Two panes that disagree about everything, so nothing can pass by accident:
   * grouped and a column short in the first, filtered and flat in the second.
   * The exact format is the business of the state module and its tests, so this
   * one states the link rather than building it.
   */
  const SHARED =
    '?panes=2' +
    '&p1.group=symbol&p1.sort=-tradeTimestamp&p1.hide=book' +
    '&p2.sort=quantity&p2.where.symbol=BARC&p2.show=tradeId'

  it('opens on the views in the link', () => {
    address(SHARED)
    renderWorkspace()

    expect(panes()).toHaveLength(2)
    expect(first().getByRole('button', { name: 'VOD, 1 trades' })).toBeInTheDocument()
    expect(first().queryByRole('button', { name: 'Book' })).toBeNull()
    expect(row('Trades, pane 2', 'TRD-100001')).toBeNull()
    // The link turns the Trade column on, which the default view has off.
    expect(second().getByText('TRD-100002')).toBeInTheDocument()
  })

  it('falls back to the plain blotter on a link that has been mistyped', () => {
    // The format is readable, so it is editable, so this is the common case
    // rather than the corrupt-payload one. Rendering the default beats rendering
    // nothing, and either beats putting a name that is not a column into table
    // state and half-applying the rest.
    address('?panes=2&p1.group=pnl')
    renderWorkspace()

    expect(panes()).toHaveLength(1)
    expect(row('Trades', 'TRD-100001')).not.toBeNull()
  })

  it('cannot be talked into an empty workspace', () => {
    address('?panes=0')
    renderWorkspace()

    // The schema's floor of one is the same invariant as the missing Close
    // button on the only pane, enforced on the one route that does not go
    // through the UI at all.
    expect(panes()).toHaveLength(1)
  })
})

describe('sharing a workspace', () => {
  const copied: string[] = []

  beforeEach(() => {
    copied.length = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text)
          return Promise.resolve()
        },
      },
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('copies a link to what is on screen now, not to what it opened on', async () => {
    renderWorkspace()

    choose('Trades', 'Config')
    fireEvent.change(first().getByLabelText('Group by'), { target: { value: 'book' } })
    choose('Trades', 'Duplicate')
    fireEvent.change(second().getByLabelText('Filter by trader'), { target: { value: 'k.m' } })

    choose('Trades', 'Share workspace')
    expect(await screen.findByText('Link copied')).toBeInTheDocument()

    // Each pane reports its own view out, so the link describes both of them
    // without the workspace ever holding either one's state.
    const link = copied[0] ?? ''
    const shared = decodeWorkspace(new URL(link).searchParams)
    expect(shared?.views).toHaveLength(2)
    expect(shared?.views[0]?.grouping).toEqual(['book'])
    expect(shared?.views[1]?.columnFilters).toEqual([{ id: 'trader', value: 'k.m' }])
  })

  it('shares the workspace from a pane, and says which it means', async () => {
    renderWorkspace()
    choose('Trades', 'Duplicate')

    // Named in the menu, because an unqualified Share sitting in one pane's own
    // controls could not say whether it meant that pane or all of them. What it
    // copies is the same link the strip's button copies, both panes and all.
    choose('Trades', 'Share workspace')
    expect(await screen.findByText('Link copied')).toBeInTheDocument()

    expect(decodeWorkspace(new URL(copied[0] ?? '').searchParams)?.views).toHaveLength(2)
  })

  it('leaves the link in the address bar as well as on the clipboard', async () => {
    renderWorkspace()
    choose('Trades', 'Share workspace')
    await screen.findByText('Link copied')

    expect(window.location.href).toBe(copied[0])
  })

  it('says so rather than failing quietly when the clipboard refuses', async () => {
    // The clipboard API needs a secure context, and a copy that silently does
    // nothing is worse than one that tells you where the link is.
    Reflect.deleteProperty(navigator, 'clipboard')
    renderWorkspace()

    choose('Trades', 'Share workspace')
    expect(await screen.findByText(/the link is in the address bar/)).toBeInTheDocument()
    // Told where it is, and now able to read it when they get there, which is
    // most of what makes that message a usable fallback rather than an apology.
    expect(window.location.search).toContain('panes=1')
  })
})

describe('the address bar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('follows a pane being opened, so a reload comes back to the same workspace', async () => {
    renderWorkspace()
    openPane('EU Flow')

    await waitFor(() => expect(window.location.search).toBe('?panes=2&p2.name=EU+Flow'))

    // The defect this answers, as a reload: a second workspace that knows
    // nothing about the first, reading the bar the first one left. What came
    // back before was whatever the last Share wrote, so a pane opened after it
    // was simply gone.
    cleanup()
    renderWorkspace()

    expect(panes()).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'EU Flow' })).toBeInTheDocument()
  })

  it('follows a view once the typing stops, rather than once per keystroke', async () => {
    renderWorkspace()
    const writes = vi.spyOn(window.history, 'replaceState')

    for (const value of ['V', 'VO', 'VOD']) {
      fireEvent.change(first().getByLabelText('Filter by symbol'), { target: { value } })
    }

    await waitFor(() => expect(window.location.search).toBe('?panes=1&p1.where.symbol=VOD'))
    // replaceState is rate limited by browsers, so the debounce is the reason
    // this is safe to do on a filter box rather than a tidiness.
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it('says nothing on arrival, so a link that did not parse survives being read', async () => {
    address('?panes=2&p1.group=pnl')
    renderWorkspace()
    await settled()

    // On arrival the bar is the source rather than the record. Rewriting it into
    // the canonical form of itself would throw away the only copy of what
    // somebody typed, which for a link that does not parse is the thing they
    // need to be looking at.
    expect(window.location.search).toBe('?panes=2&p1.group=pnl')
  })

  it('leaves no write behind to land in the next workspace', async () => {
    renderWorkspace()
    openPane('EU Flow')
    cleanup()
    address('?panes=3')
    await settled()

    // A write in flight outlives the component that scheduled it, and the one it
    // would land on is whatever is on screen by then.
    expect(window.location.search).toBe('?panes=3')
  })
})
