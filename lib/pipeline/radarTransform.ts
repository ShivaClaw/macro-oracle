/**
 * radarTransform.ts
 *
 * Pure transformer: OracleSnapshot → MacroOracleRadarPayload
 *
 * Maps the backend OracleSnapshot (band scores, constituent details) into the
 * exact shape the MacroOracleRadar component consumes.
 *
 * Responsibilities:
 *  - RISK_0..RISK_8 → R0..R8 key mapping
 *  - band.score (0–100) → valueNow
 *  - optional 7d-ago axis values → value7dAgo + delta7d
 *  - optional history series → history[] points
 *  - provenance / meta passthrough
 */

import type { RiskBandId } from '@/lib/config/types'
import type { OracleSnapshot } from './oracleSnapshot'
import type { MacroOracleRadarPayload, RiskBandPoint } from '@/components/charts/MacroOracleRadar/types'

// ── RISK_N → RN key mapping ────────────────────────────────────────────────

const BAND_KEY_MAP: Record<RiskBandId, string> = {
  RISK_0: 'R0',
  RISK_1: 'R1',
  RISK_2: 'R2',
  RISK_3: 'R3',
  RISK_4: 'R4',
  RISK_5: 'R5',
  RISK_6: 'R6',
  RISK_7: 'R7',
  RISK_8: 'R8'
}

/** Short descriptive names per band (shown under the radar axis label). */
const BAND_SHORT_NAMES: Record<RiskBandId, string> = {
  RISK_0: 'Cash / T-Bills',
  RISK_1: 'Duration / Rates',
  RISK_2: 'IG Credit',
  RISK_3: 'Defensive Eq.',
  RISK_4: 'Cyclical Eq.',
  RISK_5: 'Inflation / Cmd',
  RISK_6: 'EM / FX',
  RISK_7: 'Crypto Majors',
  RISK_8: 'Crypto Alts'
}

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Per-band axis value at a specific point in time, sourced from persistence.
 * Key is the RiskBandId (RISK_0 … RISK_8).
 */
export type AxisHistoryPoint = {
  ts: string // ISO date/timestamp of the score
  scores: Partial<Record<RiskBandId, number>> // score 0–100, null when unavailable
}

// ── Main transformer ───────────────────────────────────────────────────────

/**
 * Transform an OracleSnapshot into the MacroOracleRadarPayload the chart
 * component expects.
 *
 * @param snapshot     - Latest oracle snapshot from the pipeline
 * @param sevenDayAgo  - Optional map of bandId → score from ~7 days ago (for tails)
 * @param history      - Optional array of (ts, {bandId: score}) rows for full history
 */
export function snapshotToRadarPayload(
  snapshot: OracleSnapshot,
  sevenDayAgo?: Partial<Record<RiskBandId, number | null>>,
  history?: AxisHistoryPoint[]
): MacroOracleRadarPayload {
  const bands: RiskBandPoint[] = snapshot.bands.map((band) => {
    const key = BAND_KEY_MAP[band.id] ?? band.id
    const bandId = band.id as RiskBandId

    const valueNow = band.score ?? 0 // 0 sentinel when score is null (degraded)
    const prev7d = sevenDayAgo?.[bandId]
    const value7dAgo = prev7d != null ? prev7d : undefined
    const delta7d =
      value7dAgo != null ? Number((valueNow - value7dAgo).toFixed(2)) : undefined

    const point: RiskBandPoint = {
      key,
      label: `RISK ${key.slice(1)}`, // RISK 0, RISK 1, …
      name: BAND_SHORT_NAMES[bandId],
      valueNow,
      ...(value7dAgo != null && { value7dAgo }),
      ...(delta7d != null && { delta7d })
    }

    return point
  })

  // Build history payload if axis history rows are provided
  const historyPayload: MacroOracleRadarPayload['history'] =
    history && history.length > 0
      ? {
          cadence: '1d',
          windowDays: Math.ceil(
            (new Date(history[history.length - 1]!.ts).getTime() -
              new Date(history[0]!.ts).getTime()) /
              86_400_000
          ),
          points: history.map((h) => ({
            t: h.ts,
            values: Object.fromEntries(
              Object.entries(h.scores)
                .filter(([, v]) => v != null)
                .map(([bandId, v]) => [BAND_KEY_MAP[bandId as RiskBandId] ?? bandId, v!])
            )
          }))
        }
      : undefined

  return {
    asOf: snapshot.generatedAt,
    bands,
    ...(historyPayload && { history: historyPayload }),
    meta: {
      source: 'macro-oracle',
      pipelineVersion: snapshot.pipelineVersion,
      schemaVersion: snapshot.schemaVersion,
      cacheHit: snapshot.cache.hit,
      cacheAgeSeconds: snapshot.cache.ageSeconds,
      providerStatus: Object.fromEntries(
        Object.entries(snapshot.providerStatus).map(([k, v]) => [k, { ok: v.ok }])
      )
    }
  }
}

/**
 * Given a list of axis history points (ordered ascending by ts) and a target
 * date, find the closest point at or before the target date.
 * Returns null if none found.
 */
export function findAxisPointAtOrBefore(
  history: AxisHistoryPoint[],
  targetIso: string
): AxisHistoryPoint | null {
  const target = new Date(targetIso).getTime()
  let best: AxisHistoryPoint | null = null
  for (const h of history) {
    if (new Date(h.ts).getTime() <= target) best = h
    else break
  }
  return best
}

/**
 * Given today's date (ISO), return an ISO date/timestamp representing ~7
 * calendar days ago (at midnight UTC).
 */
export function sevenDayAgoTs(asOf: string): string {
  const d = new Date(asOf)
  d.setUTCDate(d.getUTCDate() - 7)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}
