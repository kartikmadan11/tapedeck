import { DEFAULT_TRADER, DEMO_PASSWORD } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import type { Intent } from './intent.js'
import { LandingTape } from './LandingTape.js'
import { Wordmark } from './Wordmark.js'

type Props = { onEnter: (intent: Intent) => void }

/** Shared by both entry buttons, so the two cannot drift in height or focus ring. */
const ENTRY =
  'h-9 cursor-pointer rounded-xs px-4 transition-colors duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tape-focus'

/** The one thing to press. White rather than the accent fill, because the mark
 *  above it is already spending that. */
const PRIMARY = `${ENTRY} bg-tape-text font-semibold text-tape-bg hover:brightness-90`

const SECONDARY = `${ENTRY} border border-tape-line text-tape-text hover:border-tape-accent hover:text-tape-accent`

/** One column on one left edge: the rest of the application is a monospace grid,
 *  and a centred hero would be the one screen that is not. */
export function Landing({ onEnter }: Props): ReactElement {
  return (
    // 72ch, not 68: px-6 takes 6.15ch out of the column, and the line below needs
    // 64 left over.
    <main className="mx-auto flex min-h-screen w-full max-w-[72ch] flex-col justify-center gap-7 px-6 py-12">
      <Wordmark className="self-start text-[clamp(3rem,12vw,6rem)]" filled />

      {/* Two lines, 63 and 57. The sentence is 121 characters, so a measure under
        63ch spills a third line holding two words. */}
      <p className="max-w-[64ch]">
        An equity trade blotter for a shared book. Bookings, amendments and cancellations reach
        every open screen as they happen.
      </p>

      <LandingTape />

      <div className="flex flex-wrap gap-2">
        <button className={PRIMARY} onClick={() => onEnter('login')} type="button">
          Log in
        </button>
        <button className={SECONDARY} onClick={() => onEnter('register')} type="button">
          Register
        </button>
      </div>

      {/* Said here rather than only in the README, because the person who needs
          it is the one looking at the form. */}
      <p className="text-[11px] text-tape-muted">
        Sign-in is mocked for this build. Use {DEFAULT_TRADER} with the password {DEMO_PASSWORD}, or
        register any name.
      </p>
    </main>
  )
}
