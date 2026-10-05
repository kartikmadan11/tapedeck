const STORAGE_KEY = 'tapedeck.trader'

/** Returned whenever storage is empty or unavailable, so the actor is never blank. */
export const DEFAULT_TRADER = 'k.madan'

/**
 * Held in sessionStorage, which is scoped to the window rather than the browser.
 * Two windows therefore hold two identities, which is what lets the side-by-side
 * demo show two traders. A cookie or localStorage is shared across both windows
 * and could only ever hold one, so real session auth would need two browser
 * profiles to show the same thing.
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

export function writeTrader(trader: string): void {
  const trimmed = trader.trim()
  try {
    sessionStorage.setItem(STORAGE_KEY, trimmed.length === 0 ? DEFAULT_TRADER : trimmed)
  } catch {
    // As above. The in-memory value still drives this window.
  }
}
