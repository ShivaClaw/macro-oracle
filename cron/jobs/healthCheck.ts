import { SOURCES } from '../config/registry.js'
import type { JobContext } from '../jobs.js'
import type { HealthCheckPayload } from '../lib/types.js'
import { log } from '../lib/logging.js'
import { sendWebhookAlert } from '../lib/alerting.js'
import { getEnv } from '../lib/env.js'
import { RISK_BANDS } from '@/lib/config/riskBands'
import type { RiskBandDef } from '@/lib/config/types'

function minutesSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  return (now.getTime() - new Date(iso).getTime()) / 60_000
}

export async function healthCheck(ctx: JobContext, payload: HealthCheckPayload): Promise<void> {
  const now = payload.now ? new Date(payload.now) : new Date()
  const env = getEnv()

  const system = await ctx.persistence.getSystemState()
  if (system.paused) {
    log('info', 'health_check.system_paused', { now: now.toISOString() })
    return
  }

  log('info', 'health_check.start', { now: now.toISOString() })

  const alerts: Array<{ severity: 'warn' | 'error' | 'page'; key: string; message: string; meta?: Record<string, unknown> }> = []

  // ── 1. Source freshness ───────────────────────────────────────────────────
  for (const src of SOURCES) {
    const state = await ctx.persistence.getSourceState(src.key)
    if (!state.enabled) continue

    const age = minutesSince(state.lastSuccessAt, now)
    const lastError = state.lastErrorAt

    const warnMinutes =
      src.priority === 'critical'
        ? env.FRESHNESS_WARN_MINUTES_CRITICAL
        : env.FRESHNESS_WARN_MINUTES_NORMAL
    const pageMinutes =
      src.priority === 'critical' ? env.FRESHNESS_PAGE_MINUTES_CRITICAL : null

    if (age === null) {
      alerts.push({
        severity: 'warn',
        key: `source.never_succeeded.${src.key}`,
        message: `Source ${src.key} has never had a successful fetch`,
        meta: { source: src.key, priority: src.priority }
      })
    } else if (pageMinutes !== null && age >= pageMinutes) {
      alerts.push({
        severity: 'page',
        key: `source.stale.page.${src.key}`,
        message: `Source ${src.key} is stale for ${Math.round(age)}m (page threshold: ${pageMinutes}m)`,
        meta: { source: src.key, age_minutes: Math.round(age), last_success: state.lastSuccessAt, last_error: lastError }
      })
    } else if (age >= warnMinutes) {
      alerts.push({
        severity: 'warn',
        key: `source.stale.warn.${src.key}`,
        message: `Source ${src.key} is stale for ${Math.round(age)}m (warn threshold: ${warnMinutes}m)`,
        meta: { source: src.key, age_minutes: Math.round(age), last_success: state.lastSuccessAt, last_error: lastError }
      })
    }

    // Persistent error without any success after last error
    if (lastError && state.lastSuccessAt && new Date(lastError) > new Date(state.lastSuccessAt)) {
      const errorAge = minutesSince(lastError, now)
      if (errorAge !== null && errorAge < 60) {
        // Recent error; just log at info, let staleness handle escalation
        log('info', 'health_check.source_recent_error', {
          source: src.key,
          error_age_minutes: Math.round(errorAge),
          last_error: lastError
        })
      }
    }
  }

  // ── 2. Axis value freshness ───────────────────────────────────────────────
  const axisWarnMinutes = env.FRESHNESS_WARN_MINUTES_CRITICAL // axes use critical threshold
  for (const band of RISK_BANDS as RiskBandDef[]) {
    const latestTs = await ctx.persistence.getLatestAxisTimestamp({
      axisKey: band.id,
      method: 'macro_oracle_band_score_v1'
    })
    const age = minutesSince(latestTs, now)

    if (age === null) {
      alerts.push({
        severity: 'warn',
        key: `axis.never_computed.${band.id}`,
        message: `Axis ${band.id} (${band.label}) has never been computed`,
        meta: { axis: band.id }
      })
    } else if (age >= axisWarnMinutes) {
      alerts.push({
        severity: 'warn',
        key: `axis.stale.${band.id}`,
        message: `Axis ${band.id} (${band.label}) is stale: last computed ${Math.round(age)}m ago`,
        meta: { axis: band.id, age_minutes: Math.round(age), latest_ts: latestTs }
      })
    }
  }

  // ── 3. Emit + persist alerts ──────────────────────────────────────────────
  for (const alert of alerts) {
    log(alert.severity === 'page' ? 'error' : alert.severity, `health_check.alert.${alert.key}`, alert.meta ?? {})

    await ctx.persistence.insertAlert({
      severity: alert.severity,
      key: alert.key,
      message: alert.message,
      meta: alert.meta
    })

    if (alert.severity === 'page' || alert.severity === 'error') {
      await sendWebhookAlert({
        severity: alert.severity,
        key: alert.key,
        message: alert.message,
        meta: alert.meta
      })
    }
  }

  log('info', 'health_check.done', {
    checked_sources: SOURCES.length,
    checked_axes: RISK_BANDS.length,
    alerts_raised: alerts.length,
    page_alerts: alerts.filter((a) => a.severity === 'page').length,
    warn_alerts: alerts.filter((a) => a.severity === 'warn').length
  })
}
