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
 *
 * Band → sector mapping:
 *  R1 = $ (Cash / Money Market)
 *  R2 = Low Risk  (DeFi TVL)
 *  R3 = Core Equity
 *  R4 = Risk OFF  (BTC + Gold)
 *  R5 = Vital Commodities
 *  R6 = Risk ON   (altcoin market cap)
 */

import type {
  FlowDirection,
  MacroOracleRadarPayload,
  RiskBandPoint
} from '@/components/charts/MacroOracleRadar/types'

type BucketKey = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6'

type BucketRaw = {
  key: BucketKey
  /** Human-readable name shown on radar vertex and in table */
  name: string
  valueNowUsd: number
  value7dAgoUsd: number
  valueYtdAgoUsd: number
  sources: string[]
  warnings?: string[]
}

const ONE_HOUR_MS = 60 * 60 * 1000

let cache:
  | {
      fetchedAt: number
      data: MacroOracleRadarPayload
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
  const total = buckets.reduce(
    (acc, b) => acc + (Number.isFinite(b.valueNowUsd) ? b.valueNowUsd : 0),
    0
  )
  const totalPrev = buckets.reduce(
    (acc, b) => acc + (Number.isFinite(b.value7dAgoUsd) ? b.value7dAgoUsd : 0),
    0
  )

  const denom = total > 0 ? total : buckets.length
  const denomPrev = totalPrev > 0 ? totalPrev : buckets.length

  return buckets.map((b) => {
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
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
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
    return { ok: false, error: e instanceof Error ? e.message : 'Fetch failed' }
  }
}

function yyyymmdd(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** Returns YTD start date string for the current year (Jan 1) */
function ytdStart(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-01-01`
}

function nearestAtOrBefore(
  points: Array<{ t: string; v: number }>,
  targetIsoDate: string
): number | null {
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

// ── FRED ─────────────────────────────────────────────────────────────────

async function fetchFredSeries(seriesId: string): Promise<{
  now: number | null
  prev7d: number | null
  prevYtd: number | null
  warning?: string
}> {
  const apiKey = process.env.FRED_API_KEY
  const endpoint = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${encodeURIComponent(apiKey ?? '')}&file_type=json&sort_order=desc&limit=200`

  if (!apiKey) return { now: null, prev7d: null, prevYtd: null, warning: 'FRED_API_KEY missing' }

  const res = await fetchJson<{ observations?: Array<{ date: string; value: string }> }>(endpoint)
  if (!res.ok)
    return { now: null, prev7d: null, prevYtd: null, warning: `FRED ${seriesId}: ${res.error}` }

  const obs = (res.data.observations ?? [])
    .filter((o) => typeof o?.date === 'string' && o.value !== '.')
    .map((o) => ({ t: o.date, v: Number(o.value) }))
    .filter((p) => Number.isFinite(p.v))
    .reverse() // asc

  if (!obs.length) return { now: null, prev7d: null, prevYtd: null, warning: `FRED ${seriesId}: no data` }

  const latest = obs[obs.length - 1]!
  const now = latest.v

  const d7 = new Date(latest.t)
  d7.setUTCDate(d7.getUTCDate() - 7)
  const prev7d = nearestAtOrBefore(obs, yyyymmdd(d7))

  const prevYtd = nearestAtOrBefore(obs, ytdStart())

  return { now, prev7d: prev7d ?? now, prevYtd: prevYtd ?? now }
}

// ── DeFiLlama ────────────────────────────────────────────────────────────

async function fetchDefiLlamaTvl(): Promise<{
  now: number | null
  prev7d: number | null
  prevYtd: number | null
  warning?: string
}> {
  const res = await fetchJson<Array<{ date: number; totalLiquidityUSD: number }>>(
    'https://api.llama.fi/v2/charts'
  )
  if (!res.ok) return { now: null, prev7d: null, prevYtd: null, warning: `DeFiLlama: ${res.error}` }

  const points = (res.data ?? [])
    .map((r) => ({ t: yyyymmdd(new Date((r.date ?? 0) * 1000)), v: Number(r.totalLiquidityUSD) }))
    .filter((p) => Number.isFinite(p.v))

  if (!points.length) return { now: null, prev7d: null, prevYtd: null, warning: 'DeFiLlama: no data' }

  const latest = points[points.length - 1]!
  const now = latest.v

  const d7 = new Date(latest.t)
  d7.setUTCDate(d7.getUTCDate() - 7)

  return {
    now,
    prev7d: nearestAtOrBefore(points, yyyymmdd(d7)) ?? now,
    prevYtd: nearestAtOrBefore(points, ytdStart()) ?? now
  }
}

// ── CoinGecko — coin market chart ────────────────────────────────────────

async function fetchCoinGeckoMarketCaps(coinId: 'bitcoin' | 'ethereum'): Promise<{
  now: number | null
  prev7d: number | null
  prevYtd: number | null
  warning?: string
}> {
  // request 365 days to cover YTD
  const endpoint = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
    coinId
  )}/market_chart?vs_currency=usd&days=365&interval=daily`

  const headers: Record<string, string> = {}
  const proKey = process.env.COINGECKO_API_KEY
  if (proKey) headers['x-cg-pro-api-key'] = proKey

  const res = await fetchJson<{ market_caps?: Array<[number, number]> }>(endpoint, { headers })
  if (!res.ok)
    return { now: null, prev7d: null, prevYtd: null, warning: `CoinGecko ${coinId}: ${res.error}` }

  const points = (res.data.market_caps ?? [])
    .map(([ms, v]) => ({ t: yyyymmdd(new Date(ms)), v: Number(v) }))
    .filter((p) => Number.isFinite(p.v))

  if (!points.length)
    return { now: null, prev7d: null, prevYtd: null, warning: `CoinGecko ${coinId}: no market_caps` }

  const latest = points[points.length - 1]!
  const now = latest.v

  const d7 = new Date(latest.t)
  d7.setUTCDate(d7.getUTCDate() - 7)

  return {
    now,
    prev7d: nearestAtOrBefore(points, yyyymmdd(d7)) ?? now,
    prevYtd: nearestAtOrBefore(points, ytdStart()) ?? now
  }
}

// ── CoinGecko — global market cap ────────────────────────────────────────

async function fetchCoinGeckoGlobal(): Promise<{
  now: number | null
  prev7d: number | null
  prevYtd: number | null
  warning?: string
}> {
  const headers: Record<string, string> = {}
  const proKey = process.env.COINGECKO_API_KEY
  if (proKey) headers['x-cg-pro-api-key'] = proKey

  const globalRes = await fetchJson<{ data?: { total_market_cap?: { usd?: number } } }>(
    'https://api.coingecko.com/api/v3/global',
    { headers }
  )
  const now = globalRes.ok ? safeNumber(globalRes.data?.data?.total_market_cap?.usd) : null

  if (!now)
    return {
      now: null,
      prev7d: null,
      prevYtd: null,
      warning: `CoinGecko global: ${globalRes.ok ? 'missing usd' : globalRes.error}`
    }

  const chartRes = await fetchJson<{ market_caps?: Array<[number, number]> }>(
    'https://api.coingecko.com/api/v3/global/market_cap_chart?vs_currency=usd&days=365',
    { headers }
  )

  if (!chartRes.ok)
    return {
      now,
      prev7d: now,
      prevYtd: now,
      warning: `CoinGecko global: no history (${chartRes.error}); used latest`
    }

  const points = (chartRes.data.market_caps ?? [])
    .map(([ms, v]) => ({ t: yyyymmdd(new Date(ms)), v: Number(v) }))
    .filter((p) => Number.isFinite(p.v))

  if (!points.length)
    return { now, prev7d: now, prevYtd: now, warning: 'CoinGecko global: empty history' }

  const latest = points[points.length - 1]!
  const d7 = new Date(latest.t)
  d7.setUTCDate(d7.getUTCDate() - 7)

  return {
    now,
    prev7d: nearestAtOrBefore(points, yyyymmdd(d7)) ?? now,
    prevYtd: nearestAtOrBefore(points, ytdStart()) ?? now
  }
}

// ── FMP — ETF net assets ─────────────────────────────────────────────────

async function fetchFmpEtfNetAssets(symbol: string): Promise<{
  now: number | null
  warning?: string
}> {
  const apiKey = process.env.FMP_API_KEY
  if (!apiKey) return { now: null, warning: 'FMP_API_KEY missing' }

  const endpoint = `https://financialmodelingprep.com/api/v4/etf-info?symbol=${encodeURIComponent(
    symbol
  )}&apikey=${encodeURIComponent(apiKey)}`

  const res = await fetchJson<Array<{ netAssets?: number | string }>>(endpoint)
  if (!res.ok) return { now: null, warning: `FMP etf-info ${symbol}: ${res.error}` }

  const net = safeNumber(Array.isArray(res.data) ? res.data[0]?.netAssets : undefined)
  if (!net) return { now: null, warning: `FMP etf-info ${symbol}: missing netAssets` }
  return { now: net }
}

// ── AlphaVantage — WTI weekly ────────────────────────────────────────────

async function fetchWtiNotional(): Promise<{
  now: number | null
  prev7d: number | null
  prevYtd: number | null
  warning?: string
}> {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY
  if (!apiKey)
    return { now: null, prev7d: null, prevYtd: null, warning: 'ALPHAVANTAGE_API_KEY missing' }

  const endpoint = `https://www.alphavantage.co/query?function=WTI&interval=weekly&apikey=${encodeURIComponent(
    apiKey
  )}`

  const res = await fetchJson<{ data?: Array<{ date?: string; value?: string }> }>(endpoint)
  if (!res.ok)
    return { now: null, prev7d: null, prevYtd: null, warning: `AlphaVantage WTI: ${res.error}` }

  const points = (res.data.data ?? [])
    .filter((r) => typeof r?.date === 'string')
    .map((r) => ({ t: r.date as string, v: Number(r.value) }))
    .filter((p) => Number.isFinite(p.v))
    .reverse() // make ascending

  if (!points.length)
    return { now: null, prev7d: null, prevYtd: null, warning: 'AlphaVantage WTI: no data' }

  const latest = points[points.length - 1]!
  // Scale WTI (USD/bbl) into a notional bucket (100 USD/bbl ≈ 1T)
  const toNotional = (price: number) => price * 10_000_000_000

  const d7 = new Date(latest.t)
  d7.setUTCDate(d7.getUTCDate() - 7)
  const p7 = nearestAtOrBefore(points, yyyymmdd(d7))
  const pYtd = nearestAtOrBefore(points, ytdStart())

  return {
    now: toNotional(latest.v),
    prev7d: toNotional(p7 ?? latest.v),
    prevYtd: toNotional(pYtd ?? latest.v)
  }
}

// ── Mock buckets ──────────────────────────────────────────────────────────

function mockBuckets(): Record<BucketKey, BucketRaw> {
  return {
    R1: { key: 'R1', name: '$',                valueNowUsd: 8.5e12, value7dAgoUsd: 8.4e12,  valueYtdAgoUsd: 8.0e12,  sources: ['mock'] },
    R2: { key: 'R2', name: 'Low Risk',          valueNowUsd: 1.1e11, value7dAgoUsd: 1.05e11, valueYtdAgoUsd: 9.5e10,  sources: ['mock'] },
    R3: { key: 'R3', name: 'Core Equity',       valueNowUsd: 1.05e14, value7dAgoUsd: 1.03e14, valueYtdAgoUsd: 1.0e14, sources: ['mock'] },
    R4: { key: 'R4', name: 'Risk OFF',          valueNowUsd: 2.2e13, value7dAgoUsd: 2.15e13, valueYtdAgoUsd: 2.0e13,  sources: ['mock'] },
    R5: { key: 'R5', name: 'Vital Commodities', valueNowUsd: 9.5e11, value7dAgoUsd: 9.7e11,  valueYtdAgoUsd: 9.0e11,  sources: ['mock'] },
    R6: { key: 'R6', name: 'Risk ON',           valueNowUsd: 6.5e11, value7dAgoUsd: 6.2e11,  valueYtdAgoUsd: 5.0e11,  sources: ['mock'] }
  }
}

// ── Main export ───────────────────────────────────────────────────────────

export async function getGModeRadarPayload(): Promise<MacroOracleRadarPayload> {
  const nowMs = Date.now()
  if (cache && nowMs - cache.fetchedAt < ONE_HOUR_MS) return cache.data

  const warnings: string[] = []
  const raw = mockBuckets()

  // ── R1 $ (Cash / Money Markets) ─────────────────────────────────────────
  try {
    const [mmmf, tbills] = await Promise.all([
      fetchFredSeries('MMMFFAQ027S'),
      fetchFredSeries('WRMFSL')
    ])
    if (mmmf.warning) warnings.push(mmmf.warning)
    if (tbills.warning) warnings.push(tbills.warning)

    const now = (mmmf.now ?? 0) + (tbills.now ?? 0)
    const prev7d = (mmmf.prev7d ?? mmmf.now ?? 0) + (tbills.prev7d ?? tbills.now ?? 0)
    const prevYtd = (mmmf.prevYtd ?? mmmf.now ?? 0) + (tbills.prevYtd ?? tbills.now ?? 0)

    if (now > 0) {
      raw.R1 = {
        key: 'R1',
        name: '$',
        valueNowUsd: now,
        value7dAgoUsd: prev7d,
        valueYtdAgoUsd: prevYtd,
        sources: ['FRED:MMMFFAQ027S', 'FRED:WRMFSL']
      }
    } else {
      warnings.push('R1: FRED empty; used mock')
    }
  } catch (e) {
    warnings.push(`R1: error (mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R2 Low Risk (DeFi TVL) ───────────────────────────────────────────────
  try {
    const tvl = await fetchDefiLlamaTvl()
    if (tvl.warning) warnings.push(tvl.warning)
    if (tvl.now && tvl.prev7d && tvl.prevYtd) {
      raw.R2 = {
        key: 'R2',
        name: 'Low Risk',
        valueNowUsd: tvl.now,
        value7dAgoUsd: tvl.prev7d,
        valueYtdAgoUsd: tvl.prevYtd,
        sources: ['DeFiLlama:v2/charts']
      }
    } else {
      warnings.push('R2: DeFiLlama empty; used mock')
    }
  } catch (e) {
    warnings.push(`R2: error (mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R3 Core Equity (SPY AUM proxy) ──────────────────────────────────────
  try {
    const spy = await fetchFmpEtfNetAssets('SPY')
    if (spy.warning) warnings.push(spy.warning)
    if (spy.now) {
      const multiplier = 200
      const now = spy.now * multiplier
      raw.R3 = {
        key: 'R3',
        name: 'Core Equity',
        valueNowUsd: now,
        value7dAgoUsd: now * 0.99,
        valueYtdAgoUsd: now * 0.95,
        sources: [`FMP:etf-info(SPY)*${multiplier}x`],
        warnings: ['7d/YTD derived (no historical SPY AUM endpoint)']
      }
    } else {
      warnings.push('R3: FMP SPY missing; used mock')
    }
  } catch (e) {
    warnings.push(`R3: error (mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R4 Risk OFF (BTC + Gold) ─────────────────────────────────────────────
  try {
    const [btc, gld] = await Promise.all([fetchCoinGeckoMarketCaps('bitcoin'), fetchFmpEtfNetAssets('GLD')])
    if (btc.warning) warnings.push(btc.warning)
    if (gld.warning) warnings.push(gld.warning)

    if (btc.now && btc.prev7d) {
      const gldNow = gld.now ?? 0
      raw.R4 = {
        key: 'R4',
        name: 'Risk OFF',
        valueNowUsd: btc.now + gldNow,
        value7dAgoUsd: btc.prev7d + (gldNow * 0.99),
        valueYtdAgoUsd: (btc.prevYtd ?? btc.now) + (gldNow * 0.92),
        sources: ['CoinGecko:bitcoin market_caps', 'FMP:etf-info(GLD)'],
        warnings: gld.now ? ['GLD 7d/YTD derived (no historical AUM)'] : ['GLD missing, BTC only']
      }
    } else {
      warnings.push('R4: CoinGecko BTC missing; used mock')
    }
  } catch (e) {
    warnings.push(`R4: error (mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R5 Vital Commodities (WTI proxy) ────────────────────────────────────
  try {
    const cmd = await fetchWtiNotional()
    if (cmd.warning) warnings.push(cmd.warning)
    if (cmd.now && cmd.prev7d && cmd.prevYtd) {
      raw.R5 = {
        key: 'R5',
        name: 'Vital Commodities',
        valueNowUsd: cmd.now,
        value7dAgoUsd: cmd.prev7d,
        valueYtdAgoUsd: cmd.prevYtd,
        sources: ['AlphaVantage:WTI(weekly) notional']
      }
    } else {
      warnings.push('R5: AV WTI missing; used mock')
    }
  } catch (e) {
    warnings.push(`R5: error (mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  // ── R6 Risk ON (altcoin market cap = total - BTC - ETH) ──────────────────
  try {
    const [global, btc, eth] = await Promise.all([
      fetchCoinGeckoGlobal(),
      fetchCoinGeckoMarketCaps('bitcoin'),
      fetchCoinGeckoMarketCaps('ethereum')
    ])
    if (global.warning) warnings.push(global.warning)
    if (btc.warning) warnings.push(btc.warning)
    if (eth.warning) warnings.push(eth.warning)

    if (global.now && btc.now && eth.now) {
      raw.R6 = {
        key: 'R6',
        name: 'Risk ON',
        valueNowUsd: Math.max(0, global.now - btc.now - eth.now),
        value7dAgoUsd: Math.max(
          0,
          (global.prev7d ?? global.now) - (btc.prev7d ?? btc.now) - (eth.prev7d ?? eth.now)
        ),
        valueYtdAgoUsd: Math.max(
          0,
          (global.prevYtd ?? global.now) - (btc.prevYtd ?? btc.now) - (eth.prevYtd ?? eth.now)
        ),
        sources: ['CoinGecko:global', 'CoinGecko:bitcoin', 'CoinGecko:ethereum']
      }
    } else {
      warnings.push('R6: CoinGecko missing; used mock')
    }
  } catch (e) {
    warnings.push(`R6: error (mock): ${e instanceof Error ? e.message : 'unknown'}`)
  }

  const buckets = (Object.values(raw) as BucketRaw[]).sort((a, b) => a.key.localeCompare(b.key))
  const bands = toPercents(buckets)

  // Compute total tracked AUM for absolute dollar display
  const totalNow = buckets.reduce((s, b) => s + b.valueNowUsd, 0)

  const payload: MacroOracleRadarPayload = {
    asOf: isoNow(),
    mode: 'g',
    bands,
    meta: {
      source: 'gmode',
      totalTrackedUsd: totalNow,
      denom: 'sum(buckets_now_usd)',
      bucketsNowUsd: Object.fromEntries(buckets.map((b) => [b.key, b.valueNowUsd])),
      buckets7dAgoUsd: Object.fromEntries(buckets.map((b) => [b.key, b.value7dAgoUsd])),
      bucketsYtdAgoUsd: Object.fromEntries(buckets.map((b) => [b.key, b.valueYtdAgoUsd])),
      bucketSources: Object.fromEntries(buckets.map((b) => [b.key, b.sources])),
      warnings
    }
  }

  cache = { fetchedAt: nowMs, data: payload, raw: raw as Record<BucketKey, BucketRaw> }
  return payload
}
