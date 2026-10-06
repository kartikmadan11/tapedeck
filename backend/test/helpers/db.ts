import { createDatabase, type DatabaseHandle, runMigrations } from '@tapedeck/database'
import { sql } from 'drizzle-orm'

/**
 * Tests run against a real Postgres: the advisory lock, the sequence and the
 * numeric string are database behaviours a mock cannot prove.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://tapedeck:tapedeck@localhost:5433/tapedeck_test'

export async function setupTestDatabase(): Promise<DatabaseHandle> {
  await runMigrations(TEST_DATABASE_URL)
  return createDatabase(TEST_DATABASE_URL)
}

/**
 * RESTART IDENTITY already resets trade_id_seq through column ownership. The
 * explicit ALTER SEQUENCE states that rather than depending on the rule.
 */
export async function resetDatabase(handle: DatabaseHandle): Promise<void> {
  await handle.db.execute(sql`truncate table trade_events, trades restart identity cascade`)
  await handle.db.execute(sql`alter sequence trade_id_seq restart with 100001`)
}
