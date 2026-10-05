import type { DecimalString } from '@tapedeck/shared'
import { formatDecimal, toMinorUnits } from '@tapedeck/shared'
import type { ReactElement, ReactNode } from 'react'
import { createContext, useContext } from 'react'

/**
 * What a full-width bar means, in minor units. Zero means there is nothing to
 * scale against, and no bar is drawn.
 *
 * A context rather than table meta, which is where a value like this would
 * normally go. The scale is taken over the filtered rows, so it cannot be known
 * until the table exists, and by then the table's options have already been set
 * for this render. Handing it down beside the table rather than into it also
 * keeps it out of createColumns, where a new dependency would rebuild the column
 * model on every two-second frame.
 */
const Scale = createContext(0n)

type ScaleProps = {
  minor: bigint
  children: ReactNode
}

export function MagnitudeScale({ minor, children }: ScaleProps): ReactElement {
  return <Scale.Provider value={minor}>{children}</Scale.Provider>
}

/**
 * The bar's full-width value: the largest notional on the tape, raised to the
 * next 1, 2 or 5 times a power of ten.
 *
 * Quantised rather than taken raw because the feed lands every two seconds.
 * Against a raw maximum, one large arrival shortens every other bar on screen by
 * a few pixels, and a tape where every bar twitches continuously is noise rather
 * than information. Against a quantised one the scale holds still until the book
 * genuinely grows into the next step.
 *
 * 0n for an empty or zero maximum, which the caller reads as nothing to draw
 * rather than dividing by it.
 */
export function barScale(maxMinor: bigint): bigint {
  if (maxMinor <= 0n) {
    return 0n
  }

  let decade = 1n
  while (decade * 10n <= maxMinor) {
    decade *= 10n
  }

  for (const step of [1n, 2n, 5n]) {
    if (decade * step >= maxMinor) {
      return decade * step
    }
  }

  return decade * 10n
}

/**
 * How much of the cell the bar fills, as a whole percentage.
 *
 * Whole, because the bar is a little over a hundred pixels wide, so a tenth of a
 * percent is a fraction of a pixel that nobody can see and a longer style string
 * for React to diff on every frame.
 *
 * The value is a leaf notional, which is a positive quantity times a positive
 * price, and the scale is taken over those same leaves. So there is no sign to
 * handle and no overflow past 100 to clamp.
 */
export function barWidth(valueMinor: bigint, scaleMinor: bigint): number {
  if (scaleMinor <= 0n) {
    return 0
  }

  return Number((valueMinor * 100n) / scaleMinor)
}

/**
 * A notional with its own size drawn behind it, so relative size is read off the
 * row rather than counted off the digits.
 *
 * On notional and not quantity: 10,000 shares of a 72p stock and of a 400p stock
 * are not comparable sizes, and notional is the number a risk conversation is
 * actually about.
 */
export function Magnitude({ value }: { value: DecimalString }): ReactElement {
  const scale = useContext(Scale)
  const width = barWidth(toMinorUnits(value), scale)

  return (
    <span className="relative block">
      {/*
       * An overlay on a transparent cell, not a background on it. The cell
       * carries background-color: inherit so that hover, selection, the pending
       * fade and the row flash reach it, and a background here would cut that
       * chain.
       *
       * Anchored right, where the digits are anchored, so the bar and the figure
       * it measures share an edge. No stated height: inset-y-0 takes the text's
       * own line box, so the bar follows the row rather than being a second
       * measurement to keep in step with it.
       */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 right-0 rounded-xs bg-tape-accent/20"
        style={{ width: `${width}%` }}
      />
      {/* Its own layer, so the digits are never tinted by the bar behind them. */}
      <span className="relative">{formatDecimal(value, 2)}</span>
    </span>
  )
}
