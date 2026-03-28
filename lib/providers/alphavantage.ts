import { cacheGet, cacheSet } from '@/lib/cache'
import { stableJson } from '@/lib/utils/hash'
import { nowIso, secondsBetween } from '@/lib/utils/time'
import { fetchJsonWithTimeout, redactUrlSecrets } from './http'
import { mockSeries } from './mock'
import { markProviderError, markProviderSuccess } from './status'
import type { CanonicalSeries, FetchResult } from './types'

type AlphaDailyAdjustedResponse = {
  'Time Series (Daily)'?: Record<string, Record<string, string>>
  'Error Message'?: string
  Note?: string
}

function getClose(row: Record<string, string>): number | null {
  // TIME_SERIES_DAILY_ADJUSTED has keys: '5. adjusted close'
  const adjusted = row['5. adjusted close']
  const close = row['4. close']
  const v = Number(adjusted ?? close)
  return Number.isFinite(v) ? v : null
}

export async function fetchAlphaVantageDailyAdjusted(opts: {
  symbol: string
  label: string
  unit: string
  outputsize?: 'compact' | 'full'
  ttlSeconds: number
  staleMaxAgeSeconds: number
}): Promise<FetchResult<CanonicalSeries>> {
  const provider = 'alphavantage' as const
  const outputsize = opts.outputsize ?? 'compact'

  const key = `oracle:series:alphavantage:${opts.symbol}:${stableJson({ outputsize })}`

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

  const apiKey = process.env.ALPHAVANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY_NEXT
  const endpoint = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
    opts.symbol
  )}&outputsize=${outputsize}&apikey=${encodeURIComponent(apiKey ?? '')}`

  if (!apiKey) {
    const base = 100
    const series = mockSeries({
      provider,
      id: opts.symbol,
      label: opts.label,
      unit: opts.unit,
      frequency: 'daily',
      days: outputsize === 'full' ? 365 : 180,
      base,
      volatility: base * 0.01,
      trendPerDay: base * 0.0004
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

  const res = await fetchJsonWithTimeout<AlphaDailyAdjustedResponse>(endpoint, { timeoutMs: 8000 })
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

  if (res.data['Error Message'] || res.data.Note) {
    const msg = res.data['Error Message'] ?? res.data.Note ?? 'Alpha Vantage error'
    await markProviderError(provider, true, msg)
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
      error: { code: 'HTTP_ERROR', message: msg },
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
    const ts = res.data['Time Series (Daily)'] ?? {}
    const points = Object.entries(ts)
      .map(([date, row]) => {
        const v = getClose(row)
        return v === null ? null : { t: date, v }
      })
      .filter((p): p is { t: string; v: number } => !!p)
      .sort((a, b) => a.t.localeCompare(b.t))

    const series: CanonicalSeries = {
      id: opts.symbol,
      label: opts.label,
      unit: opts.unit,
      frequency: 'daily',
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
      error: { code: 'PARSE_ERROR', message: e?.message ?? 'Failed to parse AlphaVantage payload' },
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
