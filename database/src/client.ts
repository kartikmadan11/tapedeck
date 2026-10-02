import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, types } from 'pg'
import * as schema from './schema.js'

/**
 * Asserted rather than assumed: a dependency bump that registered a coercing
 * parser for numeric would silently start rounding prices, and the symptom is a
 * penny of drift rather than a test failure.
 *
 * int8 is left alone globally. Drizzle converts it per-column via
 * mode: 'number'; a global parser would also catch bigints too large for a
 * double.
 */
const NUMERIC_OID = 1700
const numericSample = types.getTypeParser(NUMERIC_OID)('1234.567890') as unknown
if (typeof numericSample !== 'string') {
  throw new TypeError(
    `pg is parsing numeric as ${typeof numericSample}, not string. ` +
      'Exact decimal prices would lose precision. Remove the numeric type parser.',
  )
}

export type Database = ReturnType<typeof createDatabase>['db']

/**
 * A transaction handle. It is not assignable to Database, which carries the
 * pool as `$client`, so anything usable in both takes Queryable instead.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export type Queryable = Database | Transaction

export interface DatabaseHandle {
  db: ReturnType<typeof drizzle<typeof schema>>
  pool: Pool
  close: () => Promise<void>
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new Pool({
    connectionString,
    // The advisory lock serialises writes anyway, so a large pool buys nothing
    // and a small one fails fast if a client is leaked.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  const db = drizzle(pool, { schema })

  return {
    db,
    pool,
    close: () => pool.end(),
  }
}

export { schema }
