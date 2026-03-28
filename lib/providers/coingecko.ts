import { cacheGet, cacheSet } from '@/lib/cache'
import { stableJson } from '@/lib/utils/hash'
import { nowIso, secondsBetween, toIsoDate } from '@/lib/utils/time'
import { fetchJsonWithTimeout, redactUrlSecrets } from './http'
import { mockSeries } from './mock'
import { markProviderError, markProviderSuccess } from './status'
import type { CanonicalSeries, FetchResult } from './types'

type CoinGeckoMarketChart = {
  prices?: Array<[number, number]> // [ms, price]
}

function mockBaseForCoin(id: string): number {
  const c = id.toLowerCase()
  if (c === 'bitcoin') return 68000
  if (c === 'ethereum') return 3600
  if (c === 'solana') return 190
  return 50
}

export async function fetchCoinGeckoMarketChart(opts: {
  coinId: string
  label: string
  unit: string
  days: number
  ttlSeconds: number
  staleMaxAgeSeconds: number
}): Promise<FetchResult<CanonicalSeries>> {
  const provider = 'coingecko' as const
  const key = `oracle:series:coingecko:${opts.coinId}:${stableJson({ days: opts.days })}`

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

  const proKey = process.env.COINGECKO_API_KEY || process.env.COINGECKO_API_KEY_NEXT

  const endpoint = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
    opts.coinId
  )}/market_chart?vs_currency=usd&days=${opts.days}&interval=daily`

  const headers: Record<string, string> = {}
  if (proKey) headers['x-cg-pro-api-key'] = proKey

  if (!proKey) {
    const series = mockSeries({
      provider,
      id: opts.coinId,
      label: opts.label,
      unit: opts.unit,
      frequency: 'daily',
      days: Math.max(opts.days, 365),
      base: mockBaseForCoin(opts.coinId),
      volatility: mockBaseForCoin(opts.coinId) * 0.02,
      trendPerDay: mockBaseForCoin(opts.coinId) * 0.001
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

  const res = await fetchJsonWithTimeout<CoinGeckoMarketChart>(endpoint, { timeoutMs: 7000, headers })
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
    const points = (res.data.prices ?? [])
      .map(([ms, price]) => ({ t: toIsoDate(new Date(ms)), v: Number(price) }))
      .filter((p) => Number.isFinite(p.v))

    const series: CanonicalSeries = {
      id: opts.coinId,
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
      error: { code: 'PARSE_ERROR', message: e?.message ?? 'Failed to parse CoinGecko payload' },
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
