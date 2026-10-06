import { DEFAULT_TRADER, DEMO_PASSWORD, session as sessionSchema } from '@tapedeck/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp } from './helpers/app.js'

/**
 * No database here, and nothing to reset between cases: the account store is two
 * Maps in the process, which is the whole point of the mock. Registrations do
 * carry over between cases in this file, so each one registers its own name.
 */
let app: FastifyInstance

beforeAll(async () => {
  app = await buildTestApp()
})

afterAll(async () => {
  await app.close()
})

function post(url: string, payload: Record<string, unknown>): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url, payload })
}

async function tokenFor(username: string): Promise<string> {
  const response = await post('/api/auth/login', { username, password: DEMO_PASSWORD })
  return sessionSchema.parse(response.json()).token
}

describe('POST /api/auth/login', () => {
  it('signs in a seeded trader and returns a token', async () => {
    const response = await post('/api/auth/login', {
      username: DEFAULT_TRADER,
      password: DEMO_PASSWORD,
    })

    expect(response.statusCode).toBe(200)
    const body = sessionSchema.parse(response.json())
    expect(body.trader).toBe(DEFAULT_TRADER)
    expect(body.token.length).toBeGreaterThan(0)
  })

  it('signs in the desk the seed books for, so any name on the tape works', async () => {
    const response = await post('/api/auth/login', {
      username: 'j.okonkwo',
      password: DEMO_PASSWORD,
    })

    expect(response.statusCode).toBe(200)
  })

  it('mints a new token per sign-in, so two windows are two sessions', async () => {
    const [first, second] = await Promise.all([tokenFor(DEFAULT_TRADER), tokenFor(DEFAULT_TRADER)])

    expect(first).not.toBe(second)
  })

  it('takes the name as the audit trail holds it, however it was typed', async () => {
    const response = await post('/api/auth/login', {
      username: '  K.Madan  ',
      password: DEMO_PASSWORD,
    })

    expect(sessionSchema.parse(response.json()).trader).toBe(DEFAULT_TRADER)
  })

  it('refuses a wrong password with 401', async () => {
    const response = await post('/api/auth/login', {
      username: DEFAULT_TRADER,
      password: 'not the password',
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('answers an unknown name exactly as it answers a wrong password', async () => {
    const unknown = await post('/api/auth/login', {
      username: 'nobody.here',
      password: DEMO_PASSWORD,
    })
    const wrong = await post('/api/auth/login', {
      username: DEFAULT_TRADER,
      password: 'not the password',
    })

    // Telling the two apart tells an attacker which usernames exist.
    expect(unknown.json()).toEqual(wrong.json())
  })

  it('rejects a name the audit trail could not hold', async () => {
    const response = await post('/api/auth/login', {
      username: 'Jane Street Trading',
      password: DEMO_PASSWORD,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('rejects a password under the floor before it reaches the store', async () => {
    const response = await post('/api/auth/login', { username: DEFAULT_TRADER, password: 'short' })

    expect(response.statusCode).toBe(400)
  })
})

describe('POST /api/auth/register', () => {
  it('opens an account and signs it in, so registering is one step', async () => {
    const response = await post('/api/auth/register', {
      username: 'a.newjoiner',
      password: 'a-long-enough-one',
    })

    expect(response.statusCode).toBe(201)
    expect(sessionSchema.parse(response.json()).trader).toBe('a.newjoiner')
  })

  it('refuses a name someone already holds, and names the field', async () => {
    const response = await post('/api/auth/register', {
      username: DEFAULT_TRADER,
      password: DEMO_PASSWORD,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      code: 'ALREADY_EXISTS',
      details: { field: 'username' },
    })
  })
})

describe('GET /api/auth/me', () => {
  it('reports the session a token belongs to', async () => {
    const token = await tokenFor('a.patel')

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(sessionSchema.parse(response.json()).trader).toBe('a.patel')
  })

  it('refuses a request carrying no token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' })

    expect(response.statusCode).toBe(401)
  })

  it('refuses a token the server never issued', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer made-up' },
    })

    expect(response.statusCode).toBe(401)
  })

  it('refuses a token sent without the bearer scheme', async () => {
    const token = await tokenFor('m.lindqvist')

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: token },
    })

    expect(response.statusCode).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('stops the token working', async () => {
    const token = await tokenFor('s.fernandes')
    const headers = { authorization: `Bearer ${token}` }

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers })
    expect(out.statusCode).toBe(204)

    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers })
    expect(after.statusCode).toBe(401)
  })

  it('leaves the other windows signed in', async () => {
    const [closing, staying] = await Promise.all([
      tokenFor('r.chatterjee'),
      tokenFor('r.chatterjee'),
    ])

    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${closing}` },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${staying}` },
    })
    expect(response.statusCode).toBe(200)
  })

  it('is not an error for a window that has already lost its token', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout' })

    expect(response.statusCode).toBe(204)
  })
})
