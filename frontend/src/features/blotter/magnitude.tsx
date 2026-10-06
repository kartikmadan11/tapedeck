import type { DecimalString } from '@tapedeck/shared'
import { formatDecimal, toMinorUnits } from '@tapedeck/shared'
import type { ReactElement, ReactNode } from 'react'
import { createContext, useContext } from 'react'

/** What a full-width bar means, in minor units. 0n draws no bar. A context, not
 *  table meta: the scale comes off the filtered rows, which are not known until
 *  after the table's options are set, and meta would rebuild the columns. */
const Scale = createContext(0n)

type ScaleProps = {
  minor: bigint
  children: ReactNode
}

export function MagnitudeScale({ minor, children }: ScaleProps): ReactElement {
  return <Scale.Provider value={minor}>{children}</Scale.Provider>
}

/** The largest notional, raised to the next 1, 2 or 5 times a power of ten. Keeps
 *  one large arrival from resizing every bar on every frame. 0n for an empty or
 *  zero maximum, which the caller reads as nothing to draw. */
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

/** How much of the cell the bar fills, as a whole percentage. No sign to handle
 *  and no clamp past 100: the value is a leaf notional and the scale is taken
 *  over those same leaves. */
export function barWidth(valueMinor: bigint, scaleMinor: bigint): number {
  if (scaleMinor <= 0n) {
    return 0
  }

  return Number((valueMinor * 100n) / scaleMinor)
}

/** A notional with a bar behind it, so size reads off the row, not the digits. */
export function Magnitude({ value }: { value: DecimalString }): ReactElement {
  const scale = useContext(Scale)
  const width = barWidth(toMinorUnits(value), scale)

  return (
    <span className="relative block">
      {/* An overlay, not a background on the cell: the cell is bg-inherit so the
          flash, hover, selection and pending fade reach it, and a background here
          would cut that chain. inset-y-0 so the bar follows the text's line box. */}
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
