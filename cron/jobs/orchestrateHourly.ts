import { SOURCES } from '../config/registry.js'
import type { JobContext } from '../jobs.js'
import type { OrchestrateHourlyPayload } from '../lib/types.js'
import { log } from '../lib/logging.js'
import { isDue, startOfHour } from '../lib/time.js'

export async function orchestrateHourly(ctx: JobContext, payload: OrchestrateHourlyPayload): Promise<void> {
  const now = new Date()
  const scheduledFor = payload.scheduledFor ? new Date(payload.scheduledFor) : startOfHour(now)
  const scheduledForIso = scheduledFor.toISOString()

  const system = await ctx.persistence.getSystemState()
  if (system.paused) {
    log('warn', 'orchestrate_hourly.skipped (system paused)', { job_run_id: ctx.jobRun.id })
    return
  }

  const dueSources: string[] = []
  const skipped: Array<{ source: string; reason: string }> = []

  for (const src of SOURCES) {
    const state = await ctx.persistence.getSourceState(src.key)

    if (!state.enabled) {
      skipped.push({ source: src.key, reason: 'disabled' })
      continue
    }

    if (state.pausedUntil && new Date(state.pausedUntil).getTime() > now.getTime()) {
      skipped.push({ source: src.key, reason: `paused_until:${state.pausedUntil}` })
      continue
    }

    if (!isDue(state.lastSuccessAt ?? null, now, src.cadence)) {
      skipped.push({ source: src.key, reason: 'not_due' })
      continue
    }

    dueSources.push(src.key)
    await ctx.enqueue({
      task: 'fetch_source',
      payload: { source: src.key, scheduledFor: scheduledForIso }
    })
  }

  // Safety net: stale/failure detection as a separate task.
  await ctx.enqueue({ task: 'health_check', payload: { now: now.toISOString() } })

  log('info', 'orchestrate_hourly.enqueued', {
    job_run_id: ctx.jobRun.id,
    scheduled_for: scheduledForIso,
    due_sources: dueSources,
    skipped
  })
}
