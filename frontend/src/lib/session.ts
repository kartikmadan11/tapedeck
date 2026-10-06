import { type Session, session } from '@tapedeck/shared'

const STORAGE_KEY = 'tapedeck.session'

/**
 * Held in sessionStorage, like the trader name it supersedes, so two windows can
 * be signed in as two traders at once. That is the whole point of the handoff
 * demo, and a cookie could only ever hold one of them.
 *
 * Parsed on the way out, not trusted: a hand-edited entry must leave the app on
 * the landing page rather than put arbitrary objects into state.
 */
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
    // Nothing is held in memory instead, deliberately: an in-memory copy would
    // show the trader on screen while api.ts stamped the default on the write.
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Already unreachable, so already signed out.
  }
}
