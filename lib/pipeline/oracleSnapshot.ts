import fs from 'node:fs/promises'
import path from 'node:path'
import { cacheGet, cacheSet, cacheStats } from '@/lib/cache'
import { RISK_BANDS } from '@/lib/config/riskBands'
import type { ConstituentDef, RiskBandId } from '@/lib/config/types'
import { aggregateBand, computeDerived, normalizeDerived } from '@/lib/normalization'
import { fetchAlphaVantageDailyAdjusted } from '@/lib/providers/alphavantage'
import { fetchCoinGeckoMarketChart } from '@/lib/providers/coingecko'
import { fetchFredSeries } from '@/lib/providers/fred'
import { fetchFmpHistorical } from '@/lib/providers/fmp'
import type {
  CanonicalSeries,
  FetchResult,
  ProviderName,
  ProviderStatus
} from '@/lib/providers/types'
import { providerStatusSummary } from '@/lib/providers/status'
import { createLimiter } from '@/lib/utils/concurrency'
import { stableJson } from '@/lib/utils/hash'
import { nowIso, secondsBetween, toIsoDate, parseIsoDate } from '@/lib/utils/time'

type BandStatus = 'ok' | 'degraded' | 'stale' | 'error'

export type OracleConstituentOut = {
  id: string
  label: string
  unit: string
  weight: number
  polarity: 'risk_on' | 'risk_off'
  raw: { value: number | null; asOf: string | null }
  derived: { kind: string; value: number | null }
  normalized: { kind: string; lookbackDays: number; score: number | null }
  source: {
    provider: ProviderName
    endpoint: string
    fetchedAt: string
    cache: { ttlSeconds: number; stale: boolean }
  }
  error: { code: string; message: string } | null
  series?: CanonicalSeries
}

export type OracleBandOut = {
  id: RiskBandId
  label: string
  score: number | null
  reliability: number
  status: BandStatus
  asOf: string
  constituents: OracleConstituentOut[]
  errors: string[]
}

export type OracleSnapshot = {
  schemaVersion: 1
  pipelineVersion: string
  generatedAt: string
  cache: { hit: boolean; snapshotKey: string; ageSeconds: number }
  bands: OracleBandOut[]
  providerStatus: Record<ProviderName, ProviderStatus>
}

const SNAPSHOT_TTL_SECONDS = 300
const SNAPSHOT_STALE_MAX_AGE_SECONDS = 60 * 60 // 1h

function snapshotCacheKey(opts: { includeSeries: boolean }): string {
  return `oracle:snapshot:latest:v1:${stableJson(opts)}`
}

async function writeSnapshotFiles(snapshot: OracleSnapshot): Promise<void> {
  const dir = path.join(process.cwd(), '.cache', 'oracle')
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'snapshot-latest.json'), JSON.stringify(snapshot, null, 2), 'utf8')

    const asOf = snapshot.bands[0]?.asOf
    if (asOf) {
      await fs.writeFile(path.join(dir, `snapshot-${asOf}.json`), JSON.stringify(snapshot, null, 2), 'utf8')
    }
  } catch {
    // best-effort only
  }
}

function pipelineVersion(): string {
  return (
    process.env.ORACLE_PIPELINE_VERSION ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    'dev'
  )
}

const limiters: Record<ProviderName, ReturnType<typeof createLimiter>> = {
  fred: createLimiter(6),
  fmp: createLimiter(4),
  alphavantage: createLimiter(2),
  coingecko: createLimiter(4)
}

async function fetchSeries(def: ConstituentDef): Promise<FetchResult<CanonicalSeries>> {
  const p = def.provider
  const limit = limiters[p]

  return await limit(async () => {
    if (p === 'fred') {
      return await fetchFredSeries({
        seriesId: String(def.params.seriesId),
        label: def.label,
        unit: def.unit,
        frequency: def.frequency,
        limit: Number(def.params.limit ?? 200),
        ttlSeconds: def.ttlSeconds,
        staleMaxAgeSeconds: def.staleMaxAgeSeconds
      })
    }

    if (p === 'fmp') {
      return await fetchFmpHistorical({
        symbol: String(def.params.symbol),
        label: def.label,
        unit: def.unit,
        frequency: def.frequency,
        timeseries: Number(def.params.timeseries ?? 200),
        ttlSeconds: def.ttlSeconds,
        staleMaxAgeSeconds: def.staleMaxAgeSeconds
      })
    }

    if (p === 'coingecko') {
      return await fetchCoinGeckoMarketChart({
        coinId: String(def.params.coinId),
        label: def.label,
        unit: def.unit,
        days: Number(def.params.days ?? 365),
        ttlSeconds: def.ttlSeconds,
        staleMaxAgeSeconds: def.staleMaxAgeSeconds
      })
    }

    // alphavantage
    return await fetchAlphaVantageDailyAdjusted({
      symbol: String(def.params.symbol),
      label: def.label,
      unit: def.unit,
      outputsize: (def.params.outputsize as any) ?? 'compact',
      ttlSeconds: def.ttlSeconds,
      staleMaxAgeSeconds: def.staleMaxAgeSeconds
    })
  })
}

async function fetchWithFallback(def: ConstituentDef): Promise<FetchResult<CanonicalSeries>> {
  const primary = await fetchSeries(def)
  if (primary.ok) return primary

  if (!def.fallback) return primary

  const fallbackDef: ConstituentDef = {
    ...def,
    provider: def.fallback.provider,
    endpointTemplate: def.fallback.endpointTemplate,
    params: def.fallback.params
  }

  const secondary = await fetchSeries(fallbackDef)
  return secondary.ok ? secondary : primary
}

export async function computeSnapshot(opts: { includeSeries: boolean; bands?: RiskBandId[] }): Promise<Omit<OracleSnapshot, 'cache'>> {
  const selectedBands = opts.bands?.length
    ? RISK_BANDS.filter((b) => opts.bands!.includes(b.id))
    : RISK_BANDS

  const bandOutputs: OracleBandOut[] = []

  // Fetch all series in parallel (provider-limited)
  const seriesById = new Map<string, FetchResult<CanonicalSeries>>()
  const tasks: Array<Promise<void>> = []

  for (const band of selectedBands) {
    for (const c of band.constituents) {
      if (seriesById.has(c.id)) continue
      tasks.push(
        (async () => {
          const res = await fetchWithFallback(c)
          seriesById.set(c.id, res)
        })()
      )
    }
  }

  await Promise.all(tasks)

  for (const band of selectedBands) {
    const constituentsOut: OracleConstituentOut[] = []

    for (const def of band.constituents) {
      const fetched = seriesById.get(def.id)

      if (!fetched) {
        constituentsOut.push({
          id: def.id,
          label: def.label,
          unit: def.unit,
          weight: def.weight,
          polarity: def.polarity,
          raw: { value: null, asOf: null },
          derived: { kind: def.transform.kind, value: null },
          normalized: { kind: def.normalize.kind, lookbackDays: def.normalize.lookbackDays, score: null },
          source: { provider: def.provider, endpoint: def.endpointTemplate, fetchedAt: nowIso(), cache: { ttlSeconds: def.ttlSeconds, stale: true } },
          error: { code: 'MISSING', message: 'No fetch result' }
        })
        continue
      }

      if (!fetched.ok) {
        constituentsOut.push({
          id: def.id,
          label: def.label,
          unit: def.unit,
          weight: def.weight,
          polarity: def.polarity,
          raw: { value: null, asOf: null },
          derived: { kind: def.transform.kind, value: null },
          normalized: { kind: def.normalize.kind, lookbackDays: def.normalize.lookbackDays, score: null },
          source: {
            provider: fetched.meta.provider,
            endpoint: fetched.meta.endpoint,
            fetchedAt: fetched.meta.fetchedAt,
            cache: { ttlSeconds: fetched.meta.ttlSeconds, stale: fetched.meta.stale }
          },
          error: { code: fetched.error.code, message: fetched.error.message }
        })
        continue
      }

      const series = fetched.data
      const latest = series.points.at(-1) ?? null
      const derived = computeDerived(series, def)
      const normalized = derived ? normalizeDerived({ derived, series, def }) : null

      constituentsOut.push({
        id: def.id,
        label: def.label,
        unit: def.unit,
        weight: def.weight,
        polarity: def.polarity,
        raw: { value: latest?.v ?? null, asOf: latest?.t ?? null },
        derived: { kind: def.transform.kind, value: derived?.value ?? null },
        normalized: {
          kind: def.normalize.kind,
          lookbackDays: def.normalize.lookbackDays,
          score: normalized?.score ?? null
        },
        source: {
          provider: fetched.meta.provider,
          endpoint: fetched.meta.endpoint,
          fetchedAt: fetched.meta.fetchedAt,
          cache: { ttlSeconds: fetched.meta.ttlSeconds, stale: fetched.meta.stale }
        },
        error: null,
        ...(opts.includeSeries ? { series } : {})
      })
    }

    const agg = aggregateBand({
      band,
      constituents: constituentsOut.map((c, i) => ({
        def: band.constituents[i]!,
        normalizedScore: c.normalized.score,
        stale: c.source.cache.stale,
        error: c.error?.message ?? null
      }))
    })

    const asOf =
      constituentsOut
        .map((c) => c.raw.asOf)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? toIsoDate(new Date())

    bandOutputs.push({
      id: band.id,
      label: band.label,
      score: agg.score,
      reliability: agg.reliability,
      status: agg.status,
      asOf,
      constituents: constituentsOut,
      errors: agg.errors
    })
  }

  const providerStatus = await providerStatusSummary()

  return {
    schemaVersion: 1,
    pipelineVersion: pipelineVersion(),
    generatedAt: nowIso(),
    bands: bandOutputs,
    providerStatus
  }
}

export async function getOracleSnapshot(opts: {
  includeSeries: boolean
  bands?: RiskBandId[]
  asOf?: string
}): Promise<OracleSnapshot> {
  // If asOf is requested, try a persisted snapshot file only.
  if (opts.asOf) {
    const d = parseIsoDate(opts.asOf)
    if (d) {
      const fp = path.join(process.cwd(), '.cache', 'oracle', `snapshot-${opts.asOf}.json`)
      try {
        const raw = await fs.readFile(fp, 'utf8')
        const parsed = JSON.parse(raw) as OracleSnapshot
        return {
          ...parsed,
          cache: {
            hit: true,
            snapshotKey: `file:${fp}`,
            ageSeconds: secondsBetween(new Date(parsed.generatedAt).getTime(), Date.now())
          },
          bands: opts.bands?.length ? parsed.bands.filter((b) => opts.bands!.includes(b.id)) : parsed.bands
        }
      } catch {
        // fall through to normal path
      }
    }
  }

  const key = snapshotCacheKey({ includeSeries: opts.includeSeries })
  const cached = await cacheGet<Omit<OracleSnapshot, 'cache'>>(key, { allowStale: true })
  if (cached.hit && cached.entry) {
    const ageSeconds = secondsBetween(cached.entry.storedAtMs, Date.now())
    const payload = cached.entry.value

    if (ageSeconds <= SNAPSHOT_STALE_MAX_AGE_SECONDS) {
      return {
        ...payload,
        cache: { hit: true, snapshotKey: key, ageSeconds },
        bands: opts.bands?.length ? payload.bands.filter((b) => opts.bands!.includes(b.id)) : payload.bands
      }
    }
    // too old: fall through to rebuild
  }

  const built = await computeSnapshot({ includeSeries: opts.includeSeries, bands: opts.bands })
  await cacheSet(key, built, SNAPSHOT_TTL_SECONDS)

  const full: OracleSnapshot = {
    ...built,
    cache: { hit: false, snapshotKey: key, ageSeconds: 0 }
  }

  await writeSnapshotFiles(full)

  return full
}

export async function forceRefreshSnapshot(opts: { includeSeries: boolean }): Promise<OracleSnapshot> {
  const built = await computeSnapshot({ includeSeries: opts.includeSeries })
  const key = snapshotCacheKey({ includeSeries: opts.includeSeries })
  await cacheSet(key, built, SNAPSHOT_TTL_SECONDS)

  const full: OracleSnapshot = {
    ...built,
    cache: { hit: false, snapshotKey: key, ageSeconds: 0 }
  }

  await writeSnapshotFiles(full)
  return full
}

export function oracleHealth() {
  return {
    ok: true,
    cache: cacheStats()
  }
}
