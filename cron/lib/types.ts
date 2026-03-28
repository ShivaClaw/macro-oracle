export type Cadence = 'hourly' | '2h' | '4h' | 'daily' | 'weekly' | 'on_demand'
export type Priority = 'critical' | 'normal' | 'best_effort'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'retryable_failed'

export type JobName =
  | 'orchestrate_hourly'
  | 'fetch_source'
  | 'normalize_axis'
  | 'health_check'
  | 'worker:drain'

export type Severity = 'info' | 'warn' | 'error' | 'page'

export type SourceState = {
  source: string
  enabled: boolean
  pausedUntil?: string | null
  lastSuccessAt?: string | null
  lastErrorAt?: string | null
  watermarks?: Record<string, string> // series_key -> latest ts
}

export type SeriesPoint = {
  source: string
  seriesKey: string
  ts: string // ISO
  value: number
  valueMeta?: Record<string, unknown>
  ingestedAt: string
}

export type AxisValue = {
  axisKey: string
  ts: string // ISO
  value: number
  confidence: number
  method: string
  inputsHash: string
  computedAt: string
}

export type OrchestrateHourlyPayload = {
  scheduledFor?: string // ISO
}

export type FetchSourcePayload = {
  source: string
  scheduledFor: string
  lookbackHours?: number
  force?: boolean
}

export type NormalizeAxisPayload = {
  axisKey: string
  scheduledFor: string
  method?: string
  lookbackDays?: number
}

export type HealthCheckPayload = {
  now?: string
}

export type QueueTaskPayload =
  | { task: 'fetch_source'; jobRunId?: string; payload: FetchSourcePayload }
  | { task: 'normalize_axis'; jobRunId?: string; payload: NormalizeAxisPayload }
  | { task: 'health_check'; jobRunId?: string; payload: HealthCheckPayload }
