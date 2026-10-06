import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { alreadyExists, type Credentials, type Session, unauthenticated } from '@tapedeck/shared'

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const KEY_BYTES = 32
const SALT_BYTES = 16

interface Account {
  salt: Buffer
  key: Buffer
}

/** Mocked sign-in in one class, so the boundary is easy to find. Accounts and tokens are
 * two in-process Maps: a restart signs everyone out and a second instance shares nothing.
 * A real build replaces this file and its route. Salted and scrypt-hashed even so,
 * because a mock is what a plaintext store gets copied from. */
export class AuthService {
  private readonly accounts = new Map<string, Account>()

  /** Token to username. One entry per sign-in, so two windows signed in as the
   *  same trader can be signed out independently. */
  private readonly tokens = new Map<string, string>()

  /** Hashed against when the username is unknown, so a reply does not time the
   *  difference between a wrong name and a wrong password. */
  private readonly decoy = randomBytes(SALT_BYTES)

  /** Opens an account per name, all on one password, so the app can be reached
   *  without registering. Called once at startup. */
  async seed(usernames: readonly string[], password: string): Promise<void> {
    for (const username of usernames) {
      await this.put(username, password)
    }
  }

  async register(input: Credentials): Promise<Session> {
    if (this.accounts.has(input.username)) {
      throw alreadyExists('username', `${input.username} is already registered`)
    }
    await this.put(input.username, input.password)
    return this.mint(input.username)
  }

  async login({ username, password }: Credentials): Promise<Session> {
    const account = this.accounts.get(username)
    const key = await derive(password, account?.salt ?? this.decoy, KEY_BYTES)

    if (account === undefined || !timingSafeEqual(key, account.key)) {
      throw unauthenticated('That username and password do not match an account')
    }
    return this.mint(username)
  }

  /** Not an error twice over: a window that lost track of its token still wants out. */
  logout(token: string | null): void {
    if (token !== null) {
      this.tokens.delete(token)
    }
  }

  verify(token: string | null): Session | null {
    if (token === null) {
      return null
    }
    const trader = this.tokens.get(token)
    return trader === undefined ? null : { trader, token }
  }

  private async put(username: string, password: string): Promise<void> {
    const salt = randomBytes(SALT_BYTES)
    this.accounts.set(username, { salt, key: await derive(password, salt, KEY_BYTES) })
  }

  private mint(username: string): Session {
    const token = randomUUID()
    this.tokens.set(token, username)
    return { trader: username, token }
  }
}
