import { DEFAULT_TRADER, PARTY_MAX_LENGTH } from '@tapedeck/shared'
import { readSession } from './session.js'

const STORAGE_KEY = 'tapedeck.trader'

/** The parameter an identity is handed over on. */
const ACTOR_PARAM = 'actor'

/** Returned whenever nothing is stored or storage is unavailable, so the actor is
 *  never blank. */
export { DEFAULT_TRADER }

/** In order of authority: signed-in session, name a link handed over, default. Both
 *  live in sessionStorage, which is window-scoped, so two windows hold two
 *  identities. A cookie or localStorage holds only one. */
export function readTrader(): string {
  // The server issued this one, so it outranks anything a link asked for.
  const signedIn = readSession()
  if (signedIn !== null) {
    return signedIn.trader
  }

  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)?.trim()
    return stored === undefined || stored.length === 0 ? DEFAULT_TRADER : stored
  } catch {
    // Storage throws when disabled, and an actor is not worth failing a write over.
    return DEFAULT_TRADER
  }
}

/** A suggestion, not a grant: the sign-in form starts on this name and the returned
 *  session is what the window writes as. Consumed rather than read, because the
 *  address bar is also the workspace link and the name would travel with it. */
export function adoptIdentity(): void {
  const url = new URL(window.location.href)
  const handed = url.searchParams.get(ACTOR_PARAM)
  // A link that did not parse is left in the bar exactly as it was typed.
  if (handed === null) {
    return
  }

  url.searchParams.delete(ACTOR_PARAM)
  window.history.replaceState(null, '', url)

  const trader = handed.trim()
  // Bounded here because nothing downstream is: the header is taken as given and
  // the column is `text`, so a longer name is written then fails to parse back out.
  if (trader.length === 0 || trader.length > PARTY_MAX_LENGTH) {
    return
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, trader)
  } catch {
    // No in-memory fallback, deliberately: it would name the trader on screen
    // while api.ts stamped the default on the event.
  }
}
