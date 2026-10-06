import type { ReactElement } from 'react'

type Props = {
  /**
   * Filled is the mark proper. Plain is for a screen that already spends its one
   * accent fill on a button, which is the rule in lib/ui.ts.
   */
  filled: boolean
  /** The type scale, which is the only other thing that changes between uses. */
  className: string
}

/**
 * `tape` over `deck`: four characters over four, so in a monospace face the two
 * lines are exactly as wide as each other and the mark squares off on its own
 * grid. Nothing to track or align, because the font already did it.
 *
 * An h1 because it is the page's heading on both screens that use it, and
 * labelled because two block lines are otherwise announced as two words.
 */
export function Wordmark({ filled, className }: Props): ReactElement {
  return (
    <h1
      aria-label="tapedeck"
      className={`inline-block font-bold leading-[0.82] tracking-tight ${
        filled ? 'bg-tape-accent-fill px-[0.28em] py-[0.2em] text-white' : 'text-tape-text'
      } ${className}`}
    >
      <span className="block">tape</span>
      <span className="block">deck</span>
    </h1>
  )
}
