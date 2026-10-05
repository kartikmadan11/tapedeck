import { beforeEach, describe, expect, it } from 'vitest'
import { adoptIdentity, DEFAULT_TRADER, readTrader } from './identity.js'

beforeEach(() => {
  // jsdom keeps both of these for the whole file, so without this one case's
  // identity, or the parameter it arrived on, would decide the next one's.
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

/** Arriving on a link, which is the only way an identity gets in. */
function arriveOn(search: string): void {
  window.history.replaceState(null, '', search)
  adoptIdentity()
}

describe('the identity a window trades as', () => {
  it('is the one it was handed, and is not in the address bar afterwards', () => {
    arriveOn('/?actor=j.okonkwo')

    expect(readTrader()).toBe('j.okonkwo')
    // Consumed rather than read, because the same bar carries the workspace
    // link: left in, it would travel to whoever was sent that link and have
    // them booking under this name.
    expect(window.location.search).toBe('')
  })

  it('leaves the workspace in the link it arrived on', () => {
    arriveOn('/?actor=j.okonkwo&panes=2&axis=columns')

    expect(window.location.search).toBe('?panes=2&axis=columns')
  })

  it('survives a reload of the window, which is what a session means', () => {
    arriveOn('/?actor=j.okonkwo')

    // The reload: same window, same storage, and the parameter is long gone.
    adoptIdentity()

    expect(readTrader()).toBe('j.okonkwo')
  })

  it('writes nothing at all when nobody handed one over', () => {
    window.history.replaceState(null, '', '/?panes=1&p1.group=pnl')
    adoptIdentity()

    // A link that does not parse is the one somebody needs to be able to read,
    // and on arrival the bar is the only copy of what they typed.
    expect(window.location.search).toBe('?panes=1&p1.group=pnl')
    expect(readTrader()).toBe(DEFAULT_TRADER)
  })

  it('refuses an actor the audit trail could not hold, and still consumes it', () => {
    // Nothing between here and the event store enforces the bound, so a name
    // this long would be written and then fail to parse on the way back out.
    arriveOn(`/?actor=${'k'.repeat(65)}`)

    expect(readTrader()).toBe(DEFAULT_TRADER)
    expect(window.location.search).toBe('')
  })

  it('takes a blank actor as nobody at all', () => {
    arriveOn('/?actor=%20')

    expect(readTrader()).toBe(DEFAULT_TRADER)
  })
})
