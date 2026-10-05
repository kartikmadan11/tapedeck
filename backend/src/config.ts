import { z } from 'zod'

// Validated once at startup, so a missing DATABASE_URL fails in the first second
// of `docker compose up` rather than on the first request.
const configSchema = z.object({
  DATABASE_URL: z.string().min(1, { error: 'DATABASE_URL is required' }),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Built frontend assets. Absent in development, where Vite serves them. */
  STATIC_DIR: z.string().optional(),
  /** Interval between websocket liveness pings. */
  WS_PING_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

  /**
   * The generated trade feed, on by default so a fresh checkout is live without
   * anyone setting a variable.
   *
   * Not z.coerce.boolean(): that is `Boolean(string)`, so every non-empty value
   * including "false" would parse as true and the off switch would not work.
   */
  SIMULATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  SIMULATION_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  /**
   * The active-trade ceiling. The feed stops booking new trades here and only
   * amends and cancels, which keeps a long demo inside the 100-to-1,000 range
   * the specification asks for instead of growing without bound.
   */
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
