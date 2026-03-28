import { z } from 'zod'

const boolFromString = z
  .string()
  .transform((v) => v.toLowerCase())
  .refine((v) => ['true', 'false', '1', '0', 'yes', 'no'].includes(v), 'boolean-like string')
  .transform((v) => ['true', '1', 'yes'].includes(v))

export const EnvSchema = z.object({
  CRON_ADMIN_BEARER: z.string().default(''),

  QUEUE_MODE: z.enum(['inline', 'local_file', 'qstash']).default('local_file'),
  WORKER_BASE_URL: z.string().url().default('http://localhost:3000'),
  WORKER_TASK_PATH: z.string().default('/api/worker/consume'),
  QSTASH_TOKEN: z.string().default(''),
  QSTASH_URL: z.string().url().default('https://qstash.upstash.io'),

  PERSISTENCE_MODE: z.enum(['file', 'postgres']).default('file'),
  DATABASE_URL: z.string().default(''),
  DB_SCHEMA: z.string().default('cron'),

  ALERT_WEBHOOK_URL: z.string().default(''),
  ALERT_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  SOURCE_FRED_ENABLED: z.string().optional(),
  SOURCE_COINGECKO_ENABLED: z.string().optional(),

  FRESHNESS_WARN_MINUTES_CRITICAL: z.coerce.number().int().positive().default(120),
  FRESHNESS_PAGE_MINUTES_CRITICAL: z.coerce.number().int().positive().default(360),
  FRESHNESS_WARN_MINUTES_NORMAL: z.coerce.number().int().positive().default(1440),

  CRON_DEBUG: z.preprocess((v) => (typeof v === 'string' ? v : ''), z.union([boolFromString, z.string().length(0).transform(() => false)])).default(false)
})

export type Env = z.infer<typeof EnvSchema>

let cachedEnv: Env | null = null

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv
  const parsed = EnvSchema.parse(process.env)
  cachedEnv = parsed
  return parsed
}
