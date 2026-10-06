import type { ReactElement } from 'react'

type Props = {
  /** Plain is for a screen that already spends its one accent fill on a button,
   *  per the rule in lib/ui.ts. */
  filled: boolean
  /** The type scale, which is the only other thing that changes between uses. */
  className: string
}

/** `tape` over `deck`: four characters over four, so a monospace face squares them
 *  off with nothing to align. Labelled, or the two lines read as two words. */
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
