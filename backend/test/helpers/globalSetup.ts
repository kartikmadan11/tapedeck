import { createDatabase } from '@tapedeck/database'
import { sql } from 'drizzle-orm'
import { TEST_DATABASE_URL } from './db.js'

/**
 * Creates the test database when it is missing. Nothing else in the stack does:
 * the app's compose service creates `tapedeck`, and a fresh clone running
 * `npm test` used to fail every backend file on a database the reader had no
 * reason to know the name of.
 *
 * Runs once, before any backend test file, and only for that project: a frontend
 * run still needs no Postgres.
 */
export default async function createTestDatabase(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL)
  const name = databaseName(url)
  // Postgres will not create a database over a connection to it, so this goes to
  // the one database that is always there.
  url.pathname = '/postgres'

  const handle = createDatabase(url.href)

  try {
    const found = await handle.db
      .execute(sql`select 1 from pg_database where datname = ${name}`)
      .catch((cause: unknown) => {
        throw new Error(
          `Postgres is not answering on ${url.host}, so the ${name} database cannot be created. Start it with: docker compose up -d db`,
          { cause },
        )
      })

    if (found.rows.length === 0) {
      // create database takes no bind parameters, so the name is interpolated.
      await handle.db.execute(sql.raw(`create database "${name}"`))
    }
  } finally {
    await handle.close()
  }
}

/** Checked rather than trusted, because the name reaches the statement above as
 * text and TEST_DATABASE_URL is an environment variable. */
function databaseName(url: URL): string {
  const name = decodeURIComponent(url.pathname.slice(1))

  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`TEST_DATABASE_URL names a database this cannot create: "${name}"`)
  }
  return name
}
