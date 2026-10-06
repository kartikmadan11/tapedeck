/**
 * Shared control classes.
 *
 * No background is set here on purpose. A control on the panel needs a darker
 * fill and one on the canvas needs a lighter one, and two background utilities
 * in the same class list resolve by Tailwind's output order rather than by
 * which was written last, so the caller states it.
 */

/** A stated height, because six controls in a row line up only if the height is
 *  fixed rather than derived from each one's font metrics. */
export const CONTROL =
  'h-7 rounded-xs border border-tape-line px-2 text-tape-text placeholder:text-tape-muted focus:border-tape-focus focus:outline-none focus:ring-1 focus:ring-tape-focus'

/** Header and row controls. Tailwind's preflight sets cursor:default on button,
 *  so the pointer has to be asked for. */
export const CHIP =
  'h-7 cursor-pointer rounded-xs border border-tape-line px-2 text-[10px] uppercase tracking-[0.14em] text-tape-muted transition-colors duration-100 hover:border-tape-accent hover:text-tape-accent disabled:cursor-not-allowed disabled:opacity-35'

/** Secondary text. Hierarchy comes from size and tracking rather than a dimmer
 *  grey, because anything below tape-muted fails contrast at this size. */
export const MICRO_LABEL = 'text-[10px] uppercase tracking-[0.14em] text-tape-muted'

/**
 * A draggable boundary between two regions. The bar is the hit area, and the
 * pill in the middle is drawn as a pseudo-element so an hr can have one without
 * a child, an hr being what carries the separator role without asserting it.
 */
export const HANDLE =
  "relative shrink-0 touch-none border-0 bg-tape-line transition-colors duration-100 before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-tape-muted before:transition-colors before:duration-100 before:content-[''] hover:bg-tape-raised hover:before:bg-tape-accent focus-visible:bg-tape-raised focus-visible:outline-none focus-visible:before:bg-tape-accent"

/**
 * Eight pixels, which is a pointer target rather than a line. These are also the
 * whole gap between the regions they separate, so a container that holds one
 * sets no gap of its own.
 */
export const HANDLE_ROW = 'h-2 w-full cursor-row-resize before:h-0.5 before:w-8'
export const HANDLE_COLUMN = 'h-full w-2 cursor-col-resize before:h-8 before:w-0.5'

/** Everything about the commit action except its fill, so the two fills below
 *  cannot drift in height, tracking or focus ring. */
const ACTION_BASE =
  'h-7 cursor-pointer rounded-xs px-4 font-semibold uppercase tracking-[0.1em] text-white transition-[filter] duration-100 hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tape-focus disabled:cursor-not-allowed disabled:opacity-40'

/** The one accent fill in the application. Reserved for the primary commit
 *  action, since a second one would make neither read as primary. */
export const ACTION = `${ACTION_BASE} bg-tape-accent-fill`

/** The same button while it is holding a press for confirmation. It replaces
 *  ACTION rather than appearing beside it, so the rule above still holds. */
export const ACTION_HELD = `${ACTION_BASE} bg-tape-warn-fill`
