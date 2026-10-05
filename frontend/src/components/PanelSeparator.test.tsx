import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { PanelSeparator } from './PanelSeparator.js'

const MIN = 216
const MAX = 560
const OPENING = 288

/**
 * The handle plus the element it resizes, which it finds as its own next
 * sibling. State is held here rather than asserted through a mock, so a test
 * sees what a committed drag actually leaves on screen.
 */
function Harness({ opening = OPENING }: { opening?: number }): ReactElement {
  const [width, setWidth] = useState(opening)
  return (
    <div>
      <PanelSeparator
        label="Resize the positions panel"
        max={MAX}
        min={MIN}
        onResize={setWidth}
        width={width}
      />
      <aside data-testid="panel" style={{ width }} />
    </div>
  )
}

const handle = (): HTMLElement =>
  screen.getByRole('separator', { name: 'Resize the positions panel' })

const panel = (): HTMLElement => screen.getByTestId('panel')

/** The width the panel is actually drawn at, which during a drag is written to
 *  the DOM directly and only afterwards comes back through React. */
const drawn = (): string => panel().style.width

/** A whole drag, from where the pointer went down to where it was let go. */
function dragTo(...xs: number[]): void {
  fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
  for (const x of xs) {
    fireEvent.pointerMove(handle(), { clientX: x, pointerId: 1 })
  }
  fireEvent.pointerUp(handle(), { pointerId: 1 })
}

describe('resizing the panel beside the blotter', () => {
  it('reports the width it opens on, and the range it may be taken over', () => {
    render(<Harness />)

    // A splitter with no stated range is one a screen reader can only describe
    // as moved, not as nearly closed.
    expect(handle()).toHaveAttribute('aria-valuenow', String(OPENING))
    expect(handle()).toHaveAttribute('aria-valuemin', String(MIN))
    expect(handle()).toHaveAttribute('aria-valuemax', String(MAX))
    expect(handle()).toHaveAttribute('aria-valuetext', '288 pixels')
  })

  it('widens the panel when the handle is dragged towards the tape', () => {
    render(<Harness />)
    dragTo(900)

    // The panel is on the far side of the handle, so left is bigger. 100px of
    // travel is 100px of panel, with no scaling: that is the whole reason this
    // boundary is in pixels.
    expect(drawn()).toBe('388px')
    expect(handle()).toHaveAttribute('aria-valuenow', '388')
  })

  it('narrows the panel when the handle is dragged towards it', () => {
    render(<Harness opening={400} />)
    dragTo(1100)

    expect(drawn()).toBe('300px')
  })

  it.each([
    ['past the floor', 2000, MIN],
    ['past the ceiling', 0, MAX],
  ])('dragged %s, stops there', (_label, to, expected) => {
    render(<Harness />)
    dragTo(to)

    // Clamped rather than merely resisted. The floor is the width the panel's
    // own numbers stop fitting at, and the ceiling is where it is taking width
    // off the tape for nothing.
    expect(drawn()).toBe(`${expected}px`)
  })

  it('measures every move against where the drag began', () => {
    render(<Harness />)

    // Dragged out past the ceiling and then all the way back. A handle that
    // accumulated a delta per move would have discarded the travel the clamp ate
    // on the way out and come back to the wrong place.
    dragTo(0, 1000)

    expect(drawn()).toBe('288px')
  })

  it('commits nothing when the pointer went down and did not travel', () => {
    render(<Harness opening={320} />)
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerUp(handle(), { pointerId: 1 })

    // A click on the boundary is not a resize. Committing one would re-render
    // the virtualised grid beside it for no change.
    expect(drawn()).toBe('320px')
  })

  it('ignores a pointer moving over it with no drag in progress', () => {
    render(<Harness />)
    fireEvent.pointerMove(handle(), { clientX: 400, pointerId: 1 })

    expect(drawn()).toBe('288px')
  })

  it('abandons the drag when the pointer is cancelled', () => {
    render(<Harness />)
    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerMove(handle(), { clientX: 900, pointerId: 1 })
    fireEvent.pointerCancel(handle(), { pointerId: 1 })

    // Cancel commits what was reached rather than reverting it, the same as a
    // release: the width is already on screen, and snapping back would undo a
    // move the user watched happen.
    expect(handle()).toHaveAttribute('aria-valuenow', '388')

    // And the drag is over, so a further move cannot still be driving it.
    fireEvent.pointerMove(handle(), { clientX: 500, pointerId: 1 })
    expect(drawn()).toBe('388px')
  })

  it('does nothing at all when there is nothing after it to resize', () => {
    // Defensive, because the handle reads its neighbour off the DOM rather than
    // being handed a ref. A boundary with one side is not a boundary.
    render(
      <PanelSeparator
        label="Resize the positions panel"
        max={MAX}
        min={MIN}
        onResize={() => undefined}
        width={OPENING}
      />,
    )

    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1 })
    fireEvent.pointerMove(handle(), { clientX: 900, pointerId: 1 })

    expect(handle()).toHaveAttribute('aria-valuenow', String(OPENING))
  })

  describe('from the keyboard', () => {
    it.each([
      ['ArrowLeft', 304],
      ['ArrowRight', 272],
    ])('%s moves the boundary one step', (key, expected) => {
      render(<Harness />)
      fireEvent.keyDown(handle(), { key })

      expect(drawn()).toBe(`${expected}px`)
    })

    it('stops at the floor however long the key is held', () => {
      render(<Harness />)
      for (let press = 0; press < 20; press += 1) {
        fireEvent.keyDown(handle(), { key: 'ArrowRight' })
      }

      expect(drawn()).toBe(`${MIN}px`)
    })

    it('ignores the keys for the other axis', () => {
      render(<Harness />)

      // This boundary is vertical. Up on it is not a smaller version of the same
      // request, it is a different one, so it does nothing.
      fireEvent.keyDown(handle(), { key: 'ArrowUp' })
      fireEvent.keyDown(handle(), { key: 'ArrowDown' })

      expect(drawn()).toBe('288px')
    })
  })
})
