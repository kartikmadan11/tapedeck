/** Shared control classes. No background here: the panel wants a darker fill than
 *  the canvas, and two background utilities in one class list resolve by Tailwind's
 *  output order rather than by which came last, so the caller states it. */

/** A stated height: six controls in a row line up only if the height is fixed
 *  rather than derived from each one's font metrics. */
export const CONTROL =
  'h-7 rounded-xs border border-tape-line px-2 text-tape-text placeholder:text-tape-muted focus:border-tape-focus focus:outline-none focus:ring-1 focus:ring-tape-focus'

/** A chip minus its colours, so the two states below cannot drift in geometry. */
const CHIP_BASE =
  'h-7 cursor-pointer rounded-xs border px-2 text-[10px] uppercase tracking-[0.14em] transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-35'

/** Header and row controls. Tailwind's preflight sets cursor:default on button,
 *  so the pointer is asked for explicitly. */
export const CHIP = `${CHIP_BASE} border-tape-line text-tape-muted hover:border-tape-accent hover:text-tape-accent`

/** The same chip while what it controls is showing. A separate class, not one
 *  appended to CHIP: two border colours resolve by Tailwind's output order. */
export const CHIP_ON = `${CHIP_BASE} border-tape-accent text-tape-accent`

/** Secondary text. Hierarchy comes from size and tracking, not a dimmer grey:
 *  anything below tape-muted fails contrast at this size. */
export const MICRO_LABEL = 'text-[10px] uppercase tracking-[0.14em] text-tape-muted'

/** A draggable boundary. The bar is the hit area; the pill is a pseudo-element so
 *  an hr can have one without a child, an hr already carrying role="separator". */
export const HANDLE =
  "relative shrink-0 touch-none border-0 bg-tape-line transition-colors duration-100 before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-tape-muted before:transition-colors before:duration-100 before:content-[''] hover:bg-tape-raised hover:before:bg-tape-accent focus-visible:bg-tape-raised focus-visible:outline-none focus-visible:before:bg-tape-accent"

/** Eight pixels, a pointer target rather than a line. This is also the whole gap
 *  between the regions, so a container holding one sets no gap of its own. */
export const HANDLE_ROW = 'h-2 w-full cursor-row-resize before:h-0.5 before:w-8'
export const HANDLE_COLUMN = 'h-full w-2 cursor-col-resize before:h-8 before:w-0.5'

/** The w-2 above as a number, for the caller sliding a handle off screen. */
export const HANDLE_PX = 8

/** The commit action minus its fill, so the two fills below cannot drift. */
const ACTION_BASE =
  'h-7 cursor-pointer rounded-xs px-4 font-semibold uppercase tracking-[0.1em] text-white transition-[filter] duration-100 hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tape-focus disabled:cursor-not-allowed disabled:opacity-40'

/** The one accent fill per screen, reserved for the primary commit action: a
 *  second one would make neither read as primary. */
export const ACTION = `${ACTION_BASE} bg-tape-accent-fill`

/** The same button while holding a press for confirmation. Replaces ACTION rather
 *  than sitting beside it, so the one-fill rule above still holds. */
export const ACTION_HELD = `${ACTION_BASE} bg-tape-warn-fill`
