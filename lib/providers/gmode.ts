/**
 * G-mode (Global) radar provider
 *
 * Required Vercel env vars:
 *  - FRED_API_KEY
 *  - FMP_API_KEY
 *  - ALPHAVANTAGE_API_KEY
 *
 * Optional:
 *  - COINGECKO_API_KEY (CoinGecko Pro; free tier works without)
 */

import type {
  FlowDirection,
  MacroOracleRadarPayload,
  RiskBandPoint
} from '@/components/charts/MacroOracleRadar/types'

type BucketKey = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6'

type BucketRaw = {
  key: BucketKey
  name: string
  valueNowUsd: number
  value7dAgoUsd: number
  sources: string[]
  warnings?: string[]
}

const ONE_HOUR_MS = 60 * 60 * 1000

let cache:
  | {
      fetchedAt: number
      data: MacroOracleRadarPayload
      // keep raw USD values for easier debugging / partial fallback
      raw: Record<BucketKey, BucketRaw>
    }
  | undefined

function isoNow(): string {
  return new Date().toISOString()
}

function safeNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function flowDirection(now: number, prev: number): FlowDirection {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return 'neutral'
  const pct = (now - prev) / prev
  if (Math.abs(pct) <= 0.02) return 'neutral'
  return pct > 0 ? 'inflow' : 'outflow'
}

function toPercents(buckets: BucketRaw[]): RiskBandPoint[] {
  const total = buckets.reduce((acc, b) => acc + (Number.isFinite(b.valueNowUsd) ? b.valueNowUsd : 0), 0)
  const totalPrev = buckets.reduce(
    (acc, b) => acc + (Number.isFinite(b.value7dAgoUsd) ? b.value7dAgoUsd : 0),
    0
  )

  // Avoid division by zero; in worst-case, return equal weights.
  const denom = total > 0 ? total : buckets.length
  const denomPrev = totalPrev > 0 ? totalPrev : buckets.length

  const points = buckets.map((b) => {
    const valueNow = Number(((b.valueNowUsd / denom) * 100).toFixed(2))
    const value7dAgo = Number(((b.value7dAgoUsd / denomPrev) * 100).toFixed(2))
    const delta7d = Number((valueNow - value7dAgo).toFixed(2))

    return {
      key: b.key,
      label: b.key,
      name: b.name,
      valueNow,
      value7dAgo,
      delta7d,
      flowDirection: flowDirection(valueNow, value7dAgo)
    } satisfies RiskBandPoint
  })

  // If rounding drift occurs, we accept it (frontend can normalize if needed).
  return points
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    })

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }

    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Fetch failed'
    return { ok: false, error: msg }
  }
}

function yyyymmdd(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function nearestAtOrBefore(points: Array<{ t: string; v: number }>, targetIsoDate: string): number | null {
  const target = new Date(targetIsoDate).getTime()
  let best: { t: string; v: number } | null = null
  for (const p of points) {
    const ts = new Date(p.t).getTime()
    if (!Number.isFinite(ts)) continue
    if (ts <= target) best = p
    else break
  }
  return best?.v ?? null
}

async function fetchFredLatestAnd7dAgo(seriesId: string): Promise<{ now: number | null; prev: number | null; warning?: string }> {
  const apiKey = process.env.FRED_API_KEY
  const endpoint = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${encodeURIComponent(apiKey ?? '')}&file_type=json&sort_order=desc&limit=50`

  if (!apiKey) return { now: null, prev: null, warning: 'FRED_API_KEY missing' }

  const res = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(endpoint)
  if (!res.ok) return { now: null, prev: null, warning: `FRED ${seriesId}: ${res.error}` }

  const obs = (res.data.observations ?? [])
    .filter((o) => typeof o?.date === 'string' && typeof o?.value === 'string' && o.value !== '.')
    .map((o) => ({ t: o.date, v: Number(o.value) }))
    .filter((p) => Number.isFinite(p.v))
    .reverse() // ascending

  if (obs.length === 0) return { now: null, prev: null, warning: `FRED ${seriesId}: no data` }

  const now = obs[obs.length - 1]!.v
  const d = new Date(obs[obs.length - 1]!.t)
  d.setUTCDate(d.getUTCDate() - 7)
  const prev = nearestAtOrBefore(obs, yyyymmdd(d))

  return { now, prev: prev ?? now, ...(prev == null ? { warning: `FRED ${seriesId}: no 7d point (used latest)` } : {}) }
}

async function fetchDefiLlamaTvl(): Promise<{ now: number | null; prev: number | null; warning?: string }>{
  // Total TVL chart
  const endpoint = 'https://api.llama.fi/v2/charts'
  const res = await fetchJson<Array<{ date: number; totalLiquidityUSD: number }>>(endpoint)
  if (!res.ok) return { now: null, prev: null, warning: `DeFiLlama: ${res.error}` }

  const points = (res.data ?? [])
    .map((r) => ({
      t: yyyymmdd(new Date((r.date ?? 0) * 1000)),
      v: Number(r.totalLiquidityUSD)
    }))
    .filter((p) => Number.isFinite(p.v))

  if (points.length === 0) return { now: null, prev: null, warning: 'DeFiLlama: no data' }

  const now = points[points.length - 1]!.v
  const d = new Date(points[points.length - 1]!.t)
  d.setUTCDate(d.getUTCDate() - 7)
  const prev = nearestAtOrBefore(points, yyyymmdd(d))

  return { now, prev: prev ?? now, ...(prev == null ? { warning: 'DeFiLlama: no 7d point (used latest)' } : {}) }
}

async function fetchCoinGeckoMarketCaps(coinId: 'bitcoin' | 'ethereum'): Promise<{ now: number | null; prev: number | null; warning?: string }> {
  const endpoint = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
    coinId
  )}/market_chart?vs_currency=usd&days=14&interval=daily`

  const headers: Record<string, string> = {}
  const proKey = process.env.COINGECKO_API_KEY
  if (proKey) headers['x-cg-pro-api-key'] = proKey

  const res = await fetchJson<{ market_caps?: Array<[number, number]> }>(endpoint, { headers })
  if (!res.ok) return { now: null, prev: null, warning: `CoinGecko ${coinId}: ${res.error}` }

  const points = (res.data.market_caps ?? [])
    .map(([ms, v]) => ({ t: yyyymmdd(new Date(ms)), v: Number(v) }))
    .filter((p) => Number.isFinite(p.v))

  if (points.length === 0) return { now: null, prev: null, warning: `CoinGecko ${coinId}: no market_caps` }

  const now = points[points.length - 1]!.v
  // try exact 7d ago
  const d = new Date(points[points.length - 1]!.t)
  d.setUTCDate(d.getUTCDate() - 7)
  const prev = nearestAtOrBefore(points, yyyymmdd(d))

  return { now, prev: prev ?? now, ...(prev == null ? { warning: `CoinGecko ${coinId}: no 7d point (used latest)` } : {}) }
}

async function fetchCoinGeckoGlobalMcap(): Promise<{ now: number | null; prev: number | null; warning?: string }> {
  const headers: Record<string, string> = {}
  const proKey = process.env.COINGECKO_API_KEY
  if (proKey) headers['x-cg-pro-api-key'] = proKey

  // Current global market cap
  const globalRes = await fetchJson<{ data?: { total_market_cap?: { usd?: number } } }>(
    'https://api.coingecko.com/api/v3/global',
    { headers }
  )
  const now = globalRes.ok ? safeNumber(globalRes.data?.data?.total_market_cap?.usd) : null

  // Try (best-effort) historical global market cap chart.
  // Not guaranteed to exist on all tiers; if this fails we fall back to now.
  const chartRes = await fetchJson<{ market_caps?: Array<[number, number]> }>(
    'https://api.coingecko.com/api/v3/global/market_cap_chart?vs_currency=usd&days=14',
    { headers }
  )

  if (!now) {
    return {
      now: null,
      prev: null,
      warning: `CoinGecko global: ${globalRes.ok ? 'missing usd' : globalRes.error}`
    }
  }

  if (!chartRes.ok) {
    return {
      now,
      prev: now,
      warning: `CoinGecko global: no history (${chartRes.error}); used latest as 7d-ago`
    }
  }

  const points = (chartRes.data.market_caps ?? [])
    .map(([ms, v]) => ({ t: yyyymmdd(new Date(ms)), v: Number(v) }))
    .filter((p) => Number.isFinite(p.v))

  if (points.length === 0) return { now, prev: now, warning: 'CoinGecko global: empty history; used latest' }

  const d = new Date(points[points.length - 1]!.t)
  d.setUTCDate(d.getUTCDate() - 7)
  const prev = nearestAtOrBefore(points, yyyymmdd(d))

  return { now, prev: prev ?? now, ...(prev == null ? { warning: 'CoinGecko global: no 7d point; used latest' } : {}) }
}

async function fetchFmpEtfNetAssets(symbol: string): Promise<{ now: number | null; warning?: string }> {
  const apiKey = process.env.FMP_API_KEY
  const endpoint = `https://financialmodelingprep.com/api/v4/etf-info?symbol=${encodeURIComponent(
    symbol
  )}&apikey=${encodeURIComponent(apiKey ?? '')}`

  if (!apiKey) return { now: null, warning: 'FMP_API_KEY missing' }

  const res = await fetchJson<Array<{ netAssets?: number | string }>>(endpoint)
  if (!res.ok) return { now: null, warning: `FMP etf-info ${symbol}: ${res.error}` }

  const row = Array.isArray(res.data) ? res.data[0] : undefined
  const net = safeNumber(row?.netAssets)
  if (!net) return { now: null, warning: `FMP etf-info ${symbol}: missing netAssets` }
  return { now: net }
}

async function fetchAlphaVantageCommoditiesProxy(): Promise<{ now: number | null; prev: number | null; warning?: string }> {
  // Use weekly WTI as a crude commodity proxy (best-effort).
  const apiKey = process.env.ALPHAVANTAGE_API_KEY
  const endpoint = `https://www.alphavantage.co/query?function=WTI&interval=weekly&apikey=${encodeURIComponent(
    apiKey ?? ''
  )}`

  if (!apiKey) return { now: null, prev: null, warning: 'ALPHAVANTAGE_API_KEY missing' }

  const res = await fetchJson<{ data?: Array<{ date?: string; value?: string }> }>(endpoint)
  if (!res.ok) return { now: null, prev: null, warning: `AlphaVantage WTI: ${res.error}` }

  const points = (res.data.data ?? [])
    .filter((r) => typeof r?.date === 'string')
    .map((r) => ({ t: r.date as string, v: Number(r.value) }))
    .filter((p) => Number.isFinite(p.v))
    .reverse() // assume desc from AV, make asc

  if (points.length === 0) return { now: null, prev: null, warning: 'AlphaVantage WTI: no data' }

  const now = points[points.length - 1]!.v
  const d = new Date(points[points.length - 1]!.t)
  d.setUTCDate(d.getUTCDate() - 7)
  const prev = nearestAtOrBefore(points, yyyymmdd(d))

  // Scale WTI price (USD/bbl) into a notional USD bucket so it can be mixed with other buckets.
  // We treat it as an index and assign an arbitrary notional of 1T * (price / 100).
  const notionalNow = now * 10_000_000_000 // 100 => 1T
  const notionalPrev = (prev ?? now) * 10_000_000_000

  return {
    now: notionalNow,
    prev: notionalPrev,
    ...(prev == null ? { warning: 'AlphaVantage WTI: no 7d point (used latest)' } : {})
  }
}

function mockBuckets(): Record<BucketKey, BucketRaw> {
  // Conservative, plausible magnitudes (USD). Only used on total failure.
  const base: Record<BucketKey, BucketRaw> = {
    R1: { key: 'R1', name: 'Cash Equiv.', valueNowUsd: 8.5e12, value7dAgoUsd: 8.4e12, sources: ['mock'] },
    R2: { key: 'R2', name: 'Low Risk', valueNowUsd: 1.1e11, value7dAgoUsd: 1.05e11, sources: ['mock'] },
    R3: { key: 'R3', name: 'Core Equity', valueNowUsd: 1.05e14, value7dAgoUsd: 1.03e14, sources: ['mock'] },
    R4: { key: 'R4', name: 'Hard Assets', valueNowUsd: 2.2e13, value7dAgoUsd: 2.15e13, sources: ['mock'] },
    R5: { key: 'R5', name: 'Commodities', valueNowUsd: 9.5e11, value7dAgoUsd: 9.7e11, sources: ['mock'] },
    R6: { key: 'R6', name: 'Risk ON', valueNowUsd: 6.5e11, value7dAgoUsd: 6.2e11, sources: ['mock'] }
  }
  return base
}

export async function getGModeRadarPayload(): Promise<MacroOracleRadarPayload> {
  const nowMs = Date.now()
  if (cache && nowMs - cache.fetchedAt < ONE_HOUR_MS) return cache.data

  const warnings: string[] = []
  const raw = mockBuckets()

  // ── R1 Cash equiv: MMMF + T-bills (FRED) ────────────────────────────────
  try {
    const [mmmf, tbills] = await Promise.all([
      fetchFredLatestAnd7dAgo('MMMFFAQ027S'),
      fetchFredLatestAnd7dAgo('WRMFSL')
    ])

    if (mmmf.warning) warnings.push(mmmf.warning)
    if (tbills.warning) warnings.push(tbills.warning)

    const now = (mmmf.now ?? 0) + (tbills.now ?? 0)
    const prev = (mmmf.prev ?? mmmf.now ?? 0) + (tbills.prev ?? tbills.now ?? 0)
    if (now > 0 && prev > 0) {
      raw.R1 = {
        key: 'R1',
        name: 'Cash Equiv.',
        valueNowUsd: now,
        value7dAgoUsd: prev,
        sources: ['FRED:MMMFFAQ027S', 'FRED:WRMFSL'],
        warnings: [mmmf.warning, tbills.warning].filter((x): x is string => Boolean(x))
      }
    } else {
      warnings.push('R1: FRED returned empty; used mock')
    }
  } catch (e) {
    warnings.push(`R1: unexpected error (used mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R2 Low Risk: DeFiLlama total TVL ────────────────────────────────────
  try {
    const tvl = await fetchDefiLlamaTvl()
    if (tvl.warning) warnings.push(tvl.warning)
    if (tvl.now && tvl.prev) {
      raw.R2 = {
        key: 'R2',
        name: 'Low Risk',
        valueNowUsd: tvl.now,
        value7dAgoUsd: tvl.prev,
        sources: ['DeFiLlama:v2/charts'],
        warnings: tvl.warning ? [tvl.warning] : undefined
      }
    } else {
      warnings.push('R2: DeFiLlama returned empty; used mock')
    }
  } catch (e) {
    warnings.push(`R2: unexpected error (used mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R3 Core Equity: SPY netAssets * multiplier (FMP) ────────────────────
  try {
    const spy = await fetchFmpEtfNetAssets('SPY')
    if (spy.warning) warnings.push(spy.warning)
    // SPY netAssets in USD; multiply to approximate global equity market cap.
    const multiplier = 200
    if (spy.now) {
      const now = spy.now * multiplier
      // best-effort: infer 7d-ago by applying a small drift (avoid hard dependency on another endpoint)
      const prev = now * 0.99
      raw.R3 = {
        key: 'R3',
        name: 'Core Equity',
        valueNowUsd: now,
        value7dAgoUsd: prev,
        sources: [`FMP:etf-info(SPY)*${multiplier}x`],
        warnings: spy.warning ? [spy.warning, 'R3: 7d-ago derived (no historical AUM endpoint)'] : ['R3: 7d-ago derived (no historical AUM endpoint)']
      }
    } else {
      warnings.push('R3: FMP SPY netAssets missing; used mock')
    }
  } catch (e) {
    warnings.push(`R3: unexpected error (used mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R4 Hard Assets: BTC mcap (CoinGecko) + GLD netAssets (FMP) ──────────
  try {
    const [btc, gld] = await Promise.all([fetchCoinGeckoMarketCaps('bitcoin'), fetchFmpEtfNetAssets('GLD')])
    if (btc.warning) warnings.push(btc.warning)
    if (gld.warning) warnings.push(gld.warning)

    if (btc.now && btc.prev) {
      const gldNow = gld.now ?? 0
      const gldPrev = (gld.now ?? 0) * 0.99 // no history; approximate
      raw.R4 = {
        key: 'R4',
        name: 'Hard Assets',
        valueNowUsd: btc.now + gldNow,
        value7dAgoUsd: btc.prev + gldPrev,
        sources: ['CoinGecko:bitcoin market_caps', 'FMP:etf-info(GLD)'],
        warnings: [btc.warning, gld.warning, gld.now ? 'R4: GLD 7d-ago derived (no historical AUM endpoint)' : undefined].filter(
          (x): x is string => Boolean(x)
        )
      }
    } else {
      warnings.push('R4: CoinGecko BTC market cap missing; used mock')
    }
  } catch (e) {
    warnings.push(`R4: unexpected error (used mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R5 Commodities: AlphaVantage WTI notional proxy ─────────────────────
  try {
    const cmd = await fetchAlphaVantageCommoditiesProxy()
    if (cmd.warning) warnings.push(cmd.warning)
    if (cmd.now && cmd.prev) {
      raw.R5 = {
        key: 'R5',
        name: 'Commodities',
        valueNowUsd: cmd.now,
        value7dAgoUsd: cmd.prev,
        sources: ['AlphaVantage:WTI(weekly) notional'],
        warnings: cmd.warning ? [cmd.warning] : undefined
      }
    } else {
      warnings.push('R5: AlphaVantage WTI missing; used mock')
    }
  } catch (e) {
    warnings.push(`R5: unexpected error (used mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R6 Risk ON: total crypto mcap - BTC - ETH ───────────────────────────
  try {
    const [global, btc, eth] = await Promise.all([
      fetchCoinGeckoGlobalMcap(),
      fetchCoinGeckoMarketCaps('bitcoin'),
      fetchCoinGeckoMarketCaps('ethereum')
    ])

    if (global.warning) warnings.push(global.warning)
    if (btc.warning) warnings.push(btc.warning)
    if (eth.warning) warnings.push(eth.warning)

    if (global.now && btc.now && eth.now) {
      const altNow = Math.max(0, global.now - btc.now - eth.now)
      const altPrev = Math.max(0, (global.prev ?? global.now) - (btc.prev ?? btc.now) - (eth.prev ?? eth.now))
      raw.R6 = {
        key: 'R6',
        name: 'Risk ON',
        valueNowUsd: altNow,
        value7dAgoUsd: altPrev,
        sources: ['CoinGecko:global total_market_cap', 'CoinGecko:bitcoin market_caps', 'CoinGecko:ethereum market_caps'],
        warnings: [global.warning, btc.warning, eth.warning].filter((x): x is string => Boolean(x))
      }
    } else {
      warnings.push('R6: CoinGecko global/btc/eth missing; used mock')
    }
  } catch (e) {
    warnings.push(`R6: unexpected error (used mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  const buckets = (Object.values(raw) as BucketRaw[]).sort((a, b) => a.key.localeCompare(b.key))
  const bands = toPercents(buckets)

  const payload: MacroOracleRadarPayload = {
    asOf: isoNow(),
    mode: 'g',
    bands,
    meta: {
      source: 'gmode',
      denom: 'sum(buckets_now_usd)',
      bucketsNowUsd: Object.fromEntries(buckets.map((b) => [b.key, b.valueNowUsd])),
      buckets7dAgoUsd: Object.fromEntries(buckets.map((b) => [b.key, b.value7dAgoUsd])),
      warnings
    }
  }

  cache = { fetchedAt: nowMs, data: payload, raw: raw as Record<BucketKey, BucketRaw> }
  return payload
}
