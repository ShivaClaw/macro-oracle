/**
 * PostgresPersistence — production persistence backend using Supabase/Neon/Postgres.
 *
 * Requires:
 *   DATABASE_URL=postgresql://user:pass@host:5432/dbname
 *   DB_SCHEMA=radar   (optional; default: "radar")
 *
 * Schema: see db/migrations/ for the full DDL.
 *
 * TODO: implement using `pg` (already in dependencies) or `drizzle-orm`.
 * For now this module stubs the class so TypeScript is satisfied and
 * the FilePersistence fallback in persistence.ts continues to work
 * when DATABASE_URL is missing.
 */

import pg from 'pg'
import { randomUUID } from 'node:crypto'
import type { Persistence, JobRun, TaskRun, AlertRow } from './persistence.js'
import type { AxisValue, JobName, JobStatus, SeriesPoint, SourceState } from './types.js'
import { log } from './logging.js'

const { Pool } = pg

export class PostgresPersistence implements Persistence {
  private pool: InstanceType<typeof Pool>
  private schema: string

  constructor(opts: { databaseUrl: string; schema?: string }) {
    this.pool = new Pool({ connectionString: opts.databaseUrl })
    this.schema = opts.schema ?? 'radar'
  }

  private get s() {
    return this.schema
  }

  // ── System state ─────────────────────────────────────────────────────────

  async getSystemState() {
    const res = await this.pool.query<{ value: string }>(
      `SELECT value FROM ${this.s}.metadata WHERE key = 'system.paused' LIMIT 1`
    )
    return { paused: res.rows[0]?.value === 'true' }
  }

  async setSystemPaused(paused: boolean) {
    await this.pool.query(
      `INSERT INTO ${this.s}.metadata (key, value, updated_at)
         VALUES ('system.paused', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [paused ? 'true' : 'false']
    )
  }

  // ── Source state ──────────────────────────────────────────────────────────

  async getSourceState(source: string): Promise<SourceState> {
    const res = await this.pool.query<SourceState>(
      `SELECT * FROM ${this.s}.source_state WHERE source = $1 LIMIT 1`,
      [source]
    )
    if (res.rows[0]) return res.rows[0]
    const initial: SourceState = {
      source,
      enabled: true,
      pausedUntil: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      watermarks: {}
    }
    await this.pool.query(
      `INSERT INTO ${this.s}.source_state (source, enabled, paused_until, last_success_at, last_error_at, watermarks)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (source) DO NOTHING`,
      [source, true, null, null, null, '{}']
    )
    return initial
  }

  async updateSourceState(source: string, patch: Partial<SourceState>) {
    const fields: string[] = []
    const vals: unknown[] = []
    let i = 1
    if (patch.enabled !== undefined) { fields.push(`enabled = $${i++}`); vals.push(patch.enabled) }
    if ('pausedUntil' in patch) { fields.push(`paused_until = $${i++}`); vals.push(patch.pausedUntil ?? null) }
    if ('lastSuccessAt' in patch) { fields.push(`last_success_at = $${i++}`); vals.push(patch.lastSuccessAt ?? null) }
    if ('lastErrorAt' in patch) { fields.push(`last_error_at = $${i++}`); vals.push(patch.lastErrorAt ?? null) }
    if (patch.watermarks) { fields.push(`watermarks = ${this.s}.source_state.watermarks || $${i++}::jsonb`); vals.push(JSON.stringify(patch.watermarks)) }
    if (!fields.length) return
    vals.push(source)
    await this.pool.query(
      `UPDATE ${this.s}.source_state SET ${fields.join(', ')} WHERE source = $${i}`,
      vals
    )
  }

  async setSourceEnabled(source: string, enabled: boolean) {
    await this.updateSourceState(source, { enabled })
  }

  async pauseSource(source: string, minutes: number) {
    const until = new Date(Date.now() + minutes * 60_000).toISOString()
    await this.updateSourceState(source, { pausedUntil: until })
  }

  // ── Job runs ──────────────────────────────────────────────────────────────

  async createJobRun(input: { jobName: JobName; scheduledFor?: string; meta?: Record<string, unknown> }): Promise<JobRun> {
    const id = randomUUID()
    const now = new Date().toISOString()
    await this.pool.query(
      `INSERT INTO ${this.s}.job_runs (id, job_name, scheduled_for, started_at, status, attempt, meta)
         VALUES ($1, $2, $3, $4, 'running', 1, $5::jsonb)`,
      [id, input.jobName, input.scheduledFor ?? null, now, JSON.stringify(input.meta ?? {})]
    )
    return { id, jobName: input.jobName, scheduledFor: input.scheduledFor, startedAt: now, status: 'running', attempt: 1, meta: input.meta }
  }

  async finishJobRun(input: { id: string; status: JobStatus; meta?: Record<string, unknown> }) {
    await this.pool.query(
      `UPDATE ${this.s}.job_runs SET status = $1, ended_at = now(), meta = meta || $2::jsonb WHERE id = $3`,
      [input.status, JSON.stringify(input.meta ?? {}), input.id]
    )
  }

  async createTaskRun(input: { jobRunId: string; taskKey: string; attempt: number }): Promise<TaskRun> {
    const id = randomUUID()
    const now = new Date().toISOString()
    await this.pool.query(
      `INSERT INTO ${this.s}.task_runs (id, job_run_id, task_key, status, attempt, started_at)
         VALUES ($1, $2, $3, 'running', $4, $5)`,
      [id, input.jobRunId, input.taskKey, input.attempt, now]
    )
    return { id, jobRunId: input.jobRunId, taskKey: input.taskKey, status: 'running', attempt: input.attempt, startedAt: now }
  }

  async finishTaskRun(input: { id: string; status: JobStatus; errorCode?: string; errorMessage?: string; errorMeta?: Record<string, unknown> }) {
    await this.pool.query(
      `UPDATE ${this.s}.task_runs
         SET status = $1, ended_at = now(), error_code = $2, error_message = $3, error_meta = $4::jsonb
       WHERE id = $5`,
      [input.status, input.errorCode ?? null, input.errorMessage ?? null, JSON.stringify(input.errorMeta ?? {}), input.id]
    )
  }

  // ── Series points ─────────────────────────────────────────────────────────

  async upsertSeriesPoints(points: SeriesPoint[]): Promise<{ upserted: number }> {
    if (!points.length) return { upserted: 0 }
    let upserted = 0
    for (const p of points) {
      const res = await this.pool.query(
        `INSERT INTO ${this.s}.series_points (source, series_key, ts, value, value_meta, ingested_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (source, series_key, ts) DO UPDATE
           SET value = $4, value_meta = $5::jsonb, ingested_at = $6
         WHERE ${this.s}.series_points.value IS DISTINCT FROM $4`,
        [p.source, p.seriesKey, p.ts, p.value, JSON.stringify(p.valueMeta ?? {}), p.ingestedAt]
      )
      upserted += res.rowCount ?? 0
    }
    log('info', 'postgres.series_points.upsert', { upserted, total: points.length })
    return { upserted }
  }

  async listSeriesPoints(input: { source: string; seriesKey: string; fromTs?: string; toTs?: string }): Promise<SeriesPoint[]> {
    const conditions: string[] = ['source = $1', 'series_key = $2']
    const vals: unknown[] = [input.source, input.seriesKey]
    let i = 3
    if (input.fromTs) { conditions.push(`ts >= $${i++}`); vals.push(input.fromTs) }
    if (input.toTs) { conditions.push(`ts <= $${i++}`); vals.push(input.toTs) }
    const res = await this.pool.query<{ source: string; series_key: string; ts: string; value: number; value_meta: unknown; ingested_at: string }>(
      `SELECT source, series_key AS "seriesKey", ts, value, value_meta AS "valueMeta", ingested_at AS "ingestedAt"
         FROM ${this.s}.series_points WHERE ${conditions.join(' AND ')} ORDER BY ts ASC`,
      vals
    )
    return res.rows as unknown as SeriesPoint[]
  }

  async getLatestSeriesTimestamp(input: { source: string; seriesKey: string }): Promise<string | null> {
    const res = await this.pool.query<{ ts: string }>(
      `SELECT ts FROM ${this.s}.series_points WHERE source = $1 AND series_key = $2 ORDER BY ts DESC LIMIT 1`,
      [input.source, input.seriesKey]
    )
    return res.rows[0]?.ts ?? null
  }

  // ── Axis values ───────────────────────────────────────────────────────────

  async upsertAxisValues(values: AxisValue[]): Promise<{ upserted: number }> {
    if (!values.length) return { upserted: 0 }
    let upserted = 0
    for (const v of values) {
      const res = await this.pool.query(
        `INSERT INTO ${this.s}.axis_values (axis_key, ts, value, confidence, method, inputs_hash, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (axis_key, method, ts) DO UPDATE
           SET value = $3, confidence = $4, inputs_hash = $6, computed_at = $7`,
        [v.axisKey, v.ts, v.value, v.confidence, v.method, v.inputsHash, v.computedAt]
      )
      upserted += res.rowCount ?? 0
    }
    log('info', 'postgres.axis_values.upsert', { upserted, total: values.length })
    return { upserted }
  }

  async listAxisValues(input: { axisKey: string; method: string; fromTs?: string; toTs?: string }): Promise<AxisValue[]> {
    const conditions: string[] = ['axis_key = $1', 'method = $2']
    const vals: unknown[] = [input.axisKey, input.method]
    let i = 3
    if (input.fromTs) { conditions.push(`ts >= $${i++}`); vals.push(input.fromTs) }
    if (input.toTs) { conditions.push(`ts <= $${i++}`); vals.push(input.toTs) }
    const res = await this.pool.query<{ axis_key: string; ts: string; value: number; confidence: number; method: string; inputs_hash: string; computed_at: string }>(
      `SELECT axis_key AS "axisKey", ts, value, confidence, method, inputs_hash AS "inputsHash", computed_at AS "computedAt"
         FROM ${this.s}.axis_values WHERE ${conditions.join(' AND ')} ORDER BY ts ASC`,
      vals
    )
    return res.rows as unknown as AxisValue[]
  }

  async getLatestAxisTimestamp(input: { axisKey: string; method: string }): Promise<string | null> {
    const res = await this.pool.query<{ ts: string }>(
      `SELECT ts FROM ${this.s}.axis_values WHERE axis_key = $1 AND method = $2 ORDER BY ts DESC LIMIT 1`,
      [input.axisKey, input.method]
    )
    return res.rows[0]?.ts ?? null
  }

  // ── Alerts ────────────────────────────────────────────────────────────────

  async insertAlert(alert: Omit<AlertRow, 'id' | 'createdAt'>): Promise<AlertRow> {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    await this.pool.query(
      `INSERT INTO ${this.s}.alerts (id, severity, key, message, meta, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [id, alert.severity, alert.key, alert.message, JSON.stringify(alert.meta ?? {}), createdAt]
    )
    log('info', 'postgres.alerts.inserted', { key: alert.key, severity: alert.severity })
    return { id, createdAt, ackedAt: null, ...alert }
  }
}
