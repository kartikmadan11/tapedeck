import type { DecimalString } from '@tapedeck/shared'
import { formatDecimal, toMinorUnits } from '@tapedeck/shared'
import type { ReactElement, ReactNode } from 'react'
import { createContext, useContext } from 'react'

/**
 * What a full-width bar means, in minor units. Zero means there is nothing to
 * scale against, and no bar is drawn.
 *
 * A context rather than table meta. The scale is taken over the filtered rows,
 * so it cannot be known until the table exists, and by then the table's options
 * have already been set for this render. It also keeps the scale out of
 * createColumns, where a new dependency would rebuild the column model on every
 * frame.
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
 * Quantised rather than taken raw: against a raw maximum, one large arrival
 * shortens every other bar on screen by a few pixels on every frame.
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
 * How much of the cell the bar fills, as a whole percentage. Whole, because the
 * bar is a little over a hundred pixels wide.
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
       * No stated height: inset-y-0 takes the text's own line box, so the bar
       * follows the row rather than being a second measurement.
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
