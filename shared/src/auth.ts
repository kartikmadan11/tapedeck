import { z } from 'zod'
import { PARTY_MAX_LENGTH } from './trade.js'

/**
 * The shape every trader name in this system already has: `k.madan`, not
 * `Kartik Madan`. Enforced rather than left to convention, because a username
 * becomes the audit actor and travels in a request header, so the bytes it may
 * contain are bounded here instead of being trusted on the way in.
 */
export const USERNAME_PATTERN = /^[a-z][a-z0-9._-]*$/

/** A floor, not a policy. A mock store is where a habit of accepting `1` starts. */
export const PASSWORD_MIN_LENGTH = 8

export const credentials = z.strictObject({
  // Bounded by the same length as a party, since this is written as one.
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(PARTY_MAX_LENGTH)
    .regex(USERNAME_PATTERN, 'Use lowercase letters, digits, dots, dashes or underscores'),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
})
export type Credentials = z.infer<typeof credentials>

/**
 * What a signed-in window holds. The token is the whole credential after this
 * point, so the password is never stored anywhere on the client.
 */
export const session = z.object({
  trader: z.string(),
  token: z.string(),
})
export type Session = z.infer<typeof session>

/**
 * The password every seeded account is given, so the app can be opened without
 * registering first. In the contract because the server seeds with it and the
 * sign-in form prints it, and a second copy would drift from the one that works.
 *
 * In source control on purpose. This is a mock, and the accounts it opens hold
 * nothing.
 */
export const DEMO_PASSWORD = 'tapedeck'

/**
 * The actor a client stamps on a write before anyone has signed in, and now also
 * a seeded account, which is why it is here rather than in the frontend alone.
 */
export const DEFAULT_TRADER = 'k.madan'
