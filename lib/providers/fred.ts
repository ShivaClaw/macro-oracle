import { cacheGet, cacheSet } from '@/lib/cache'
import { stableJson } from '@/lib/utils/hash'
import { nowIso, secondsBetween } from '@/lib/utils/time'
import { fetchJsonWithTimeout, redactUrlSecrets } from './http'
import { mockSeries } from './mock'
import { markProviderError, markProviderSuccess } from './status'
import type { CanonicalSeries, FetchResult } from './types'

type FredObservationsResponse = {
  observations: Array<{ date: string; value: string }>
}

export async function fetchFredSeries(opts: {
  seriesId: string
  label: string
  unit: string
  frequency: CanonicalSeries['frequency']
  limit: number
  ttlSeconds: number
  staleMaxAgeSeconds: number
}): Promise<FetchResult<CanonicalSeries>> {
  const provider = 'fred' as const

  const key = `oracle:series:fred:${opts.seriesId}:${stableJson({ limit: opts.limit })}`
  const cached = await cacheGet<CanonicalSeries>(key, { allowStale: true })
  if (cached.hit && cached.entry) {
    const ageSeconds = secondsBetween(cached.entry.storedAtMs, Date.now())
    const tooOld = ageSeconds > opts.staleMaxAgeSeconds
    if (!tooOld) {
      return {
        ok: true,
        data: cached.entry.value,
        error: null,
        meta: {
          provider,
          endpoint: cached.entry.value.source.endpoint,
          fetchedAt: cached.entry.value.source.fetchedAt,
          fromCache: true,
          stale: cached.stale,
          ttlSeconds: opts.ttlSeconds
        }
      }
    }
  }

  const apiKey = process.env.FRED_API_KEY || process.env.FRED_API_KEY_NEXT
  const endpoint = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    opts.seriesId
  )}&api_key=${encodeURIComponent(apiKey ?? '')}&file_type=json&sort_order=desc&limit=${opts.limit}`

  if (!apiKey) {
    const series = mockSeries({
      provider,
      id: opts.seriesId,
      label: opts.label,
      unit: opts.unit,
      frequency: opts.frequency,
      days: Math.max(opts.limit, 120),
      base: 4.5,
      volatility: 0.08,
      trendPerDay: 0.001
    })
    series.source.endpoint = redactUrlSecrets(endpoint)
    series.source.fetchedAt = nowIso()

    await cacheSet(key, series, opts.ttlSeconds)
    await markProviderError(provider, false, 'NO_API_KEY (served mock)')

    return {
      ok: true,
      data: series,
      error: null,
      meta: {
        provider,
        endpoint: series.source.endpoint,
        fetchedAt: series.source.fetchedAt,
        fromCache: false,
        stale: false,
        ttlSeconds: opts.ttlSeconds
      }
    }
  }

  const res = await fetchJsonWithTimeout<FredObservationsResponse>(endpoint, { timeoutMs: 5000 })
  if (!res.ok) {
    await markProviderError(provider, true, res.error.message)

    // stale fallback if available
    if (cached.hit && cached.entry) {
      return {
        ok: true,
        data: cached.entry.value,
        error: null,
        meta: {
          provider,
          endpoint: cached.entry.value.source.endpoint,
          fetchedAt: cached.entry.value.source.fetchedAt,
          fromCache: true,
          stale: true,
          ttlSeconds: opts.ttlSeconds
        }
      }
    }

    return {
      ok: false,
      data: null,
      error: { code: res.error.code, message: res.error.message, httpStatus: res.error.httpStatus },
      meta: {
        provider,
        endpoint: redactUrlSecrets(endpoint),
        fetchedAt: nowIso(),
        fromCache: false,
        stale: false,
        ttlSeconds: opts.ttlSeconds
      }
    }
  }

  try {
    const points = (res.data.observations ?? [])
      .filter((o) => o.value !== '.' && o.value !== null)
      .map((o) => ({ t: o.date, v: Number(o.value) }))
      .filter((p) => Number.isFinite(p.v))
      .reverse() // ascending

    const series: CanonicalSeries = {
      id: opts.seriesId,
      label: opts.label,
      unit: opts.unit,
      frequency: opts.frequency,
      points,
      source: { provider, endpoint: redactUrlSecrets(endpoint), fetchedAt: res.fetchedAt }
    }

    await cacheSet(key, series, opts.ttlSeconds)
    await markProviderSuccess(provider, true)

    return {
      ok: true,
      data: series,
      error: null,
      meta: {
        provider,
        endpoint: series.source.endpoint,
        fetchedAt: series.source.fetchedAt,
        fromCache: false,
        stale: false,
        ttlSeconds: opts.ttlSeconds
      }
    }
  } catch (e: any) {
    await markProviderError(provider, true, e?.message ?? 'PARSE_ERROR')
    return {
      ok: false,
      data: null,
      error: { code: 'PARSE_ERROR', message: e?.message ?? 'Failed to parse FRED payload' },
      meta: {
        provider,
        endpoint: redactUrlSecrets(endpoint),
        fetchedAt: nowIso(),
        fromCache: false,
        stale: false,
        ttlSeconds: opts.ttlSeconds
      }
    }
  }
}
