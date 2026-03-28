import { getEnv } from './env.js'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, unknown>

export function log(level: LogLevel, msg: string, fields: LogFields = {}) {
  const env = getEnv()
  const base = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields
  }

  // Always emit JSON (Vercel-friendly). Keep secrets out of fields.
  if (level === 'debug' && !env.CRON_DEBUG) return
  process.stdout.write(JSON.stringify(base) + '\n')
}

export function logError(msg: string, err: unknown, fields: LogFields = {}) {
  const e = err instanceof Error ? err : new Error(String(err))
  log('error', msg, {
    ...fields,
    error_name: e.name,
    error_message: e.message,
    error_stack: e.stack
  })
}
