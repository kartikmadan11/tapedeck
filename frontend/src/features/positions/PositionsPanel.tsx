import { formatDecimal } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { formatQuantity } from '../../lib/format.js'
import { usePositions } from './usePositions.js'

export function PositionsPanel(): ReactElement {
  const positions = usePositions()

  return (
    <aside className="flex w-80 shrink-0 flex-col rounded border border-tape-line">
      <header className="flex items-baseline justify-between border-b border-tape-line bg-tape-panel px-2 py-1.5">
        <h2 className="font-semibold">Positions</h2>
        <span className="text-tape-muted">{positions.length} symbols</span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-tape-muted">
              <th className="px-2 py-1 font-semibold">Symbol</th>
              <th className="px-2 py-1 text-right font-semibold">Net Qty</th>
              <th className="px-2 py-1 text-right font-semibold">Net Notional</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr key={position.symbol} className="border-t border-tape-line/50">
                <td className="px-2 py-1 font-semibold">{position.symbol}</td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    position.netQuantity < 0 ? 'text-tape-sell' : 'text-tape-buy'
                  }`}
                  title={`${formatQuantity(position.boughtQuantity)} bought, ${formatQuantity(
                    position.soldQuantity,
                  )} sold, ${position.tradeCount} active trades`}
                >
                  {formatQuantity(position.netQuantity)}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {formatDecimal(position.netNotional, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {positions.length === 0 ? (
          <p className="px-2 py-4 text-tape-muted">No active trades.</p>
        ) : null}
      </div>

      <footer className="border-t border-tape-line px-2 py-1.5 text-tape-muted">
        Netted in Postgres over active trades only, so a cancelled trade leaves no exposure behind.
      </footer>
    </aside>
  )
}
