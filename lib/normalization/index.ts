import type { ConstituentDef, RiskBandDef } from '@/lib/config/types'
import type { CanonicalPoint, CanonicalSeries } from '@/lib/providers/types'

export type DerivedValue = {
  kind: ConstituentDef['transform']['kind']
  value: number
}

export type NormalizedValue = {
  kind: ConstituentDef['normalize']['kind']
  lookbackDays: number
  score: number
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x))
}

function pctChange(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return NaN
  return ((a - b) / Math.abs(b)) * 100
}

function findPointAtOrBefore(points: CanonicalPoint[], isoDate: string): CanonicalPoint | null {
  // points are assumed ascending by t
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i]!.t <= isoDate) return points[i]!
  }
  return null
}

function isoDateMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - days)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function computeDerived(series: CanonicalSeries, def: ConstituentDef): DerivedValue | null {
  const points = series.points
  if (!points.length) return null
  const latest = points[points.length - 1]!

  if (def.transform.kind === 'level') {
    return { kind: 'level', value: latest.v }
  }

  if (def.transform.kind === 'pct_change') {
    const window = def.transform.windowDays ?? 30
    const priorDate = isoDateMinusDays(latest.t, window)
    const prior = findPointAtOrBefore(points, priorDate)
    if (!prior) return null
    return { kind: 'pct_change', value: pctChange(latest.v, prior.v) }
  }

  if (def.transform.kind === 'yoy') {
    const priorDate = isoDateMinusDays(latest.t, 365)
    const prior = findPointAtOrBefore(points, priorDate)
    if (!prior) return null
    return { kind: 'yoy', value: pctChange(latest.v, prior.v) }
  }

  // spread requires multi-series; not implemented in this MVP.
  return null
}

function valuesForNormalization(series: CanonicalSeries, def: ConstituentDef): number[] {
  const pts = series.points
  if (!pts.length) return []

  if (def.transform.kind === 'level') {
    return pts.map((p) => p.v)
  }

  if (def.transform.kind === 'pct_change') {
    const window = def.transform.windowDays ?? 30
    const out: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]!
      const prior = findPointAtOrBefore(pts.slice(0, i + 1), isoDateMinusDays(cur.t, window))
      if (!prior) continue
      const v = pctChange(cur.v, prior.v)
      if (Number.isFinite(v)) out.push(v)
    }
    return out
  }

  if (def.transform.kind === 'yoy') {
    const out: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]!
      const prior = findPointAtOrBefore(pts.slice(0, i + 1), isoDateMinusDays(cur.t, 365))
      if (!prior) continue
      const v = pctChange(cur.v, prior.v)
      if (Number.isFinite(v)) out.push(v)
    }
    return out
  }

  return []
}

export function normalizeDerived(opts: {
  derived: DerivedValue
  series: CanonicalSeries
  def: ConstituentDef
}): NormalizedValue | null {
  const { derived, series, def } = opts
  const xs = valuesForNormalization(series, def)
  if (!xs.length) return null

  const lookbackN = Math.min(xs.length, Math.max(10, Math.floor(def.normalize.lookbackDays)))
  const window = xs.slice(-lookbackN)

  let score = 50

  if (def.normalize.kind === 'zscore') {
    const mean = window.reduce((a, b) => a + b, 0) / window.length
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length
    const std = Math.sqrt(variance)
    const z = std === 0 ? 0 : (derived.value - mean) / std
    score = 50 + 15 * z
  } else {
    const min = Math.min(...window)
    const max = Math.max(...window)
    score = max === min ? 50 : (100 * (derived.value - min)) / (max - min)
  }

  score = clamp(score, 0, 100)

  if (def.polarity === 'risk_off') score = 100 - score

  if (def.normalize.clamp) score = clamp(score, def.normalize.clamp.min, def.normalize.clamp.max)

  return {
    kind: def.normalize.kind,
    lookbackDays: def.normalize.lookbackDays,
    score: Number(score.toFixed(2))
  }
}

export function aggregateBand(opts: {
  band: RiskBandDef
  constituents: Array<{ def: ConstituentDef; normalizedScore: number | null; stale: boolean; error?: string | null }>
}): { score: number | null; reliability: number; status: 'ok' | 'degraded' | 'stale' | 'error'; errors: string[] } {
  const { band, constituents } = opts
  const totalWeight = band.constituents.reduce((a, c) => a + c.weight, 0) || 1

  let coveredWeight = 0
  let weightedSum = 0
  let staleWeight = 0
  const errors: string[] = []

  for (const c of constituents) {
    if (c.normalizedScore === null || !Number.isFinite(c.normalizedScore)) {
      errors.push(`${c.def.id}: ${c.error ?? 'missing'}`)
      continue
    }
    coveredWeight += c.def.weight
    weightedSum += c.def.weight * c.normalizedScore
    if (c.stale) staleWeight += c.def.weight
  }

  const coverageRatio = coveredWeight / totalWeight
  const reliability = Number((coverageRatio * (1 - staleWeight / (coveredWeight || 1))).toFixed(2))

  if (coverageRatio < band.minCoverageWeight) {
    return { score: null, reliability, status: 'error', errors }
  }

  const score = weightedSum / (coveredWeight || 1)
  let status: 'ok' | 'degraded' | 'stale' | 'error' = 'ok'
  if (staleWeight > 0) status = 'degraded'

  return { score: Number(score.toFixed(2)), reliability, status, errors }
}

// -------------------------------------------------------------------------------------
// NORMALIZATION_LOGIC_SPEC.md implementation (v2)
//
// These exports implement the full daily-grid normalization pipeline described in the spec:
// alignment → transforms → robust rolling z-score → percentile map → polarity → EMA,
// plus axis aggregation + tail vectors.
//
// Kept side-by-side with the earlier MVP exports above to avoid breaking existing pipeline code.
// -------------------------------------------------------------------------------------
export * from './types';
export * from './dates';
export * from './alignment';
export * from './transforms';
export * from './stats';
export * from './percentile';
export * from './ema';
export * from './normalize';
export * from './aggregate';
export * from './momentum';
