import type { Session } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'
import { App } from '../../App.js'
import { logout } from '../../lib/api.js'
import { clearSession, readSession } from '../../lib/session.js'
import { AuthForm } from './AuthForm.js'
import type { Intent } from './intent.js'
import { Landing } from './Landing.js'

/** Which of landing, a form, or the blotter is on screen. State rather than routes:
 *  the blotter owns the address bar for its shareable link, and a second writer would
 *  tie a shared link to whoever was signed in when it was copied. */
export function Gate(): ReactElement {
  const [session, setSession] = useState<Session | null>(readSession)
  const [intent, setIntent] = useState<Intent | null>(null)

  const signOut = useCallback(() => {
    // Cleared first, so the window is signed out whether or not the network
    // agreed. The server is told as a courtesy and its failure is ignored.
    clearSession()
    logout().catch(() => undefined)
    setSession(null)
    setIntent(null)
  }, [])

  if (session !== null) {
    // Keyed on the trader, so signing in as someone else remounts the app rather
    // than leaving the previous identity's reads on screen.
    return <App key={session.trader} onSignOut={signOut} />
  }

  if (intent !== null) {
    return <AuthForm intent={intent} onBack={() => setIntent(null)} onSignedIn={setSession} />
  }

  return <Landing onEnter={setIntent} />
}
