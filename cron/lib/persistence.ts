import { mkdir, readFile, writeFile, appendFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  AxisValue,
  JobName,
  JobStatus,
  Severity,
  SeriesPoint,
  SourceState
} from './types.js'
import { log } from './logging.js'
import { getEnv } from './env.js'

export type JobRun = {
  id: string
  jobName: JobName
  scheduledFor?: string
  startedAt: string
  endedAt?: string
  status: JobStatus
  attempt: number
  meta?: Record<string, unknown>
}

export type TaskRun = {
  id: string
  jobRunId: string
  taskKey: string
  status: JobStatus
  attempt: number
  startedAt: string
  endedAt?: string
  errorCode?: string
  errorMessage?: string
  errorMeta?: Record<string, unknown>
}

export type AlertRow = {
  id: string
  severity: Severity
  key: string
  message: string
  meta?: Record<string, unknown>
  createdAt: string
  ackedAt?: string | null
}

export type SystemState = {
  paused: boolean
}

export interface Persistence {
  // system controls
  getSystemState(): Promise<SystemState>
  setSystemPaused(paused: boolean): Promise<void>

  // per-source controls
  getSourceState(source: string): Promise<SourceState>
  updateSourceState(source: string, patch: Partial<SourceState>): Promise<void>
  setSourceEnabled(source: string, enabled: boolean): Promise<void>
  pauseSource(source: string, minutes: number): Promise<void>

  // runs
  createJobRun(input: { jobName: JobName; scheduledFor?: string; meta?: Record<string, unknown> }): Promise<JobRun>
  finishJobRun(input: { id: string; status: JobStatus; meta?: Record<string, unknown> }): Promise<void>

  createTaskRun(input: { jobRunId: string; taskKey: string; attempt: number }): Promise<TaskRun>
  finishTaskRun(input: {
    id: string
    status: JobStatus
    errorCode?: string
    errorMessage?: string
    errorMeta?: Record<string, unknown>
  }): Promise<void>

  // data
  upsertSeriesPoints(points: SeriesPoint[]): Promise<{ upserted: number }>
  listSeriesPoints(input: { source: string; seriesKey: string; fromTs?: string; toTs?: string }): Promise<SeriesPoint[]>
  getLatestSeriesTimestamp(input: { source: string; seriesKey: string }): Promise<string | null>

  upsertAxisValues(values: AxisValue[]): Promise<{ upserted: number }>
  listAxisValues(input: { axisKey: string; method: string; fromTs?: string; toTs?: string }): Promise<AxisValue[]>
  getLatestAxisTimestamp(input: { axisKey: string; method: string }): Promise<string | null>

  // alerts
  insertAlert(alert: Omit<AlertRow, 'id' | 'createdAt'>): Promise<AlertRow>
}

function isoNow() {
  return new Date().toISOString()
}

async function ensureDir(p: string) {
  await mkdir(p, { recursive: true })
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const buf = await readFile(path, 'utf8')
    return JSON.parse(buf) as T
  } catch {
    return fallback
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await ensureDir(join(path, '..'))
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

async function appendJsonl(path: string, row: unknown): Promise<void> {
  await ensureDir(join(path, '..'))
  await appendFile(path, JSON.stringify(row) + '\n', 'utf8')
}

function keyToFilename(key: string): string {
  return key.replaceAll('/', '_').replaceAll(':', '_')
}

export class FilePersistence implements Persistence {
  private root: string

  constructor(rootDir = join(process.cwd(), 'cron', '.state')) {
    this.root = rootDir
  }

  private async init() {
    await ensureDir(this.root)
    await ensureDir(join(this.root, 'series_points'))
    await ensureDir(join(this.root, 'axis_values'))
  }

  async getSystemState(): Promise<SystemState> {
    await this.init()
    const path = join(this.root, 'system_state.json')
    return readJson<SystemState>(path, { paused: false })
  }

  async setSystemPaused(paused: boolean): Promise<void> {
    await this.init()
    const path = join(this.root, 'system_state.json')
    await writeJson(path, { paused })
  }

  async getSourceState(source: string): Promise<SourceState> {
    await this.init()
    const path = join(this.root, 'source_state.json')
    const state = await readJson<Record<string, SourceState>>(path, {})
    const existing = state[source]
    if (existing) return existing
    const initial: SourceState = { source, enabled: true, pausedUntil: null, lastSuccessAt: null, lastErrorAt: null, watermarks: {} }
    state[source] = initial
    await writeJson(path, state)
    return initial
  }

  private async setSourceState(source: string, patch: Partial<SourceState>): Promise<void> {
    await this.init()
    const path = join(this.root, 'source_state.json')
    const state = await readJson<Record<string, SourceState>>(path, {})
    const existing = state[source] ?? { source, enabled: true, pausedUntil: null, lastSuccessAt: null, lastErrorAt: null, watermarks: {} }
    state[source] = { ...existing, ...patch, source }
    await writeJson(path, state)
  }

  async updateSourceState(source: string, patch: Partial<SourceState>): Promise<void> {
    await this.setSourceState(source, patch)
  }

  async setSourceEnabled(source: string, enabled: boolean): Promise<void> {
    await this.setSourceState(source, { enabled })
  }

  async pauseSource(source: string, minutes: number): Promise<void> {
    const until = new Date(Date.now() + minutes * 60_000).toISOString()
    await this.setSourceState(source, { pausedUntil: until })
  }

  async createJobRun(input: { jobName: JobName; scheduledFor?: string; meta?: Record<string, unknown> }): Promise<JobRun> {
    await this.init()
    const run: JobRun = {
      id: randomUUID(),
      jobName: input.jobName,
      scheduledFor: input.scheduledFor,
      startedAt: isoNow(),
      status: 'running',
      attempt: 1,
      meta: input.meta
    }
    await appendJsonl(join(this.root, 'job_runs.jsonl'), run)
    return run
  }

  async finishJobRun(input: { id: string; status: JobStatus; meta?: Record<string, unknown> }): Promise<void> {
    await this.init()
    // For file mode we only append; no in-place update.
    await appendJsonl(join(this.root, 'job_runs_updates.jsonl'), { ...input, endedAt: isoNow() })
  }

  async createTaskRun(input: { jobRunId: string; taskKey: string; attempt: number }): Promise<TaskRun> {
    await this.init()
    const tr: TaskRun = {
      id: randomUUID(),
      jobRunId: input.jobRunId,
      taskKey: input.taskKey,
      status: 'running',
      attempt: input.attempt,
      startedAt: isoNow()
    }
    await appendJsonl(join(this.root, 'task_runs.jsonl'), tr)
    return tr
  }

  async finishTaskRun(input: {
    id: string
    status: JobStatus
    errorCode?: string
    errorMessage?: string
    errorMeta?: Record<string, unknown>
  }): Promise<void> {
    await this.init()
    await appendJsonl(join(this.root, 'task_runs_updates.jsonl'), { ...input, endedAt: isoNow() })
  }

  private seriesFile(source: string, seriesKey: string): string {
    return join(this.root, 'series_points', `${keyToFilename(source)}__${keyToFilename(seriesKey)}.json`)
  }

  async upsertSeriesPoints(points: SeriesPoint[]): Promise<{ upserted: number }> {
    await this.init()
    let upserted = 0

    const grouped = new Map<string, SeriesPoint[]>()
    for (const p of points) {
      const k = `${p.source}::${p.seriesKey}`
      grouped.set(k, [...(grouped.get(k) ?? []), p])
    }

    for (const [k, batch] of grouped.entries()) {
      const [source, seriesKey] = k.split('::') as [string, string]
      const path = this.seriesFile(source, seriesKey)
      const existing = await readJson<SeriesPoint[]>(path, [])
      const byTs = new Map(existing.map((x) => [x.ts, x]))
      for (const p of batch) {
        const prev = byTs.get(p.ts)
        if (!prev) {
          byTs.set(p.ts, p)
          upserted += 1
        } else {
          if (prev.value !== p.value) {
            byTs.set(p.ts, {
              ...p,
              valueMeta: { ...(prev.valueMeta ?? {}), ...(p.valueMeta ?? {}), revised: true, prev_value: prev.value }
            })
            upserted += 1
          }
        }
      }

      const merged = [...byTs.values()].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      await writeJson(path, merged)

      // Update watermarks for the source
      const latest = merged.at(-1)?.ts
      if (latest) {
        const ss = await this.getSourceState(source)
        await this.setSourceState(source, {
          watermarks: { ...(ss.watermarks ?? {}), [seriesKey]: latest }
        })
      }
    }

    log('info', 'persistence.series_points.upsert', { upserted, series_count: grouped.size })
    return { upserted }
  }

  async listSeriesPoints(input: { source: string; seriesKey: string; fromTs?: string; toTs?: string }): Promise<SeriesPoint[]> {
    await this.init()
    const path = this.seriesFile(input.source, input.seriesKey)
    const all = await readJson<SeriesPoint[]>(path, [])
    const from = input.fromTs ? new Date(input.fromTs).getTime() : -Infinity
    const to = input.toTs ? new Date(input.toTs).getTime() : Infinity
    return all.filter((p) => {
      const t = new Date(p.ts).getTime()
      return t >= from && t <= to
    })
  }

  async getLatestSeriesTimestamp(input: { source: string; seriesKey: string }): Promise<string | null> {
    const all = await this.listSeriesPoints({ source: input.source, seriesKey: input.seriesKey })
    return all.at(-1)?.ts ?? null
  }

  private axisFile(axisKey: string, method: string): string {
    return join(this.root, 'axis_values', `${keyToFilename(axisKey)}__${keyToFilename(method)}.json`)
  }

  async upsertAxisValues(values: AxisValue[]): Promise<{ upserted: number }> {
    await this.init()
    let upserted = 0

    const grouped = new Map<string, AxisValue[]>()
    for (const v of values) {
      const k = `${v.axisKey}::${v.method}`
      grouped.set(k, [...(grouped.get(k) ?? []), v])
    }

    for (const [k, batch] of grouped.entries()) {
      const [axisKey, method] = k.split('::') as [string, string]
      const path = this.axisFile(axisKey, method)
      const existing = await readJson<AxisValue[]>(path, [])
      const byTs = new Map(existing.map((x) => [x.ts, x]))

      for (const v of batch) {
        const prev = byTs.get(v.ts)
        if (!prev) {
          byTs.set(v.ts, v)
          upserted += 1
        } else {
          // recompute is allowed; overwrite
          byTs.set(v.ts, v)
          upserted += 1
        }
      }

      const merged = [...byTs.values()].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      await writeJson(path, merged)
    }

    log('info', 'persistence.axis_values.upsert', { upserted, axis_count: grouped.size })
    return { upserted }
  }

  async listAxisValues(input: { axisKey: string; method: string; fromTs?: string; toTs?: string }): Promise<AxisValue[]> {
    await this.init()
    const path = this.axisFile(input.axisKey, input.method)
    const all = await readJson<AxisValue[]>(path, [])
    const from = input.fromTs ? new Date(input.fromTs).getTime() : -Infinity
    const to = input.toTs ? new Date(input.toTs).getTime() : Infinity
    return all.filter((p) => {
      const t = new Date(p.ts).getTime()
      return t >= from && t <= to
    })
  }

  async getLatestAxisTimestamp(input: { axisKey: string; method: string }): Promise<string | null> {
    const all = await this.listAxisValues({ axisKey: input.axisKey, method: input.method })
    return all.at(-1)?.ts ?? null
  }

  async insertAlert(alert: Omit<AlertRow, 'id' | 'createdAt'>): Promise<AlertRow> {
    await this.init()
    const row: AlertRow = {
      id: randomUUID(),
      createdAt: isoNow(),
      ackedAt: null,
      ...alert
    }
    await appendJsonl(join(this.root, 'alerts.jsonl'), row)
    log('info', 'alerts.inserted', { key: row.key, severity: row.severity })
    return row
  }
}

export async function getPersistence(): Promise<Persistence> {
  const env = getEnv()
  if (env.PERSISTENCE_MODE === 'postgres') {
    // Keep postgres optional: fall back to file if DATABASE_URL missing.
    if (!env.DATABASE_URL) {
      log('warn', 'PERSISTENCE_MODE=postgres but DATABASE_URL missing; falling back to file')
      return new FilePersistence()
    }
    const { PostgresPersistence } = await import('./persistence_postgres.js')
    return new PostgresPersistence({ databaseUrl: env.DATABASE_URL, schema: env.DB_SCHEMA })
  }
  return new FilePersistence()
}
