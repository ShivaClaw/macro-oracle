/**
 * GET /api/oracle-data/radar
 *
 * Returns a MacroOracleRadarPayload ready for the frontend chart component.
 *
 * Differences from GET /api/oracle-data (raw OracleSnapshot):
 *  - RISK_N → RN key mapping
 *  - band.score → valueNow (0–100)
 *  - 7-day-ago axis scores from the cron persistence layer → value7dAgo + delta7d
 *  - Optional 30-day history series for sparklines / trend context
 *
 * Query params:
 *  - ?history=true|1        Include N-day daily history points (default off)
 *  - ?historyDays=N         Override history lookback in days (default 30, max 90)
 *  - ?asOf=YYYY-MM-DD       Serve from a persisted snapshot file (debug/backtesting)
 *  - ?bands=RISK_0,RISK_1   Filter to specific bands
 */

import { NextRequest, NextResponse } from 'next/server'
import { getOracleSnapshot } from '@/lib/pipeline/oracleSnapshot'
import { snapshotToRadarPayload } from '@/lib/pipeline/radarTransform'
import { getSevenDayAgoScores, getAxisHistory } from '@/lib/oracle/axisStore'
import type { RiskBandId } from '@/lib/config/types'
import { RISK_BANDS } from '@/lib/config/riskBands'

export const runtime = 'nodejs'

const DEFAULT_HISTORY_DAYS = 30
const MAX_HISTORY_DAYS = 90

function parseBool(v: string | null): boolean {
  if (!v) return false
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

function parseBands(v: string | null): RiskBandId[] | undefined {
  if (!v) return undefined
  const allowed = new Set<RiskBandId>(RISK_BANDS.map((b) => b.id))
  const parts = v
    .split(',')
    .map((s) => s.trim())
    .filter((p): p is RiskBandId => allowed.has(p as RiskBandId))
  return parts.length ? parts : undefined
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)))
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const includeHistory = parseBool(url.searchParams.get('history'))
  const historyDays = clampInt(
    Number(url.searchParams.get('historyDays') ?? DEFAULT_HISTORY_DAYS),
    1,
    MAX_HISTORY_DAYS
  )
  const bands = parseBands(url.searchParams.get('bands'))
  const asOf = url.searchParams.get('asOf') ?? undefined

  // ── 1. Fetch current snapshot ────────────────────────────────────────────
  const snapshot = await getOracleSnapshot({ includeSeries: false, bands, asOf })
  const allBandIds = snapshot.bands.map((b) => b.id as RiskBandId)

  // ── 2. 7d-ago scores (for comet tails) ──────────────────────────────────
  let sevenDayAgo: Partial<Record<RiskBandId, number | null>> | undefined
  try {
    sevenDayAgo = await getSevenDayAgoScores({ bandIds: allBandIds, asOf: snapshot.generatedAt })
  } catch {
    // Cron data not yet available; tails will be omitted
  }

  // ── 3. Optional history ───────────────────────────────────────────────────
  let historyPoints: Array<{ ts: string; scores: Partial<Record<RiskBandId, number>> }> | undefined
  if (includeHistory) {
    try {
      historyPoints = await getAxisHistory({
        bandIds: allBandIds,
        historyDays,
        asOf: snapshot.generatedAt
      })
    } catch {
      // Best-effort; omit history on error
    }
  }

  // ── 4. Transform → radar payload ──────────────────────────────────────────
  const radarPayload = snapshotToRadarPayload(snapshot, sevenDayAgo, historyPoints)

  const res = NextResponse.json(radarPayload)
  res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  return res
}
