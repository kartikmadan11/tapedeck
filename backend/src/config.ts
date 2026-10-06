import { z } from 'zod'

// Validated once at startup, so a missing DATABASE_URL fails before the first
// request rather than during it.
const configSchema = z.object({
  DATABASE_URL: z.string().min(1, { error: 'DATABASE_URL is required' }),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Built frontend assets. Absent in development, where Vite serves them. */
  STATIC_DIR: z.string().optional(),
  WS_PING_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

  /** Not z.coerce.boolean(): that is `Boolean(string)`, so "false" would parse as
   * true and the off switch would not work. */
  SIMULATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  SIMULATION_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  /** The active-trade ceiling, under the 1,000 the spec allows. At this point the feed
   * stops booking and only amends and cancels. */
  SIMULATION_MAX_TRADES: z.coerce.number().int().positive().default(900),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n  ')
    throw new Error(`Invalid configuration:\n  ${issues}`)
  }
  return result.data
}
