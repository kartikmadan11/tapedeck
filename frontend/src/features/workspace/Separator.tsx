import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react'
import { useRef } from 'react'
import { HANDLE, HANDLE_COLUMN, HANDLE_ROW } from '../../lib/ui.js'
import type { Orientation } from './layout.js'
import { resized } from './layout.js'

type Props = {
  label: string
  /**
   * How far the boundary moved, in the same units as the weights. Which boundary
   * of which split is closed over by whoever placed this.
   */
  onResize: (delta: number) => void
  orientation: Orientation
  weightBefore: number
  weightAfter: number
}

/** One keypress of travel, as a share of the pair's combined weight. */
const STEP = 0.02

type Drag = {
  /** Where the pointer went down, on the axis being dragged. */
  from: number
  /** The two panes' combined length in px, which is what maps px to weight. */
  span: number
  before: HTMLElement
  after: HTMLElement
  /** The last weight change applied to the DOM, committed on pointer up. */
  delta: number
}

/**
 * The draggable boundary between two panes.
 *
 * While the pointer is down this writes `flex-grow` straight onto the two
 * neighbouring pane elements and commits once, on release: a pane is a
 * virtualised grid of 500 trades, and putting a resize through React would
 * re-render both of them on every pointer move. The committed value is the one
 * that was written, so there is no frame where the two disagree.
 *
 * The neighbours are read off the DOM as siblings rather than threaded in as
 * refs, which holds because the markup that places a separator guarantees a pane
 * on each side of it.
 */
export function Separator({
  label,
  onResize,
  orientation,
  weightBefore,
  weightAfter,
}: Props): ReactElement {
  const drag = useRef<Drag | null>(null)
  const rows = orientation === 'rows'

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const handle = event.currentTarget
    const before = handle.previousElementSibling
    const after = handle.nextElementSibling
    if (!(before instanceof HTMLElement) || !(after instanceof HTMLElement)) {
      return
    }

    const span = rows
      ? before.getBoundingClientRect().height + after.getBoundingClientRect().height
      : before.getBoundingClientRect().width + after.getBoundingClientRect().width

    // Nothing to drag against: a surface that has not been laid out, or jsdom,
    // which reports every rect as empty. Returning here leaves the keyboard
    // path, which needs no geometry at all.
    if (span <= 0) {
      return
    }

    // Capture, so a pointer that outruns the handle keeps driving it. Without it
    // a fast drag leaves the separator behind and the resize stops halfway.
    handle.setPointerCapture(event.pointerId)
    drag.current = {
      from: rows ? event.clientY : event.clientX,
      span,
      before,
      after,
      delta: 0,
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (current === null) {
      return
    }

    // Against the pair's own length and the pair's own weights, so the pointer
    // tracks the handle exactly whatever the other panes and the separators are
    // taking up.
    const travelled = (rows ? event.clientY : event.clientX) - current.from
    const share = weightBefore + weightAfter
    const [next, following] = resized(
      [weightBefore, weightAfter],
      0,
      (travelled / current.span) * share,
    )
    if (next === undefined || following === undefined) {
      return
    }

    current.delta = next - weightBefore
    current.before.style.flexGrow = String(next)
    current.after.style.flexGrow = String(following)
  }

  const onPointerUp = (): void => {
    const current = drag.current
    drag.current = null
    if (current !== null && current.delta !== 0) {
      onResize(current.delta)
    }
  }

  return (
    // An hr, which carries role="separator" already, and with a tabindex is the
    // window splitter that role describes. border-0 because its default border
    // is the line, and this one draws its own so it can change colour.
    <hr
      aria-label={label}
      aria-orientation={rows ? 'horizontal' : 'vertical'}
      // The leading pane's share of the pair, which is what the handle moves.
      // Not its share of the workspace: the other panes do not move with it.
      aria-valuenow={Math.round((weightBefore / (weightBefore + weightAfter)) * 100)}
      // touch-none, so a drag on a touch screen moves the boundary rather than
      // scrolling the page out from under it.
      className={`${rows ? HANDLE_ROW : HANDLE_COLUMN} ${HANDLE}`}
      onKeyDown={(event) => {
        // Axis-appropriate keys only. In a stacked workspace the boundary moves
        // up and down, and Left on it would be a guess at what was meant.
        const keys = rows ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
        const direction = keys.indexOf(event.key)
        if (direction < 0) {
          return
        }
        event.preventDefault()
        onResize(direction === 0 ? -STEP : STEP)
      }}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      tabIndex={0}
    />
  )
}
