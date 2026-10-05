import { PARTY_MAX_LENGTH } from '@tapedeck/shared'

const STORAGE_KEY = 'tapedeck.trader'

/** The parameter an identity is handed over on, which is this build's edge. */
const ACTOR_PARAM = 'actor'

/** Returned whenever storage is empty or unavailable, so the actor is never blank. */
export const DEFAULT_TRADER = 'k.madan'

/**
 * Held in sessionStorage, which is scoped to the window rather than the browser.
 * Two windows therefore hold two identities, which is what lets the side-by-side
 * demo show two traders. A cookie or localStorage is shared across both windows
 * and could only ever hold one, so real session auth would need two browser
 * profiles to show the same thing.
 *
 * It survives a reload and not the window closing, which is the lifetime a
 * session has.
 */
export function readTrader(): string {
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
 * Takes the identity the window was handed, once, before anything reads it.
 *
 * There is nothing on screen that sets it, because an actor a trader can retype
 * is a field on a form rather than an identity. Real builds authenticate at the
 * edge and inject it, so the one thing this needs is a seam where that arrives,
 * and `?actor=` is the stand-in: one place decides who the window is, and it is
 * not the UI. An auth view later replaces this function and nothing else.
 *
 * Consumed rather than read. The parameter is taken back out of the address bar,
 * because the bar is also the workspace link: left in, it would travel to
 * whoever was sent that link and have them booking under this name.
 */
export function adoptIdentity(): void {
  const url = new URL(window.location.href)
  const handed = url.searchParams.get(ACTOR_PARAM)
  // Nothing handed over means nothing written, which keeps a link that did not
  // parse exactly as it was typed for as long as it is the only copy of it.
  if (handed === null) {
    return
  }

  url.searchParams.delete(ACTOR_PARAM)
  window.history.replaceState(null, '', url)

  const trader = handed.trim()
  // Bounded by the audit trail's own rule for an actor, since nothing between
  // here and the event store enforces it: the header is taken as given and the
  // column is `text`, so a longer name would be written and then fail to parse
  // on the way back out. Out of bounds falls back to the default rather than
  // raising, which is the decision readTrader already makes about storage.
  if (trader.length === 0 || trader.length > PARTY_MAX_LENGTH) {
    return
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, trader)
  } catch {
    // As above, except the identity is lost rather than stale. Nothing else in
    // the window holds it, deliberately: an in-memory copy here would name the
    // trader on screen while `api.ts` stamped the default on the event.
  }
}
