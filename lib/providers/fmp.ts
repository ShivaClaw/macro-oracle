import { cacheGet, cacheSet } from '@/lib/cache'
import { stableJson } from '@/lib/utils/hash'
import { nowIso, secondsBetween } from '@/lib/utils/time'
import { fetchJsonWithTimeout, redactUrlSecrets } from './http'
import { mockSeries } from './mock'
import { markProviderError, markProviderSuccess } from './status'
import type { CanonicalSeries, FetchResult } from './types'

type FmpHistoricalResponse = {
  symbol?: string
  historical?: Array<{ date: string; close: number }>
}

function mockBaseForSymbol(symbol: string): number {
  const s = symbol.toUpperCase()
  if (s === 'SPY') return 520
  if (s === 'QQQ') return 450
  if (s === 'TLT') return 92
  if (s === 'LQD') return 108
  if (s === 'HYG') return 78
  if (s === 'IWM') return 205
  if (s === 'XLU') return 65
  if (s === 'GLD') return 210
  return 100
}

export async function fetchFmpHistorical(opts: {
  symbol: string
  label: string
  unit: string
  frequency: CanonicalSeries['frequency']
  timeseries: number
  ttlSeconds: number
  staleMaxAgeSeconds: number
}): Promise<FetchResult<CanonicalSeries>> {
  const provider = 'fmp' as const
  const key = `oracle:series:fmp:${opts.symbol}:${stableJson({ timeseries: opts.timeseries })}`

  const cached = await cacheGet<CanonicalSeries>(key, { allowStale: true })
  if (cached.hit && cached.entry) {
    const ageSeconds = secondsBetween(cached.entry.storedAtMs, Date.now())
    if (ageSeconds <= opts.staleMaxAgeSeconds) {
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

  const apiKey = process.env.FMP_API_KEY || process.env.FMP_API_KEY_NEXT
  const endpoint = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(
    opts.symbol
  )}?serietype=line&timeseries=${opts.timeseries}&apikey=${encodeURIComponent(apiKey ?? '')}`

  if (!apiKey) {
    const series = mockSeries({
      provider,
      id: opts.symbol,
      label: opts.label,
      unit: opts.unit,
      frequency: opts.frequency,
      days: Math.max(opts.timeseries, 220),
      base: mockBaseForSymbol(opts.symbol),
      volatility: mockBaseForSymbol(opts.symbol) * 0.004,
      trendPerDay: mockBaseForSymbol(opts.symbol) * 0.0003
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

  const res = await fetchJsonWithTimeout<FmpHistoricalResponse>(endpoint, { timeoutMs: 5000 })
  if (!res.ok) {
    await markProviderError(provider, true, res.error.message)
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
    const points = (res.data.historical ?? [])
      .map((h) => ({ t: h.date, v: Number(h.close) }))
      .filter((p) => Number.isFinite(p.v) && typeof p.t === 'string')
      .reverse() // ascending

    const series: CanonicalSeries = {
      id: opts.symbol,
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
      error: { code: 'PARSE_ERROR', message: e?.message ?? 'Failed to parse FMP payload' },
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
