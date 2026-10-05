import type { ReactElement } from 'react'
import { CHIP } from '../../lib/ui.js'
import { useSimulation } from './useSimulation.js'

/**
 * Stops and starts the generated trade feed.
 *
 * Worth a control rather than leaving it always on: a blotter being written to
 * every couple of seconds makes it hard to demonstrate anything that needs a row
 * to hold still, the version conflict especially.
 *
 * Renders nothing until the state is known, rather than guessing a label and
 * correcting it a moment later.
 */
export function SimulationToggle(): ReactElement | null {
  const { state, toggle, pending } = useSimulation()

  if (state === undefined) {
    return null
  }

  return (
    <button
      type="button"
      className={CHIP}
      onClick={toggle}
      disabled={pending}
      // The cadence is the server's to set, so it is reported here rather than
      // offered as something to change.
      title={`Generated trade feed, one write every ${state.intervalMs}ms`}
    >
      {state.running ? 'Pause feed' : 'Start feed'}
    </button>
  )
}
