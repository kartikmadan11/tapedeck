import { z } from 'zod'
import { PARTY_MAX_LENGTH } from './trade.js'

/** The shape every trader name here has: `k.madan`, not `Kartik Madan`. A username
 * becomes the audit actor and travels in a request header, so bound the bytes here
 * rather than trusting them on the way in. */
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

/** The token is the whole credential after this point, so the password is never
 * stored anywhere on the client. */
export const session = z.object({
  trader: z.string(),
  token: z.string(),
})
export type Session = z.infer<typeof session>

/** The password every seeded account is given. In the contract because the server seeds
 * with it and the form prints it; a second copy would drift. In source control on
 * purpose: this is a mock and the accounts hold nothing. */
export const DEMO_PASSWORD = 'tapedeck'

/** The actor a client stamps before anyone has signed in, and also a seeded account,
 * which is why it is here rather than in the frontend alone. */
export const DEFAULT_TRADER = 'k.madan'
