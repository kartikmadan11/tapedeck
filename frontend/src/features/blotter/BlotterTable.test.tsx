import type { Trade } from '@tapedeck/shared'
import { BLOTTER_LIMIT, COUNTERPARTIES, trade as tradeSchema } from '@tapedeck/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaneConfig } from '../workspace/paneConfig.js'
import { DEFAULT_VIEW } from '../workspace/paneConfig.js'
import { SHAREABLE_COLUMNS } from '../workspace/state.js'
import { BlotterTable } from './BlotterTable.js'

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

/**
 * One book, arranged so the netting is checkable by hand:
 *
 *   net quantity   10,000 - 4,000               =      6,000
 *   net filled      6,000 - 4,000               =      2,000
 *   net notional   724,650.00 - 292,400.00      = 432,250.00
 *   vwap           1,017,050 / 14,000           =    72.6464
 *
 * The buy is half executed and the sell is done, so the filled net is its own
 * figure. The cancelled leg is 5,000 at 70, big enough to move all four.
 */
const BOOK = [
  aTrade({ filledQuantity: 6_000, status: 'PARTIALLY_FILLED' }),
  aTrade({
    tradeId: 'TRD-100002',
    side: 'SELL',
    quantity: 4_000,
    filledQuantity: 4_000,
    price: '73.100000',
    status: 'FILLED',
    tradeTimestamp: '2026-10-02T09:16:00.000Z',
  }),
  aTrade({
    tradeId: 'TRD-100003',
    quantity: 5_000,
    price: '70.000000',
    status: 'CANCELLED',
    tradeTimestamp: '2026-10-02T09:17:00.000Z',
  }),
  aTrade({
    tradeId: 'TRD-100004',
    symbol: 'BARC',
    quantity: 1_000,
    price: '2.500000',
    book: 'EQ-LDN-02',
    tradeTimestamp: '2026-10-02T09:14:00.000Z',
  }),
]

function renderBlotter(trades: Trade[] = BOOK, config?: PaneConfig) {
  const actions = { onAmend: vi.fn(), onCancel: vi.fn(), onHistory: vi.fn() }
  /** Every view the pane has reported out, so a case can read the last one. */
  const reported: PaneConfig[] = []
  render(
    <BlotterTable
      actions={actions}
      initialConfig={config}
      onConfigChange={(view) => reported.push(view)}
      pendingIds={new Set()}
      trades={trades}
    />,
  )
  return { ...actions, reported }
}

/** A trade's row, by the id it carries: the Trade column is off by default. */
function row(tradeId: string): HTMLElement | null {
  return document.querySelector(`tr[data-trade-id="${tradeId}"]`)
}

function tradeRow(tradeId: string): HTMLElement {
  const found = row(tradeId)
  if (found === null) {
    throw new Error(`no row for ${tradeId}`)
  }
  return found
}

/** Notional's index with the Trade column off: symbol, side, price, quantity,
 *  filled, notional, ... */
const NOTIONAL = 5

/** Every heading on screen, with the sort marker stripped. */
function headers(): string[] {
  return Array.from(document.querySelectorAll('th')).map((cell) =>
    (cell.textContent ?? '').replace(/[↑↓]/, ''),
  )
}

/** The grid as it opens: every column but the trade id and the version. */
const UNGROUPED = [
  'Symbol',
  'Side',
  'Price',
  'Quantity',
  'Filled',
  'Notional',
  'Trader',
  'Book',
  'Counterparty',
  'Status',
  'Time (UTC)',
]

/** What a group row can answer for, and so what grouping leaves on screen. */
const NETTED = ['Price', 'Quantity', 'Filled', 'Notional']

/** The pane itself, which is what carries its own menu. */
const paneRegion = (): HTMLElement => screen.getByRole('region', { name: 'Trades' })

/** Pointer down first, as a browser fires them: that is what closes a menu which
 *  is already open. */
function choose(item: string): void {
  const region = paneRegion()
  fireEvent.pointerDown(region)
  fireEvent.contextMenu(region)
  fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

const openConfig = (): void => choose('Config')

/** Writes either kind of control. A picklist is a button and a list rather than a
 *  native select, so setting one is two presses. */
function set(label: string, value: string): void {
  const control = screen.getByLabelText(label)
  if (control.getAttribute('role') !== 'combobox') {
    fireEvent.change(control, { target: { value } })
    return
  }
  fireEvent.click(control)
  fireEvent.click(option(label, value))
}

/** One row of an open list, by the value it carries rather than by its label.
 *  The list is portaled, so it is reached through the screen. */
function option(label: string, value: string): HTMLElement {
  const found = screen
    .getByRole('listbox', { name: label })
    .querySelector(`[role="option"][data-value="${value}"]`)
  if (!(found instanceof HTMLElement)) {
    throw new Error(`${label} does not offer ${value === '' ? 'a blank' : value}`)
  }
  return found
}

/** The group's own row, found by the toggle that opens it. */
function groupRow(name: string): HTMLElement {
  const row = screen.getByRole('button', { name }).closest('tr')
  if (row === null) {
    throw new Error(`no row for the ${name} group`)
  }
  return row
}

/** Every cell of a row, in column order. */
function cells(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent ?? '')
}

const readback = (): HTMLElement => screen.getByRole('status')

/** The magnitude bar behind a trade's notional, which carries no text of its own. */
function bar(tradeId: string): HTMLElement {
  const cell = tradeRow(tradeId).querySelectorAll('td')[NOTIONAL]
  const drawn = cell?.querySelector('span[aria-hidden]')
  if (!(drawn instanceof HTMLElement)) {
    throw new Error(`no magnitude bar on ${tradeId}`)
  }
  return drawn
}

describe('grouping and aggregation', () => {
  it('shows only the columns a group can answer for', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    // A group has no one counterparty and no one timestamp to show.
    expect(headers()).toEqual(['Symbol', ...NETTED])
  })

  it('nets a group exactly', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    expect(cells(groupRow('VOD, 2 trades'))).toEqual([
      // Label, expander and active leaf count, all on the grouped column.
      '▸VOD(2)',
      '72.6464',
      '6,000',
      '2,000',
      '432,250.00',
    ])
  })

  it('gives the columns back when the grouping is cleared', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')
    set('Group by', '')

    // Derived from the grouping, so there is nothing left behind to undo.
    expect(headers()).toEqual(UNGROUPED)
  })

  it('drops a column the trader turned on, without reporting it as hidden', () => {
    const { reported } = renderBlotter()
    openConfig()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trade' }))
    expect(headers()[0]).toBe('Trade')

    set('Group by', 'symbol')
    expect(headers()).toEqual(['Symbol', ...NETTED])

    // The shared link carries the column the trader asked for, not the eight the
    // grouping took away, which resolving the updater against table state would
    // bake in.
    expect(reported.at(-1)?.columnVisibility).toEqual({ tradeId: true, version: false })

    set('Group by', '')
    expect(headers()[0]).toBe('Trade')
  })

  it('shows a column the trader had hidden, once the grid is grouped by it', () => {
    renderBlotter()
    openConfig()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book' }))
    expect(screen.queryByText('EQ-LDN-01')).toBeNull()

    set('Group by', 'book')

    // It carries the label and the expander, so hidden groups could not be opened.
    expect(screen.getByRole('button', { name: 'EQ-LDN-01, 2 trades' })).toBeInTheDocument()
    expect(headers()).toEqual(['Book', ...NETTED])
  })

  it('nets what the filter left, in a column it no longer shows', () => {
    renderBlotter([
      aTrade({ quantity: 10_000, price: '10.000000' }),
      aTrade({ tradeId: 'TRD-100002', trader: 'j.okonkwo', quantity: 3_000, price: '10.000000' }),
    ])
    set('Filter by trader', 'k.madan')
    openConfig()
    set('Group by', 'symbol')

    // Hidden, not taken out of the table: TanStack silently skips a filter whose
    // column it cannot resolve, and this figure would become everybody's flow.
    expect(headers()).toEqual(['Symbol', ...NETTED])
    expect(cells(groupRow('VOD, 1 trade'))[2]).toBe('10,000')
  })

  it('leaves cancelled trades out of the netting', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    // Netting the cancelled 5,000 at 70 would move the count to 3 and every figure.
    fireEvent.click(screen.getByRole('button', { name: 'VOD, 2 trades' }))
    expect(row('TRD-100003')).not.toBeNull()
    expect(cells(groupRow('VOD, 2 trades'))[2]).toBe('6,000')
  })

  it('reports a net short in the sell colour, as the positions panel does', () => {
    renderBlotter([
      aTrade({ side: 'SELL', quantity: 10_000, price: '10.000000' }),
      aTrade({ tradeId: 'TRD-100002', quantity: 4_000, price: '10.000000' }),
    ])
    openConfig()
    set('Group by', 'symbol')

    const row = groupRow('VOD, 2 trades')
    expect(within(row).getByText('-6,000')).toHaveClass('text-tape-sell')
    expect(within(row).getByText('-60,000.00')).toHaveClass('text-tape-sell')
  })

  it('has no average price to report for a group of nothing but cancellations', () => {
    renderBlotter([aTrade({ status: 'CANCELLED' })])
    openConfig()
    set('Group by', 'symbol')

    // A dash, not 0.0000: a zero average is a claim about where the book traded.
    expect(cells(groupRow('VOD, 0 trades'))[1]).toBe('-')
  })

  it('blanks the grouped column on the rows beneath it, not the group row', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')
    fireEvent.click(screen.getByRole('button', { name: 'VOD, 2 trades' }))

    // The symbol is on the group row above, so repeating it is a column of one word.
    const leaf = tradeRow('TRD-100001')
    expect(cells(leaf)[0]).toBe('')
    expect(cells(leaf)[2]).toBe('10,000')
  })
})

describe('a split pivots the measures across the grid', () => {
  /** Group by symbol, then one block of measures per side. */
  function splitBySide(): void {
    openConfig()
    set('Group by', 'symbol')
    set('Split by', 'side')
  }

  it('lays the blocks across the columns rather than down the rows', () => {
    renderBlotter()
    splitBySide()

    // Two bands. The first cell of the top band is empty: Symbol's heading belongs
    // on the band with the measures.
    expect(headers()).toEqual(['', 'BUY', 'SELL', 'Symbol', ...NETTED, ...NETTED])
    expect(document.querySelectorAll('colgroup col')).toHaveLength(9)
  })

  it('spans a block heading over the measures it names', () => {
    renderBlotter()
    splitBySide()

    // Without the colSpan the heading reads as a figure about one column.
    expect(screen.getByRole('columnheader', { name: 'BUY' })).toHaveAttribute('colspan', '4')
  })

  it('nets each block over its own trades alone', () => {
    renderBlotter()
    splitBySide()

    // Each block alone, not the 6,000 the two read as together. The cancelled buy
    // is out of both.
    expect(cells(groupRow('VOD, 2 trades'))).toEqual([
      '▸VOD(2)',
      '72.4650',
      '10,000',
      '6,000',
      '724,650.00',
      '73.1000',
      '-4,000',
      '-4,000',
      '-292,400.00',
    ])
  })

  it('leaves a trade blank in every block but its own', () => {
    renderBlotter()
    splitBySide()
    fireEvent.click(screen.getByRole('button', { name: 'VOD, 2 trades' }))

    // A buy reports under BUY and says nothing under SELL.
    expect(cells(tradeRow('TRD-100001'))).toEqual([
      '',
      '72.4650',
      '10,000',
      '6,000',
      '724,650.00',
      '',
      '',
      '',
      '',
    ])
  })

  it('takes the blocks off the book rather than off the filter', () => {
    renderBlotter()
    splitBySide()
    set('Filter by side', 'BUY')

    // Off the filtered rows, a keystroke would take columns out from under the
    // cursor. The block stays and reports nothing.
    expect(headers().slice(1, 3)).toEqual(['BUY', 'SELL'])
    expect(cells(groupRow('VOD, 1 trade')).slice(-4)).toEqual(['-', '0', '0', '0.00'])
  })

  it('caps how many blocks a split lays across the grid', () => {
    renderBlotter(
      COUNTERPARTIES.map((counterparty, index) =>
        aTrade({ tradeId: `TRD-10000${index}`, counterparty }),
      ),
    )
    openConfig()
    set('Group by', 'symbol')
    set('Split by', 'counterparty')

    // Ten names would be forty columns. Capped in sorted order, so the two left
    // out are the same two on every frame. Symbol trailing is what says it held.
    expect(headers().slice(1, 10)).toEqual([
      'BNP Paribas',
      'Barclays',
      'Citadel Securities',
      'Deutsche Bank',
      'Goldman Sachs',
      'HSBC',
      'JP Morgan',
      'Jane Street',
      'Symbol',
    ])
  })

  it('leaves a block out of the sort, since one block cannot reorder the rows', () => {
    renderBlotter()
    splitBySide()

    // Sorting the buy block would reorder rows the sell block also describes.
    expect(screen.queryAllByRole('button', { name: 'Price' })).toHaveLength(0)
  })

  it('counts both header bands when it numbers the rows', () => {
    renderBlotter()
    splitBySide()

    // Numbered off the band count, or a split puts a group on top of a header row.
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '4')
    expect(groupRow('VOD, 2 trades')).toHaveAttribute('aria-rowindex', '3')
  })

  it('ignores a split on a column that cannot divide the tape', () => {
    renderBlotter(BOOK, { ...DEFAULT_VIEW, grouping: ['symbol', 'price'] })

    // Only a hand-edited link can ask for this. A block per price is a block per
    // trade, so the grid falls back to the plain grouping.
    expect(headers()).toEqual(['Symbol', ...NETTED])
  })
})

describe('a group row is not a trade', () => {
  it('refuses to select one, so Amend cannot land on an arbitrary leaf', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    const row = groupRow('VOD, 2 trades')
    fireEvent.click(row)

    // TanStack builds a group row from its first leaf, so a selectable header
    // would hand the bar a real trade and offer to amend it.
    expect(readback()).toBeEmptyDOMElement()
    // The click was not swallowed, it opened the group.
    expect(screen.getByRole('button', { name: 'VOD, 2 trades' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('opens and closes on the expander without the row behind it undoing the toggle', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    const toggle = (): HTMLElement => screen.getByRole('button', { name: 'VOD, 2 trades' })
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('steps the arrow keys over group rows', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    const grid = screen.getByRole('grid')

    // Everything is closed, so there is no trade to move to.
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(readback()).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: 'VOD, 2 trades' }))
    fireEvent.keyDown(grid, { key: 'ArrowDown' })

    // The first trade under the VOD group is the newest, by the default order.
    expect(readback()).toHaveTextContent('TRD-100003')
  })
})

describe('virtualisation', () => {
  /** A full window's worth, which is what the blotter is bounded to. */
  const TAPE = Array.from({ length: 500 }, (_, index) =>
    aTrade({
      tradeId: `TRD-${100_001 + index}`,
      tradeTimestamp: new Date(Date.UTC(2026, 9, 2, 9, 0, 0) + index * 1_000).toISOString(),
    }),
  )

  it('draws the rows that fit rather than the whole tape', () => {
    renderBlotter(TAPE)

    // The header, the twenty that fit in the shimmed 640px, and the overscan.
    expect(screen.getAllByRole('row').length).toBeLessThan(60)
  })

  it('still reports the whole tape rather than the part of it drawn', () => {
    renderBlotter(TAPE)

    // Would otherwise describe the window instead of the book.
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '501')
  })

  it('numbers each drawn row by its place in the tape, not in the window', () => {
    renderBlotter(TAPE)

    // Newest first, so the top row is the last trade of the five hundred.
    expect(tradeRow('TRD-100500')).toHaveAttribute('aria-rowindex', '2')
  })

  it('keeps the colgroup in step with the visible columns', () => {
    renderBlotter()
    openConfig()

    // Fixed layout takes the widths from here, so a stale colgroup shifts columns.
    const widths = (): number => document.querySelectorAll('colgroup col').length
    expect(widths()).toBe(11)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Book' }))
    expect(widths()).toBe(10)
  })
})

describe('magnitude bars', () => {
  /** 100,000 against 50,000, so the proportion is readable without a calculator. */
  const TWO_SIZES = [
    aTrade({ quantity: 10_000, price: '10.000000' }),
    aTrade({ tradeId: 'TRD-100002', symbol: 'BARC', quantity: 5_000, price: '10.000000' }),
  ]

  it('draws each notional as a proportion of the largest on the tape', () => {
    renderBlotter(TWO_SIZES)

    expect(bar('TRD-100001')).toHaveStyle({ width: '100%' })
    expect(bar('TRD-100002')).toHaveStyle({ width: '50%' })
  })

  it('rescales with the filter, so the bars measure what is on screen', () => {
    renderBlotter(TWO_SIZES)

    // Scaled against the whole book, a filtered tape shows only unreadable bars.
    fireEvent.change(screen.getByLabelText('Filter by symbol'), { target: { value: 'BARC' } })
    expect(bar('TRD-100002')).toHaveStyle({ width: '100%' })
  })

  it('keeps the figure legible on top of the bar', () => {
    renderBlotter(TWO_SIZES)

    // An overlay on a transparent cell, not a background: that is what leaves
    // hover, the selection and the row flash able to reach it.
    const cell = tradeRow('TRD-100001').querySelectorAll('td')[NOTIONAL]
    expect(cell).toHaveTextContent('100,000.00')
    expect(cell?.className).not.toMatch(/\bbg-/)
  })
})

describe('the configuration panel', () => {
  it('keeps its controls out of the tab order while it is closed', () => {
    renderBlotter()

    // Without inert, Tab out of the grid lands in an invisible select.
    expect(screen.getByLabelText('Group by').closest('[inert]')).not.toBeNull()

    openConfig()
    expect(screen.getByLabelText('Group by').closest('[inert]')).toBeNull()
  })

  it('offers nothing to split by until there is a level to split', () => {
    renderBlotter()
    openConfig()

    expect(screen.getByLabelText('Split by')).toBeDisabled()
    set('Group by', 'symbol')
    expect(screen.getByLabelText('Split by')).toBeEnabled()

    // A block per symbol inside a group per symbol is one block.
    fireEvent.click(screen.getByLabelText('Split by'))
    const offered = within(screen.getByRole('listbox', { name: 'Split by' })).getAllByRole('option')
    expect(offered.map((row) => row.getAttribute('data-value'))).not.toContain('symbol')
  })

  it('clears the split when the level it sits under goes away', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')
    set('Split by', 'book')
    set('Group by', '')

    // A split is blocks laid across a group row, so it needs one to lie across.
    expect(screen.getByLabelText('Split by')).toHaveAttribute('data-value', '')
    expect(row('TRD-100001')).not.toBeNull()
  })

  it('shares one sort with the column headers', () => {
    renderBlotter()
    openConfig()

    // The grid opens sorted on time, so the panel has to say so.
    expect(screen.getByLabelText('Order by')).toHaveAttribute('data-value', 'tradeTimestamp')
    expect(screen.getByRole('button', { name: 'Desc' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Quantity' }))
    expect(screen.getByLabelText('Order by')).toHaveAttribute('data-value', 'quantity')
  })

  it('carries the direction across a change of column', () => {
    renderBlotter()
    openConfig()

    fireEvent.click(screen.getByRole('button', { name: 'Desc' }))
    expect(screen.getByRole('button', { name: 'Asc' })).toBeInTheDocument()

    // Snapping back to descending would reorder the tape unasked.
    set('Order by', 'quantity')
    expect(screen.getByRole('button', { name: 'Asc' })).toBeInTheDocument()
  })

  it('hides a column', () => {
    renderBlotter()
    openConfig()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Book' }))
    expect(screen.queryByText('EQ-LDN-01')).not.toBeInTheDocument()
  })

  it('keeps the trade id off the tape until it is asked for', () => {
    renderBlotter()
    openConfig()

    // The row is on the tape, its id is not on screen. Turning it on pins it first.
    expect(row('TRD-100001')).not.toBeNull()
    expect(screen.queryByText('TRD-100001')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Trade' }))
    expect(cells(tradeRow('TRD-100001'))[0]).toBe('TRD-100001')
  })

  it('refuses to hide the last column standing', () => {
    renderBlotter(BOOK, {
      sorting: [],
      columnFilters: [],
      grouping: [],
      columnVisibility: Object.fromEntries(
        SHAREABLE_COLUMNS.filter((id) => id !== 'symbol').map((id) => [id, false]),
      ),
      columnOrder: [],
    })
    openConfig()

    // A grid with no columns at all would leave this panel the only way back.
    expect(screen.getByRole('checkbox', { name: 'Symbol' })).toBeDisabled()
  })

  it('refuses to hide the column the grid is currently grouped by', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    // Hiding it would leave the group rows labelled by nothing but a count.
    expect(screen.getByRole('checkbox', { name: 'Symbol' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Symbol' })).toBeChecked()
    // A column that nets is still the trader's to turn off.
    expect(screen.getByRole('checkbox', { name: 'Notional' })).toBeEnabled()
  })

  it('offers no column the grouping has taken off the grid', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    // The grid reads these boxes through the grouping's override, so a tick would
    // do nothing.
    const book = screen.getByRole('checkbox', { name: 'Book' })
    expect(book).toBeDisabled()
    expect(book).not.toBeChecked()
    expect(screen.getByText(/only the columns a group nets/)).toBeInTheDocument()
  })

  it('moves a column along the grid', () => {
    const { reported } = renderBlotter()
    openConfig()

    fireEvent.click(screen.getByRole('button', { name: 'Move Status up' }))

    // Up in the list is left on the grid, which is what the panel says it is.
    expect(headers()).toEqual([
      'Symbol',
      'Side',
      'Price',
      'Quantity',
      'Filled',
      'Notional',
      'Trader',
      'Book',
      'Status',
      'Counterparty',
      'Time (UTC)',
    ])
    // Written out in full: a partial order reads the columns it leaves out as last.
    expect(reported.at(-1)?.columnOrder).toEqual([
      'tradeId',
      'symbol',
      'side',
      'price',
      'quantity',
      'filledQuantity',
      'notional',
      'trader',
      'book',
      'status',
      'counterparty',
      'version',
      'tradeTimestamp',
    ])
  })

  it('will not move a column off either end', () => {
    renderBlotter()
    openConfig()

    expect(screen.getByRole('button', { name: 'Move Trade up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Time (UTC) down' })).toBeDisabled()
  })

  it('keeps a hidden column in the order, so turning it on puts it back', () => {
    renderBlotter()
    openConfig()

    // Ver is off by default and still listed, so it can be placed unseen.
    fireEvent.click(screen.getByRole('button', { name: 'Move Ver up' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ver' }))

    expect(headers().slice(-3)).toEqual(['Ver', 'Status', 'Time (UTC)'])
  })

  it('opens on the order a link gives it', () => {
    renderBlotter(BOOK, {
      ...DEFAULT_VIEW,
      columnOrder: ['status', 'symbol'],
    })

    // Named first, then the rest in definition order.
    expect(headers().slice(0, 3)).toEqual(['Status', 'Symbol', 'Side'])
  })

  it('leaves a grouping to lead with its own column whatever the order says', () => {
    renderBlotter(BOOK, { ...DEFAULT_VIEW, columnOrder: ['notional', 'price'] })
    openConfig()
    set('Group by', 'symbol')

    // The label and the expander ride the grouped column, so it leads the row.
    expect(headers()).toEqual(['Symbol', 'Notional', 'Price', 'Quantity', 'Filled'])
  })

  it('filters on a floor the top bar does not offer', () => {
    renderBlotter()
    openConfig()

    set('Minimum quantity', '5000')
    expect(row('TRD-100001')).not.toBeNull()
    expect(row('TRD-100004')).toBeNull()

    // Half typed is not zero: an emptied grid would read as no matches.
    set('Minimum quantity', '')
    expect(row('TRD-100004')).not.toBeNull()
  })

  it('filters a decimal floor by value rather than by text', () => {
    renderBlotter()
    openConfig()

    // As text, 2,500.00 compares above 724,650.00, which is the trap here.
    set('Minimum notional', '3000')
    expect(row('TRD-100001')).not.toBeNull()
    expect(row('TRD-100004')).toBeNull()
  })

  it('hides from a button on the panel, not only from the right-click menu', () => {
    renderBlotter()
    openConfig()
    expect(screen.getByRole('combobox', { name: 'Group by' })).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))

    // Mounted either way, so the question is whether it is reachable.
    expect(screen.queryByRole('combobox', { name: 'Group by' })).toBeNull()
  })

  it('puts focus on the grid, since the panel it was pressed in goes inert', () => {
    renderBlotter()
    openConfig()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))

    expect(screen.getByRole('grid')).toHaveFocus()
  })
})

describe('the filters suggest what is on the tape', () => {
  /** The values a box offers, read through the list it actually points at. */
  function offered(label: string): string[] {
    const box = screen.getByLabelText(label)
    const list = document.getElementById(box.getAttribute('list') ?? '')
    return Array.from(list?.querySelectorAll('option') ?? []).map((option) => option.value)
  }

  it('offers the symbols, traders and books the pane holds', () => {
    renderBlotter()

    expect(offered('Filter by symbol')).toEqual(['BARC', 'VOD'])
    expect(offered('Filter by book')).toEqual(['EQ-LDN-01', 'EQ-LDN-02'])
    expect(offered('Filter by trader')).toEqual(['k.madan'])
  })

  it('leaves the box free text, so a part of a value still filters', () => {
    renderBlotter()

    // Why a datalist and not a select: LDN-02 is nobody's book.
    fireEvent.change(screen.getByLabelText('Filter by book'), { target: { value: 'LDN-02' } })

    expect(row('TRD-100004')).not.toBeNull()
    expect(row('TRD-100001')).toBeNull()
  })

  it('gives each pane its own lists, so two panes cannot share one id', () => {
    renderBlotter()
    renderBlotter([aTrade({ symbol: 'HSBA' })])

    const ids = screen.getAllByLabelText('Filter by symbol').map((box) => box.getAttribute('list'))

    expect(new Set(ids).size).toBe(2)
    // A shared id would have both boxes offering the first pane's symbols.
    expect(ids.map((id) => document.getElementById(id ?? '')?.children.length)).toEqual([2, 1])
  })
})

describe("a pane's own menu", () => {
  /** The positioned sheet, which is the menu's parent: the coordinates are set on
   *  it, so the menu's own children are all items. */
  const sheet = (): HTMLElement | null => screen.queryByRole('menu')?.parentElement ?? null

  /** Returns false when the event was cancelled, which is the preventDefault. */
  const rightClick = (init: object = {}): boolean => fireEvent.contextMenu(paneRegion(), init)

  it('opens where the pointer was rather than where the pane is', () => {
    renderBlotter()
    rightClick({ clientX: 420, clientY: 160 })

    // Unclamped: the clamp needs a measured box and jsdom has no layout.
    expect(sheet()).toHaveStyle({ left: '420px', top: '160px' })
  })

  it('opens at the pane when the menu came from the keyboard', () => {
    renderBlotter()
    const region = paneRegion()
    region.getBoundingClientRect = (): DOMRect => ({ ...new DOMRect(), left: 240, top: 300 })

    // Shift-F10 and the menu key raise a contextmenu carrying no coordinates.
    rightClick()
    expect(sheet()).toHaveStyle({ left: '248px', top: '308px' })
  })

  it('leaves the browser its own menu when shift is held', () => {
    renderBlotter()

    // Otherwise the grid takes away view source, inspect and the spell checker.
    expect(rightClick({ shiftKey: true })).toBe(true)
    expect(sheet()).toBeNull()

    expect(rightClick()).toBe(false)
    expect(sheet()).not.toBeNull()
  })

  it('leaves a box someone is typing in its own menu', () => {
    renderBlotter()

    // Cut, copy and paste belong to the field.
    const box = screen.getByLabelText('Filter by symbol')
    expect(fireEvent.contextMenu(box)).toBe(true)
    expect(sheet()).toBeNull()
  })

  it('steps the arrow keys over the items that are refused', () => {
    renderBlotter()
    rightClick()

    // With no workspace and no row picked, seven of the nine items are refused.
    const menu = screen.getByRole('menu')
    expect(screen.getByRole('menuitem', { name: 'Config' })).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Reset' })).toHaveFocus()

    // Wraps past the seven refused rather than stopping on one.
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Config' })).toHaveFocus()
  })

  it('closes on escape, and choosing nothing is not a choice', () => {
    renderBlotter()
    rightClick()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    expect(sheet()).toBeNull()
    // Mounted either way, so the question is whether it is reachable.
    expect(screen.queryByRole('combobox', { name: 'Group by' })).toBeNull()
  })

  it('closes when a click lands outside it', () => {
    renderBlotter()
    rightClick()
    fireEvent.pointerDown(document.body)

    expect(sheet()).toBeNull()
  })

  it('says the config is open, since the panel outlives the menu', () => {
    renderBlotter()
    openConfig()
    rightClick()

    // The menu closes on the press, so the item is what carries it.
    const item = screen.getByRole('menuitem', { name: 'Hide config' })
    expect(item).toHaveAttribute('aria-expanded', 'true')

    // And which thing, since the sheet is portaled away from the panel.
    const controlled = document.getElementById(item.getAttribute('aria-controls') ?? '')
    expect(controlled).toContainElement(screen.getByRole('combobox', { name: 'Group by' }))
  })

  it('puts the view back the way the pane opened, and no more than that', () => {
    renderBlotter()
    openConfig()

    fireEvent.click(screen.getByRole('button', { name: 'Quantity' }))
    set('Minimum quantity', '2000')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book' }))
    set('Group by', 'symbol')

    choose('Reset')

    // All four at once: a Reset that cleared three is worse than none.
    expect(headers()).toEqual(UNGROUPED)
    expect(row('TRD-100004')).not.toBeNull()
    expect(screen.getByLabelText('Order by')).toHaveAttribute('data-value', 'tradeTimestamp')
    expect(screen.getByRole('button', { name: 'Desc' })).toBeInTheDocument()

    // Still open: Reset is the view and not the pane.
    expect(screen.getByRole('combobox', { name: 'Group by' })).toHaveAttribute('data-value', '')
  })
})

describe("a trade's own items in the menu", () => {
  /** Raised on a row, so the menu has a trade to be about. */
  function rightClickRow(tradeId: string): void {
    const node = tradeRow(tradeId)
    fireEvent.pointerDown(node)
    fireEvent.contextMenu(node)
  }

  const item = (name: string): HTMLElement => screen.getByRole('menuitem', { name })

  it('picks the row it was raised on, so the items are about that trade', () => {
    const { onAmend } = renderBlotter()
    rightClickRow('TRD-100004')

    // The rail agrees with the menu, which is the point of picking it first.
    expect(screen.getByRole('status')).toHaveTextContent('BARC')

    fireEvent.click(item('Amend trade'))
    expect(onAmend).toHaveBeenCalledWith(expect.objectContaining({ tradeId: 'TRD-100004' }))
  })

  it('carries the key that does the same thing from the grid', () => {
    renderBlotter()
    rightClickRow('TRD-100004')

    // On the item, not in its label, so it is not read as part of the name.
    expect(item('Amend trade')).toHaveAttribute('aria-keyshortcuts', 'a')
    expect(item('Cancel trade')).toHaveAttribute('aria-keyshortcuts', 'c')
    expect(item('Trade history')).toHaveAttribute('aria-keyshortcuts', 'h')
  })

  it('refuses all three while no row is picked', () => {
    renderBlotter()
    fireEvent.contextMenu(paneRegion())

    // Refused, not left out, so the pane's own items below do not move.
    expect(item('Amend trade')).toBeDisabled()
    expect(item('Cancel trade')).toBeDisabled()
    expect(item('Trade history')).toBeDisabled()
  })

  it('refuses the writes on a cancelled trade and still offers its history', () => {
    renderBlotter()
    rightClickRow('TRD-100003')

    // The same canWrite rule the chips and the keys enforce.
    expect(item('Amend trade')).toBeDisabled()
    expect(item('Cancel trade')).toBeDisabled()
    expect(item('Trade history')).toBeEnabled()
  })

  it('leaves the selection alone for a right-click off a row', () => {
    renderBlotter()
    fireEvent.click(tradeRow('TRD-100004'))
    fireEvent.contextMenu(paneRegion())

    // The menu is still about the picked trade, so the items stay offered.
    expect(screen.getByRole('status')).toHaveTextContent('BARC')
    expect(item('Amend trade')).toBeEnabled()
  })
})

describe('the rail under the tape', () => {
  it('says what the pane is holding while no row is picked', () => {
    renderBlotter()

    expect(screen.getByText('4 trades')).toBeVisible()
  })

  it('counts what the filter left, against what the pane was handed', () => {
    renderBlotter()
    fireEvent.change(screen.getByLabelText('Filter by symbol'), { target: { value: 'BARC' } })

    expect(screen.getByText(/^1 of 4 trades/)).toBeVisible()
  })

  it('counts the leaves rather than the group rows', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    // Two groups over four trades: a count of the rows on screen would say two.
    expect(screen.getByText(/^4 trades/)).toBeVisible()
  })

  it('gives the line up to the trade once a row is picked', () => {
    renderBlotter()
    fireEvent.click(tradeRow('TRD-100004'))

    expect(screen.queryByText('4 trades')).toBeNull()
    expect(screen.getByRole('button', { name: 'Amend' })).toBeInTheDocument()
  })

  /** A full window, which is what the pane holds in any running instance. */
  const FULL = Array.from({ length: BLOTTER_LIMIT }, (_, index) =>
    aTrade({ tradeId: `TRD-2${String(index).padStart(5, '0')}` }),
  )

  it('calls a full window the latest, not a count of the book', () => {
    renderBlotter(FULL)

    // Booking a trade cannot move this figure: a row arrives at the top and the
    // oldest leaves the bottom. '500 trades' would read as a book that stopped.
    expect(screen.getByText(`latest ${BLOTTER_LIMIT} trades`)).toBeVisible()
  })

  it('counts the filter against the window it filtered', () => {
    renderBlotter([...FULL.slice(1), aTrade({ symbol: 'BARC' })])
    fireEvent.change(screen.getByLabelText('Filter by symbol'), { target: { value: 'BARC' } })

    expect(screen.getByText(`1 of latest ${BLOTTER_LIMIT} trades`)).toBeVisible()
  })
})

describe('a pointer down away from the pane', () => {
  /** Picks a writable row, so Amend says whether the selection is still held. */
  function pick(): void {
    renderBlotter()
    fireEvent.click(tradeRow('TRD-100004'))
    expect(screen.getByRole('button', { name: 'Amend' })).toBeInTheDocument()
  }

  const held = (): boolean => screen.queryByRole('button', { name: 'Amend' }) !== null

  it('drops the selection, which is what clicking off a row means', () => {
    pick()
    fireEvent.pointerDown(document.body)

    expect(held()).toBe(false)
    expect(screen.getByText('4 trades')).toBeVisible()
  })

  it('keeps it for a pointer down inside the pane', () => {
    pick()
    fireEvent.pointerDown(screen.getByLabelText('Filter by symbol'))

    expect(held()).toBe(true)
  })

  it('keeps it for a pointer down in a layer the pane raised', () => {
    pick()
    fireEvent.contextMenu(paneRegion())

    // The sheet portals to the body, so it is outside the pane in the tree while
    // being about the selected row.
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Config' }))

    expect(held()).toBe(true)
  })
})
