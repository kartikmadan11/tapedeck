import type { Position } from '@tapedeck/shared'
import { position as positionSchema } from '@tapedeck/shared'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PnlBySymbol, ranked } from './PnlBySymbol.js'

function aPosition(overrides: Record<string, unknown> = {}): Position {
  return positionSchema.parse({
    symbol: 'VOD',
    netQuantity: 10_000,
    boughtQuantity: 10_000,
    soldQuantity: 0,
    netNotional: '684200.000000',
    tradeCount: 1,
    ...overrides,
  })
}

/** VOD references 68.42, BARC 192.35 and LLOY 54.28, so these mark at a round
 *  +100,000, -50,000 and flat, and the chart's scale is a round 100,000. */
const BOOK = [
  aPosition({ netNotional: '584200.000000' }),
  aPosition({ symbol: 'BARC', netQuantity: 1_000, netNotional: '242350.000000' }),
  aPosition({ symbol: 'LLOY', netQuantity: 1_000, netNotional: '54280.000000' }),
]

function row(symbol: string): HTMLElement {
  const found = screen.getByText(symbol).closest('li')
  if (!(found instanceof HTMLElement)) throw new Error(`no chart row for ${symbol}`)

  return found
}

/** The bar on a row, which carries no text of its own. */
function bar(symbol: string): HTMLElement {
  const drawn = row(symbol).querySelector('[aria-hidden] [style]')
  if (!(drawn instanceof HTMLElement)) throw new Error(`no bar on ${symbol}`)

  return drawn
}

/** Which side of the centre line the bar was drawn on: 0 is left of it, 2 right. */
function side(symbol: string): number {
  const half = bar(symbol).parentElement
  const track = half?.parentElement
  if (half === null || track === null || track === undefined) {
    throw new Error(`no track around ${symbol}`)
  }

  return [...track.children].indexOf(half)
}

describe('ranked', () => {
  it('puts the biggest mover first whichever way it moved', () => {
    expect(ranked(BOOK).map((marked) => marked.symbol)).toEqual(['VOD', 'BARC', 'LLOY'])
  })

  it('leaves out a symbol the master no longer prices', () => {
    // Not as a zero: an unmarkable symbol is not a symbol that has not moved.
    const book = [...BOOK, aPosition({ symbol: 'VOD.L' })]

    expect(ranked(book).map((marked) => marked.symbol)).toEqual(['VOD', 'BARC', 'LLOY'])
  })

  it('breaks a tie on symbol, so the order holds between frames', () => {
    const flat = [
      aPosition({ symbol: 'LLOY', netQuantity: 1_000, netNotional: '54280.000000' }),
      aPosition({ symbol: 'BARC', netQuantity: 1_000, netNotional: '192350.000000' }),
    ]

    expect(ranked(flat).map((marked) => marked.symbol)).toEqual(['BARC', 'LLOY'])
  })
})

describe('P&L by symbol', () => {
  it('draws a bar per symbol, scaled against the biggest mover', () => {
    render(<PnlBySymbol positions={BOOK} />)

    expect(bar('VOD')).toHaveStyle({ width: '100%' })
    expect(bar('BARC')).toHaveStyle({ width: '50%' })
  })

  it('grows a loss left of the centre line and a gain right of it', () => {
    render(<PnlBySymbol positions={BOOK} />)

    expect(side('BARC')).toBe(0)
    expect(side('VOD')).toBe(2)
  })

  it('draws no bar for a symbol that is flat', () => {
    render(<PnlBySymbol positions={BOOK} />)

    expect(() => bar('LLOY')).toThrow('no bar on LLOY')
    expect(row('LLOY')).toHaveTextContent('0.00')
  })

  it('carries the figures as well as the bars', () => {
    render(<PnlBySymbol positions={BOOK} />)

    expect(screen.getByRole('region', { name: 'P&L by symbol' })).toBeInTheDocument()
    expect(row('VOD')).toHaveTextContent('100,000.00')
    expect(row('BARC')).toHaveTextContent('-50,000.00')
  })

  it('draws nothing at all for one symbol', () => {
    // A ranking of one is not a ranking, and its bar fills the track regardless.
    const { container } = render(<PnlBySymbol positions={[aPosition()]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
