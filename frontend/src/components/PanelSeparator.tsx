import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react'
import { useRef } from 'react'
import { HANDLE, HANDLE_COLUMN } from '../lib/ui.js'

type Props = {
  label: string
  /** The width of the region after the handle, which is what this moves. */
  width: number
  min: number
  max: number
  onResize: (width: number) => void
}

/** One keypress of travel. Sixteen pixels crosses the panel's whole range in
 *  twenty presses, and is still fine enough to line a column up by eye. */
const STEP = 16

type Drag = {
  /** Where the pointer went down on the x axis. */
  from: number
  /**
   * The width it went down on. Every move is measured against this rather than
   * accumulating a delta per move, which would drift once the clamp starts
   * discarding travel at either end.
   */
  opening: number
  panel: HTMLElement
  /** The last width written to the DOM, committed on release. */
  width: number
}

/**
 * The boundary between the blotter and the fixed-width panel beside it.
 *
 * Pixels rather than the share-of-the-axis model the panes between themselves
 * use, because the two sides of this boundary are not the same kind of thing.
 * The tape is fluid and wants whatever is left; the panel holds three columns
 * and a six-figure notional, so what it needs is a floor in pixels that does not
 * move when the window does. A share would put it under that floor on a laptop
 * and waste half a screen on a desk monitor.
 *
 * Writes `width` straight to the panel during the drag and commits once on
 * release, for the same reason Separator does: the sibling it is taking the
 * space from is a virtualised grid of 500 trades.
 */
export function PanelSeparator({ label, width, min, max, onResize }: Props): ReactElement {
  const drag = useRef<Drag | null>(null)
  const clamp = (value: number): number => Math.min(Math.max(value, min), max)

  const onPointerDown = (event: ReactPointerEvent<HTMLHRElement>): void => {
    const handle = event.currentTarget
    const panel = handle.nextElementSibling
    if (!(panel instanceof HTMLElement)) {
      return
    }

    // Capture, so a pointer that outruns the handle keeps driving it. Without it
    // a fast drag leaves the separator behind and the resize stops halfway.
    handle.setPointerCapture(event.pointerId)
    drag.current = { from: event.clientX, opening: width, panel, width }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLHRElement>): void => {
    const current = drag.current
    if (current === null) {
      return
    }

    // Subtracted, because the panel is on the far side of the handle: dragging
    // left widens it. No measurement of either region is involved, which is why
    // this path needs no layout and can be tested.
    const next = clamp(current.opening - (event.clientX - current.from))
    current.width = next
    current.panel.style.width = `${next}px`
  }

  const onPointerUp = (): void => {
    const current = drag.current
    drag.current = null
    if (current !== null && current.width !== current.opening) {
      onResize(current.width)
    }
  }

  return (
    // An hr, which carries role="separator" already, and with a tabindex is the
    // window splitter that role describes.
    <hr
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      // The panel's width, which is the unambiguous half to report: the blotter's
      // own width is whatever is left and is never held as a number.
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      className={`${HANDLE_COLUMN} ${HANDLE}`}
      onKeyDown={(event) => {
        // Left and Right only. This boundary is vertical, so Up on it would be a
        // guess at what was meant.
        const keys = ['ArrowLeft', 'ArrowRight']
        const direction = keys.indexOf(event.key)
        if (direction < 0) {
          return
        }
        // Or the arrow key scrolls the tape while the boundary moves over it.
        event.preventDefault()
        onResize(clamp(width + (direction === 0 ? STEP : -STEP)))
      }}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      tabIndex={0}
    />
  )
}
