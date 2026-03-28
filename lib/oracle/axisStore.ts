/**
 * axisStore.ts
 *
 * Lightweight read-only access to persisted axis values, usable from
 * Next.js API routes (app/ boundary).
 *
 * This mirrors only the read interface of FilePersistence from cron/lib/persistence,
 * keeping the cron/ ESM layer out of the webpack build graph.
 *
 * Write path is handled exclusively by the cron runner (tsx, not Next.js).
 *
 * Storage layout (file mode):
 *   cron/.state/axis_values/<axisKey>__<method>.json
 *
 * If DATABASE_URL is set, falls back to a direct pg query rather than reading files.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RiskBandId } from '@/lib/config/types'

// ── Types (minimal, duplicated from cron/lib/types.ts to avoid cron import) ──

export type AxisValue = {
  axisKey: string
  ts: string
  value: number
  confidence: number
  method: string
  inputsHash: string
  computedAt: string
}

// ── Config ────────────────────────────────────────────────────────────────

const STATE_ROOT = join(process.cwd(), 'cron', '.state', 'axis_values')
const DEFAULT_METHOD = 'macro_oracle_band_score_v1'

function keyToFilename(key: string): string {
  return key.replaceAll('/', '_').replaceAll(':', '_')
}

function axisFilePath(axisKey: string, method: string): string {
  return join(STATE_ROOT, `${keyToFilename(axisKey)}__${keyToFilename(method)}.json`)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const buf = await readFile(path, 'utf8')
    return JSON.parse(buf) as T
  } catch {
    return fallback
  }
}

// ── Postgres path (optional) ──────────────────────────────────────────────

async function listAxisValuesPostgres(opts: {
  axisKey: string
  method: string
  fromTs?: string
  toTs?: string
  schema: string
  databaseUrl: string
}): Promise<AxisValue[]> {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 2 })
  try {
    const conditions: string[] = ['axis_key = $1', 'method = $2']
    const vals: unknown[] = [opts.axisKey, opts.method]
    let i = 3
    if (opts.fromTs) { conditions.push(`ts >= $${i++}`); vals.push(opts.fromTs) }
    if (opts.toTs) { conditions.push(`ts <= $${i++}`); vals.push(opts.toTs) }
    const res = await pool.query<{
      axisKey: string; ts: string; value: number; confidence: number;
      method: string; inputsHash: string; computedAt: string
    }>(
      `SELECT axis_key AS "axisKey", ts, value, confidence, method,
              inputs_hash AS "inputsHash", computed_at AS "computedAt"
         FROM ${opts.schema}.axis_values
         WHERE ${conditions.join(' AND ')}
         ORDER BY ts ASC`,
      vals
    )
    return res.rows as AxisValue[]
  } finally {
    await pool.end()
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * List stored axis values for a given axis + method within an optional time range.
 * Returns [] if no data is available (cron hasn't run yet or files missing).
 */
export async function listAxisValues(opts: {
  axisKey: string
  method?: string
  fromTs?: string
  toTs?: string
}): Promise<AxisValue[]> {
  const method = opts.method ?? DEFAULT_METHOD
  const databaseUrl = process.env.DATABASE_URL
  const schema = process.env.DB_SCHEMA ?? 'radar'

  if (databaseUrl && process.env.PERSISTENCE_MODE === 'postgres') {
    try {
      return await listAxisValuesPostgres({ ...opts, method, schema, databaseUrl })
    } catch {
      // fall through to file
    }
  }

  const path = axisFilePath(opts.axisKey, method)
  const all = await readJson<AxisValue[]>(path, [])

  let rows = all
  if (opts.fromTs) {
    const from = new Date(opts.fromTs).getTime()
    rows = rows.filter((r) => new Date(r.ts).getTime() >= from)
  }
  if (opts.toTs) {
    const to = new Date(opts.toTs).getTime()
    rows = rows.filter((r) => new Date(r.ts).getTime() <= to)
  }

  return rows
}

/**
 * Convenience: fetch 7d-ago scores for all specified bands in parallel.
 * Returns a map of bandId → score (or null if unavailable).
 */
export async function getSevenDayAgoScores(opts: {
  bandIds: RiskBandId[]
  asOf: string
  method?: string
}): Promise<Partial<Record<RiskBandId, number | null>>> {
  const method = opts.method ?? DEFAULT_METHOD
  const sevenDayAgoDate = new Date(opts.asOf)
  sevenDayAgoDate.setUTCDate(sevenDayAgoDate.getUTCDate() - 7)
  sevenDayAgoDate.setUTCHours(0, 0, 0, 0)
  const target = sevenDayAgoDate.toISOString()
  const lookbackFrom = new Date(sevenDayAgoDate.getTime() - 8 * 86_400_000).toISOString()

  const result: Partial<Record<RiskBandId, number | null>> = {}

  await Promise.all(
    opts.bandIds.map(async (bandId) => {
      const rows = await listAxisValues({
        axisKey: bandId,
        method,
        fromTs: lookbackFrom,
        toTs: target
      })
      // Find the latest row at or before the 7d target with a valid score (not sentinel -1)
      const best = rows.filter((r) => r.value >= 0).at(-1)
      result[bandId] = best ? best.value : null
    })
  )

  return result
}

/**
 * Fetch history points across all specified bands for the last N days.
 * Returns an array of { ts, scores } suitable for the history payload.
 */
export async function getAxisHistory(opts: {
  bandIds: RiskBandId[]
  historyDays: number
  asOf: string
  method?: string
}): Promise<Array<{ ts: string; scores: Partial<Record<RiskBandId, number>> }>> {
  const method = opts.method ?? DEFAULT_METHOD
  const histFrom = new Date(new Date(opts.asOf).getTime() - opts.historyDays * 86_400_000).toISOString()

  const tsMap = new Map<string, Partial<Record<RiskBandId, number>>>()

  await Promise.all(
    opts.bandIds.map(async (bandId) => {
      const rows = await listAxisValues({ axisKey: bandId, method, fromTs: histFrom })
      for (const r of rows) {
        if (r.value < 0) continue
        const entry = tsMap.get(r.ts) ?? {}
        entry[bandId] = r.value
        tsMap.set(r.ts, entry)
      }
    })
  )

  return Array.from(tsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, scores]) => ({ ts, scores }))
}
