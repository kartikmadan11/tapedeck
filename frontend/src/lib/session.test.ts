import { beforeEach, describe, expect, it } from 'vitest'
import { clearSession, readSession, writeSession } from './session.js'

const STORAGE_KEY = 'tapedeck.session'

beforeEach(() => {
  // jsdom keeps storage for the whole file, so without this one case's session
  // would decide the next one's.
  sessionStorage.clear()
})

describe('the session a window holds', () => {
  it('is nothing at all until someone signs in', () => {
    expect(readSession()).toBeNull()
  })

  it('survives a reload of the window, which is what a session means', () => {
    writeSession({ trader: 'j.okonkwo', token: 'abc' })

    expect(readSession()).toEqual({ trader: 'j.okonkwo', token: 'abc' })
  })

  it('is gone after signing out', () => {
    writeSession({ trader: 'j.okonkwo', token: 'abc' })
    clearSession()

    expect(readSession()).toBeNull()
  })

  it('reads a hand-edited entry as signed out rather than trusting it', () => {
    // The entry is reachable from the console, so what it says has to be parsed
    // and not merely cast on the way out.
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ trader: 'j.okonkwo' }))

    expect(readSession()).toBeNull()
  })

  it('reads an entry that is not JSON at all as signed out', () => {
    sessionStorage.setItem(STORAGE_KEY, 'not json')

    expect(readSession()).toBeNull()
  })
})
