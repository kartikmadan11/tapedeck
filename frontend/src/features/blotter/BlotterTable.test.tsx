import type { Trade } from '@tapedeck/shared'
import { trade as tradeSchema } from '@tapedeck/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PaneConfig } from '../workspace/paneConfig.js'
import { SHAREABLE_COLUMNS } from '../workspace/state.js'
import { BlotterTable } from './BlotterTable.js'

function aTrade(overrides: Record<string, unknown> = {}): Trade {
  return tradeSchema.parse({
    tradeId: 'TRD-100001',
    symbol: 'VOD',
    side: 'BUY',
    quantity: 10_000,
    price: '72.465000',
    trader: 'k.madan',
    book: 'EQ-LDN-1',
    counterparty: 'GSIL',
    tradeTimestamp: '2026-10-02T09:15:00.000Z',
    status: 'ACTIVE',
    version: 1,
    updatedAt: '2026-10-02T09:15:00.000Z',
    ...overrides,
  })
}

/**
 * One book, deliberately arranged so the netting is checkable by hand:
 *
 *   net quantity   10,000 - 4,000               =      6,000
 *   net notional   724,650.00 - 292,400.00      = 432,250.00
 *   vwap           1,017,050 / 14,000           =    72.6464
 *
 * The cancelled leg is 5,000 at 70, which is large enough that including it
 * would move all three figures.
 */
const BOOK = [
  aTrade(),
  aTrade({
    tradeId: 'TRD-100002',
    side: 'SELL',
    quantity: 4_000,
    price: '73.100000',
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
    book: 'EQ-LDN-2',
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

/**
 * Notional's place among the visible columns, with the Trade column off:
 * symbol, side, price, quantity, notional, time, trader, book, ...
 */
const NOTIONAL = 4

/**
 * Every column heading on screen, which is what grouping changes. The sort
 * marker is a child of the heading it marks, and which column the grid is
 * sorted by is not what these cases are about.
 */
function headers(): string[] {
  return Array.from(document.querySelectorAll('th')).map((cell) =>
    (cell.textContent ?? '').replace(/[↑↓]/, ''),
  )
}

/** The grid as it opens, which is every column but the trade id. */
const UNGROUPED = [
  'Symbol',
  'Side',
  'Price',
  'Quantity',
  'Notional',
  'Time (UTC)',
  'Trader',
  'Book',
  'Counterparty',
  'Status',
  'Ver',
]

/** What a group row can answer for, and so what grouping leaves on screen. */
const NETTED = ['Price', 'Quantity', 'Notional']

function openConfig(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Config' }))
}

function set(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

/** The group's own row, found by the toggle that opens it. */
function groupRow(name: string): HTMLElement {
  const row = screen.getByRole('button', { name }).closest('tr')
  if (row === null) {
    throw new Error(`no row for the ${name} group`)
  }
  return row
}

/** Every cell of a row, in column order, so one assertion covers the whole row. */
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

    // Eight of the eleven were an empty cell on every group row: a group of
    // forty trades has no one counterparty and no one timestamp, so there was
    // nothing to put in them and eight columns to scroll past to reach the four
    // figures a grouped view is opened for.
    expect(headers()).toEqual(['Symbol', ...NETTED])
  })

  it('nets a group exactly', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    // The whole row in one assertion, so the figures are read in the places they
    // occupy rather than one index at a time.
    expect(cells(groupRow('VOD, 2 trades'))).toEqual([
      // The label, the expander and the active leaf count, on the grouped column.
      '▸VOD(2)',
      '72.6464',
      '6,000',
      '432,250.00',
    ])
  })

  it('gives the columns back when the grouping is cleared', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')
    set('Group by', '')

    // Derived from the grouping rather than written into the trader's own
    // choice, so there is nothing left behind to undo by hand.
    expect(headers()).toEqual(UNGROUPED)
  })

  it('drops a column the trader turned on, without reporting it as hidden', () => {
    const { reported } = renderBlotter()
    openConfig()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trade' }))
    expect(headers()[0]).toBe('Trade')

    set('Group by', 'symbol')
    expect(headers()).toEqual(['Symbol', ...NETTED])

    // What goes in a shared link is the column the trader asked for, not the
    // eight the grouping took away: resolving the panel's updater against the
    // state the table was given would bake those eight in and they would
    // survive the grouping being cleared.
    expect(reported.at(-1)?.columnVisibility).toEqual({ tradeId: true })

    set('Group by', '')
    expect(headers()[0]).toBe('Trade')
  })

  it('shows a column the trader had hidden, once the grid is grouped by it', () => {
    renderBlotter()
    openConfig()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book' }))
    expect(screen.queryByText('EQ-LDN-1')).toBeNull()

    set('Group by', 'book')

    // It carries the label and the expander, so left hidden the grouping would
    // produce groups that can be neither read nor opened.
    expect(screen.getByRole('button', { name: 'EQ-LDN-1, 2 trades' })).toBeInTheDocument()
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

    // Trader is not a column a group nets, so it is off the grid. The filter on
    // it is not: the column is hidden rather than taken out of the table,
    // because TanStack silently skips a filter whose column it cannot resolve,
    // and this figure would quietly become everybody's flow.
    expect(headers()).toEqual(['Symbol', ...NETTED])
    expect(cells(groupRow('VOD, 1 trades'))[2]).toBe('10,000')
  })

  it('leaves cancelled trades out of the netting', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    // Three VOD trades sit under the group and two of them happened. The
    // cancelled 5,000 at 70 is large enough that netting it in would move the
    // count to 3 and every figure in the test above with it.
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

    // A dash, not 0.0000. A zero average price is a claim about where the book
    // traded, and this group has nothing to claim.
    expect(cells(groupRow('VOD, 0 trades'))[1]).toBe('-')
  })

  it('blanks the grouped column on the rows beneath it, not the group row', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')
    fireEvent.click(screen.getByRole('button', { name: 'VOD, 2 trades' }))

    // The symbol is on the group row above, so repeating it down every row
    // beneath would be a column of the same word.
    const leaf = tradeRow('TRD-100001')
    expect(cells(leaf)[0]).toBe('')
    expect(cells(leaf)[2]).toBe('10,000')
  })

  it('nests a split inside the group it splits', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')
    set('Split by', 'book')
    fireEvent.click(screen.getByRole('button', { name: 'VOD, 2 trades' }))

    // The inner level nets only its own leaves, and sits indented under the
    // outer one.
    const inner = screen.getByRole('button', { name: 'EQ-LDN-1, 2 trades' })
    expect(inner).toHaveStyle({ paddingLeft: '0.75rem' })

    // Both levels lead the row, in the order they were asked for, with the
    // outer one blank here because it is on the group row above. Left where
    // Book is declared, this label would have sat after the three figures it
    // heads.
    expect(cells(groupRow('EQ-LDN-1, 2 trades'))).toEqual([
      '',
      '▸EQ-LDN-1(2)',
      '72.6464',
      '6,000',
      '432,250.00',
    ])
  })

  it('counts the trades held, not the groups showing', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    // Two group rows are on screen. "2 trades" would be a lie about a book of
    // four.
    expect(screen.getByText('4 trades')).toBeInTheDocument()
  })
})

describe('a group row is not a trade', () => {
  it('refuses to select one, so Amend cannot land on an arbitrary leaf', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')

    const row = groupRow('VOD, 2 trades')
    fireEvent.click(row)

    // TanStack builds a group row out of its first leaf trade, so a selectable
    // group header would hand the bar a real trade and offer to amend it.
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

    // Everything is closed, so there is no trade to move to and the selection
    // must not settle on a group.
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(readback()).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: 'VOD, 2 trades' }))
    fireEvent.keyDown(grid, { key: 'ArrowDown' })

    // The first row on screen is the VOD group; the first trade under it is the
    // newest, which the default order puts at the top.
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

    // The spacer rows are presentational, so this counts real rows only: the
    // header band plus the twenty that fit in the shimmed 640px and the
    // overscan either side of them. Far from 501, which is the point.
    expect(screen.getAllByRole('row').length).toBeLessThan(60)
  })

  it('still reports the whole tape rather than the part of it drawn', () => {
    renderBlotter(TAPE)

    // Both of these would otherwise describe the window instead of the book,
    // which is the characteristic way a virtualised grid lies.
    expect(screen.getByText('latest 500 trades')).toBeInTheDocument()
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

    // Fixed layout takes the widths from here, so a colgroup that disagreed
    // with the body would shift every column after the hidden one.
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

    // Scaled against the whole book, a tape filtered down to small trades would
    // show nothing but bars too short to read.
    fireEvent.change(screen.getByLabelText('Filter by symbol'), { target: { value: 'BARC' } })
    expect(bar('TRD-100002')).toHaveStyle({ width: '100%' })
  })

  it('keeps the figure legible on top of the bar', () => {
    renderBlotter(TWO_SIZES)

    // The bar is an overlay on a transparent cell rather than a background on
    // it, which is what leaves hover, selection, the pending fade and the row
    // flash able to reach the cell.
    const cell = tradeRow('TRD-100001').querySelectorAll('td')[NOTIONAL]
    expect(cell).toHaveTextContent('100,000.00')
    expect(cell?.className).not.toMatch(/\bbg-/)
  })
})

describe('the configuration panel', () => {
  it('keeps its controls out of the tab order while it is closed', () => {
    renderBlotter()

    // A zero-width panel still holds real form controls, so without inert the
    // next Tab out of the grid lands in an invisible select.
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

    // Grouping by symbol inside symbol is a level that can never divide, so it
    // is not on the list.
    const options = within(screen.getByLabelText('Split by')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).not.toContain('Symbol')
  })

  it('clears the split when the level it sits under goes away', () => {
    renderBlotter()
    openConfig()
    set('Group by', 'symbol')
    set('Split by', 'book')
    set('Group by', '')

    // A grouping of [undefined, 'book'] is not a view, and TanStack would read
    // the second level as the first.
    expect(screen.getByLabelText('Split by')).toHaveValue('')
    expect(row('TRD-100001')).not.toBeNull()
  })

  it('shares one sort with the column headers', () => {
    renderBlotter()
    openConfig()

    // The header starts the grid on time, newest first, so the panel has to say
    // so rather than reporting its own idea of the order.
    expect(screen.getByLabelText('Order by')).toHaveValue('tradeTimestamp')
    expect(screen.getByRole('button', { name: 'Desc' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Quantity' }))
    expect(screen.getByLabelText('Order by')).toHaveValue('quantity')
  })

  it('carries the direction across a change of column', () => {
    renderBlotter()
    openConfig()

    fireEvent.click(screen.getByRole('button', { name: 'Desc' }))
    expect(screen.getByRole('button', { name: 'Asc' })).toBeInTheDocument()

    // Snapping back to descending here would reorder the tape for a reason the
    // trader did not ask for.
    set('Order by', 'quantity')
    expect(screen.getByRole('button', { name: 'Asc' })).toBeInTheDocument()
  })

  it('hides a column', () => {
    renderBlotter()
    openConfig()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Book' }))
    expect(screen.queryByText('EQ-LDN-1')).not.toBeInTheDocument()
  })

  it('keeps the trade id off the tape until it is asked for', () => {
    renderBlotter()
    openConfig()

    // The row is on the tape; its id is not on screen. Turning the column on
    // puts it back at the front, where it is pinned.
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

    // Unticked and unavailable rather than tickable: the grid reads these boxes
    // through the grouping's override, so a tick would be a control that does
    // nothing. The line above them is what says why.
    const book = screen.getByRole('checkbox', { name: 'Book' })
    expect(book).toBeDisabled()
    expect(book).not.toBeChecked()
    expect(screen.getByText(/only the columns a group nets/)).toBeInTheDocument()
  })

  it('filters on a floor the top bar does not offer', () => {
    renderBlotter()
    openConfig()

    set('Minimum quantity', '5000')
    expect(row('TRD-100001')).not.toBeNull()
    expect(row('TRD-100004')).toBeNull()

    // Half typed is not zero. A bound that emptied the grid mid-keystroke would
    // read as no matches rather than as not finished.
    set('Minimum quantity', '')
    expect(row('TRD-100004')).not.toBeNull()
  })

  it('filters a decimal floor by value rather than by text', () => {
    renderBlotter()
    openConfig()

    // 2,500.00 against 724,650.00: as text the smaller one sorts and compares
    // first, which is the trap the exact decimal comparison avoids.
    set('Minimum notional', '3000')
    expect(row('TRD-100001')).not.toBeNull()
    expect(row('TRD-100004')).toBeNull()
  })
})
