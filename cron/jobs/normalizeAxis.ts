import { RISK_BANDS } from '@/lib/config/riskBands'
import type { ConstituentDef, RiskBandDef } from '@/lib/config/types'
import { computeDerived, normalizeDerived, aggregateBand } from '@/lib/normalization'
import type { JobContext } from '../jobs.js'
import type { NormalizeAxisPayload, AxisValue, SeriesPoint } from '../lib/types.js'
import { log, logError } from '../lib/logging.js'
import { sha256Hex } from '../lib/hash.js'

const DEFAULT_LOOKBACK_DAYS = 90

/**
 * Converts cron SeriesPoints into CanonicalSeries-compatible point arrays
 * usable by the normalization library.
 */
function seriesPointsToCanonical(
  points: SeriesPoint[],
  def: ConstituentDef
): { points: Array<{ t: string; v: number }>; source: { provider: string; endpoint: string; fetchedAt: string }; label: string; unit: string; frequency: string } {
  return {
    points: points.map((p) => ({
      t: p.ts.slice(0, 10), // ISO date string YYYY-MM-DD
      v: p.value
    })),
    source: {
      provider: def.provider,
      endpoint: def.endpointTemplate,
      fetchedAt: points[points.length - 1]?.ingestedAt ?? new Date().toISOString()
    },
    label: def.label,
    unit: def.unit,
    frequency: def.frequency
  }
}

function buildInputsHash(points: SeriesPoint[]): string {
  const digest = points
    .slice(-10)
    .map((p) => `${p.ts}:${p.value}`)
    .join('|')
  return sha256Hex(digest).slice(0, 16)
}

export async function normalizeAxis(ctx: JobContext, payload: NormalizeAxisPayload): Promise<void> {
  const { axisKey, scheduledFor } = payload
  const lookbackDays = payload.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const method = payload.method ?? 'macro_oracle_band_score_v1'
  const now = new Date()

  const sys = await ctx.persistence.getSystemState()
  if (sys.paused) {
    log('warn', 'normalize_axis.skipped (system paused)', { axis: axisKey })
    return
  }

  // Find the band definition
  const band = RISK_BANDS.find((b: RiskBandDef) => b.id === axisKey)
  if (!band) {
    log('warn', 'normalize_axis.unknown_axis', { axis: axisKey })
    return
  }

  log('info', 'normalize_axis.start', {
    axis: axisKey,
    scheduled_for: scheduledFor,
    constituents: band.constituents.length,
    lookback_days: lookbackDays
  })

  const fromTs = new Date(now.getTime() - (lookbackDays + 30) * 86_400_000).toISOString()

  // Fetch stored series points for each constituent and normalize
  const constituentResults: Array<{
    def: ConstituentDef
    normalizedScore: number | null
    stale: boolean
    error?: string | null
    points: SeriesPoint[]
  }> = []

  for (const def of band.constituents) {
    try {
      const points = await ctx.persistence.listSeriesPoints({
        source: def.provider,
        seriesKey: def.id,
        fromTs
      })

      if (!points.length) {
        constituentResults.push({ def, normalizedScore: null, stale: false, error: 'no_series_data', points: [] })
        continue
      }

      const series = seriesPointsToCanonical(points, def)

      const derived = computeDerived(series as any, def)
      if (!derived) {
        constituentResults.push({ def, normalizedScore: null, stale: false, error: 'derived_computation_failed', points })
        continue
      }

      const normalized = normalizeDerived({ derived, series: series as any, def })
      if (!normalized) {
        constituentResults.push({ def, normalizedScore: null, stale: false, error: 'normalization_failed', points })
        continue
      }

      // Staleness: check if latest point is > staleMaxAgeSeconds old
      const latestTs = points[points.length - 1]?.ts
      const stale = latestTs
        ? (now.getTime() - new Date(latestTs).getTime()) / 1000 > def.staleMaxAgeSeconds
        : true

      constituentResults.push({ def, normalizedScore: normalized.score, stale, error: null, points })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logError('normalize_axis.constituent_error', err, { axis: axisKey, constituent: def.id })
      constituentResults.push({ def, normalizedScore: null, stale: false, error: msg, points: [] })
    }
  }

  // Aggregate band score
  const aggregation = aggregateBand({
    band,
    constituents: constituentResults.map((c) => ({
      def: c.def,
      normalizedScore: c.normalizedScore,
      stale: c.stale,
      error: c.error
    }))
  })

  if (aggregation.score === null) {
    log('warn', 'normalize_axis.insufficient_coverage', {
      axis: axisKey,
      status: aggregation.status,
      reliability: aggregation.reliability,
      errors: aggregation.errors.slice(0, 5)
    })
    // Still record the result as a null axis value so the pipeline can track staleness
  }

  // Build axis value to persist
  const ts = scheduledFor ?? new Date(now).toISOString()
  const tsDate = ts.slice(0, 10) + 'T00:00:00.000Z'

  const allPoints = constituentResults.flatMap((c) => c.points)
  const inputsHash = buildInputsHash(allPoints)

  const axisValue: AxisValue = {
    axisKey,
    ts: tsDate,
    value: aggregation.score ?? -1, // -1 sentinel for null score; consumer should check
    confidence: aggregation.reliability,
    method,
    inputsHash,
    computedAt: now.toISOString()
  }

  if (aggregation.score !== null) {
    const { upserted } = await ctx.persistence.upsertAxisValues([axisValue])

    log('info', 'normalize_axis.done', {
      axis: axisKey,
      score: aggregation.score,
      reliability: aggregation.reliability,
      status: aggregation.status,
      upserted,
      method
    })
  } else {
    log('warn', 'normalize_axis.null_score_skipped_persist', {
      axis: axisKey,
      reliability: aggregation.reliability,
      errors: aggregation.errors
    })
  }
}
