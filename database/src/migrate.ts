import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from './client.js'

const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/**
 * Safe to run on every container start: drizzle records applied migrations and
 * skips them, so a second `docker compose up` is a no-op.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const handle = createDatabase(connectionString)
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await handle.close()
  }
}

// Self-executes only when run directly, so importing this does not migrate.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }
  await runMigrations(url)
  console.error('migrations applied')
}
