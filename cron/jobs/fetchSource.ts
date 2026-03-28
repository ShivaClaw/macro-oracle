import type { ProviderName, FetchResult, CanonicalSeries } from '@/lib/providers/types'
import { fetchFredSeries } from '@/lib/providers/fred'
import { fetchFmpHistorical } from '@/lib/providers/fmp'
import { fetchAlphaVantageDailyAdjusted } from '@/lib/providers/alphavantage'
import { fetchCoinGeckoMarketChart } from '@/lib/providers/coingecko'
import { createLimiter } from '@/lib/utils/concurrency'
import { nowIso } from '@/lib/utils/time'
import { RISK_BANDS } from '@/lib/config/riskBands'
import type { ConstituentDef } from '@/lib/config/types'

import type { JobContext } from '../jobs.js'
import type { FetchSourcePayload, SeriesPoint } from '../lib/types.js'
import { RetryableError } from '../lib/errors.js'
import { log } from '../lib/logging.js'
import { bandsImpactedByProvider } from '../config/registry.js'

function providerConcurrency(provider: ProviderName): number {
  if (provider === 'alphavantage') return 1
  if (provider === 'fred') return 6
  if (provider === 'fmp') return 4
  if (provider === 'coingecko') return 4
  return 2
}

function constituentsForProvider(provider: ProviderName): ConstituentDef[] {
  const out: ConstituentDef[] = []
  for (const band of RISK_BANDS) {
    for (const c of band.constituents) {
      if (c.provider === provider) out.push(c)
    }
  }
  // de-dupe by id (constituent ids should be unique globally)
  const byId = new Map<string, ConstituentDef>()
  for (const c of out) byId.set(c.id, c)
  return [...byId.values()]
}

async function fetchConstituent(def: ConstituentDef): Promise<FetchResult<CanonicalSeries>> {
  const ttlSeconds = def.ttlSeconds
  const staleMaxAgeSeconds = def.staleMaxAgeSeconds

  if (def.provider === 'fred') {
    return await fetchFredSeries({
      seriesId: String(def.params.seriesId),
      label: def.label,
      unit: def.unit,
      frequency: def.frequency,
      limit: Number(def.params.limit ?? 200),
      ttlSeconds,
      staleMaxAgeSeconds
    })
  }

  if (def.provider === 'fmp') {
    return await fetchFmpHistorical({
      symbol: String(def.params.symbol),
      label: def.label,
      unit: def.unit,
      frequency: def.frequency,
      timeseries: Number(def.params.timeseries ?? 240),
      ttlSeconds,
      staleMaxAgeSeconds
    })
  }

  if (def.provider === 'alphavantage') {
    return await fetchAlphaVantageDailyAdjusted({
      symbol: String(def.params.symbol),
      label: def.label,
      unit: def.unit,
      outputsize: (def.params.outputsize as any) ?? 'compact',
      ttlSeconds,
      staleMaxAgeSeconds
    })
  }

  if (def.provider === 'coingecko') {
    return await fetchCoinGeckoMarketChart({
      coinId: String(def.params.coinId),
      label: def.label,
      unit: def.unit,
      days: Number(def.params.days ?? 365),
      ttlSeconds,
      staleMaxAgeSeconds
    })
  }

  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  throw new Error(`Unsupported provider: ${def.provider}`)
}

function seriesToPoints(series: CanonicalSeries, seriesKey: string): SeriesPoint[] {
  const ingestedAt = nowIso()
  return series.points.map((p) => ({
    source: series.source.provider,
    seriesKey,
    ts: `${p.t}T00:00:00.000Z`,
    value: p.v,
    valueMeta: {
      label: series.label,
      unit: series.unit,
      frequency: series.frequency,
      provider: series.source.provider,
      endpoint: series.source.endpoint,
      fetchedAt: series.source.fetchedAt
    },
    ingestedAt
  }))
}

export async function fetchSource(ctx: JobContext, payload: FetchSourcePayload): Promise<void> {
  const provider = payload.source as ProviderName
  const now = new Date()

  const sys = await ctx.persistence.getSystemState()
  if (sys.paused) {
    log('warn', 'fetch_source.skipped (system paused)', { source: provider })
    return
  }

  const state = await ctx.persistence.getSourceState(provider)
  if (!state.enabled) {
    log('warn', 'fetch_source.skipped (source disabled)', { source: provider })
    return
  }
  if (state.pausedUntil && new Date(state.pausedUntil).getTime() > now.getTime()) {
    log('warn', 'fetch_source.skipped (source paused)', { source: provider, paused_until: state.pausedUntil })
    return
  }

  const defs = constituentsForProvider(provider)
  const limit = createLimiter(providerConcurrency(provider))

  const startedAt = nowIso()
  let okCount = 0
  const errors: Array<{ id: string; code: string; message: string }> = []

  const allPoints: SeriesPoint[] = []

  await Promise.all(
    defs.map((def) =>
      limit(async () => {
        const res = await fetchConstituent(def)
        if (!res.ok) {
          errors.push({ id: def.id, code: res.error.code, message: res.error.message })
          return
        }

        okCount += 1
        allPoints.push(...seriesToPoints(res.data, def.id))
      })
    )
  )

  if (allPoints.length) {
    await ctx.persistence.upsertSeriesPoints(allPoints)
  }

  if (okCount > 0) {
    // mark success at provider level
    await ctx.persistence.updateSourceState(provider, { lastSuccessAt: startedAt })
  }

  if (errors.length) {
    // record error timestamp
    await ctx.persistence.updateSourceState(provider, { lastErrorAt: startedAt })

    log('warn', 'fetch_source.partial_failures', {
      source: provider,
      ok_constituents: okCount,
      failed_constituents: errors.length,
      examples: errors.slice(0, 5)
    })

    // If *nothing* succeeded, fail the task so it can retry.
    if (okCount === 0) {
      throw new RetryableError(`All constituent fetches failed for provider=${provider}`)
    }
  }

  // Enqueue normalization for impacted bands.
  const impacted = bandsImpactedByProvider(provider)
  for (const bandId of impacted) {
    await ctx.enqueue({
      task: 'normalize_axis',
      payload: {
        axisKey: bandId,
        scheduledFor: payload.scheduledFor,
        method: 'macro_oracle_band_score_v1'
      }
    })
  }

  log('info', 'fetch_source.done', {
    source: provider,
    scheduled_for: payload.scheduledFor,
    constituents_total: defs.length,
    constituents_ok: okCount,
    constituents_failed: errors.length,
    points_upserted: allPoints.length
  })
}
