import { NextRequest, NextResponse } from 'next/server'
import { getOracleSnapshot } from '@/lib/pipeline/oracleSnapshot'
import type { RiskBandId } from '@/lib/config/types'

export const runtime = 'nodejs'

function parseBool(v: string | null): boolean {
  if (!v) return false
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

function parseBands(v: string | null): RiskBandId[] | undefined {
  if (!v) return undefined
  const parts = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const allowed = new Set<RiskBandId>([
    'RISK_0',
    'RISK_1',
    'RISK_2',
    'RISK_3',
    'RISK_4',
    'RISK_5',
    'RISK_6',
    'RISK_7',
    'RISK_8'
  ])

  const out = parts.filter((p): p is RiskBandId => allowed.has(p as RiskBandId))
  return out.length ? out : undefined
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const includeSeries = parseBool(url.searchParams.get('includeSeries'))
  const bands = parseBands(url.searchParams.get('bands'))
  const asOf = url.searchParams.get('asOf') ?? undefined

  const snapshot = await getOracleSnapshot({ includeSeries, bands, asOf })

  const res = NextResponse.json(snapshot)
  res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  return res
}
