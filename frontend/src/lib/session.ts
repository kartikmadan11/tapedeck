import { type Session, session } from '@tapedeck/shared'

const STORAGE_KEY = 'tapedeck.session'

/** In sessionStorage, like the trader name it supersedes, so two windows can be two
 *  traders at once. A cookie holds only one. Parsed on the way out, so a hand-edited
 *  entry lands on the landing page rather than an arbitrary object in state. */
export function readSession(): Session | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored === null) {
      return null
    }
    const parsed = session.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : null
  } catch {
    // Storage disabled, or the entry is not JSON. Signed out is the safe read.
    return null
  }
}

export function writeSession(value: Session): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // No in-memory fallback, deliberately: it would show the trader on screen
    // while api.ts stamped the default on the write.
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Already unreachable, so already signed out.
  }
}
