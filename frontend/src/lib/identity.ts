import { DEFAULT_TRADER, PARTY_MAX_LENGTH } from '@tapedeck/shared'
import { readSession } from './session.js'

const STORAGE_KEY = 'tapedeck.trader'

/** The parameter an identity is handed over on. */
const ACTOR_PARAM = 'actor'

/** Returned whenever nothing is stored or storage is unavailable, so the actor is
 *  never blank. */
export { DEFAULT_TRADER }

/**
 * The name this window writes as, in order of authority: the signed-in session,
 * then the name a link handed over, then the default.
 *
 * Both are in sessionStorage, which is scoped to the window rather than the
 * browser, so two windows hold two identities. A cookie or localStorage is shared
 * across both and could only ever hold one.
 */
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
    // Storage throws when a browser has it disabled. An audit actor is not worth
    // failing a write over.
    return DEFAULT_TRADER
  }
}

/**
 * Takes the identity the window was handed, once, before anything reads it. It
 * is a suggestion, not a grant: the sign-in form starts on this name and the
 * session that sign-in returns is what the window then writes as.
 *
 * Consumed rather than read. The parameter is taken back out of the address bar,
 * because the bar is also the workspace link: left in, it would travel to
 * whoever was sent that link and have them booking under this name.
 */
export function adoptIdentity(): void {
  const url = new URL(window.location.href)
  const handed = url.searchParams.get(ACTOR_PARAM)
  // Nothing handed over means nothing written, so a link that did not parse is
  // left in the bar exactly as it was typed.
  if (handed === null) {
    return
  }

  url.searchParams.delete(ACTOR_PARAM)
  window.history.replaceState(null, '', url)

  const trader = handed.trim()
  // Bounded here because nothing between this and the event store enforces it:
  // the header is taken as given and the column is `text`, so a longer name
  // would be written and then fail to parse on the way back out.
  if (trader.length === 0 || trader.length > PARTY_MAX_LENGTH) {
    return
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, trader)
  } catch {
    // Nothing else in the window holds the identity, deliberately: an in-memory
    // copy here would name the trader on screen while `api.ts` stamped the
    // default on the event.
  }
}
