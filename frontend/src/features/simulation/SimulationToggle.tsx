import type { ReactElement } from 'react'
import { CHIP } from '../../lib/ui.js'
import { useSimulation } from './useSimulation.js'

/** Renders nothing until the state is known, rather than guessing a label and
 *  correcting it a moment later. */
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
      // The cadence is the server's to set, so it is reported, not offered.
      title={`Generated trade feed, one write every ${state.intervalMs}ms`}
    >
      {state.running ? 'Pause feed' : 'Start feed'}
    </button>
  )
}
