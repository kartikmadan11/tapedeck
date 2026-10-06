import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react'
import { useRef } from 'react'
import { HANDLE, HANDLE_COLUMN, HANDLE_ROW } from '../../lib/ui.js'
import type { Orientation } from './layout.js'
import { resized } from './layout.js'

type Props = {
  label: string
  /** How far the boundary moved, in weight units. Which boundary of which split
   *  is closed over by whoever placed this. */
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

/** The draggable boundary between two panes. While the pointer is down it writes
 *  `flex-grow` onto the two neighbouring pane elements and commits once on release: a
 *  resize through React would re-render both virtualised grids on every pointer move.
 *  Neighbours come off the DOM as siblings, which holds because the markup always puts
 *  a pane on each side. */
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

    // Nothing laid out to drag against, jsdom included: it reports every rect as
    // empty. The keyboard path needs no geometry, so it still works.
    if (span <= 0) {
      return
    }

    // Capture, or a pointer that outruns the handle stops driving it mid-drag.
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

    // Against the pair's own length and weights, so the handle tracks the pointer.
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
    // An hr already carries role="separator"; with a tabindex it is the window
    // splitter. border-0 because it draws its own line, to control the colour.
    <hr
      aria-label={label}
      aria-orientation={rows ? 'horizontal' : 'vertical'}
      // Share of the pair, not of the workspace: the other panes do not move.
      aria-valuenow={Math.round((weightBefore / (weightBefore + weightAfter)) * 100)}
      // touch-none, or a drag on a touch screen scrolls the page instead.
      className={`${rows ? HANDLE_ROW : HANDLE_COLUMN} ${HANDLE}`}
      onKeyDown={(event) => {
        // Axis-appropriate keys only; the other axis is a guess at what was meant.
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
