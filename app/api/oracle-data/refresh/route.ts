import { NextRequest, NextResponse } from 'next/server'
import { forceRefreshSnapshot } from '@/lib/pipeline/oracleSnapshot'

export const runtime = 'nodejs'

function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ ok: false, error: message }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const token = process.env.ORACLE_REFRESH_TOKEN
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error: 'ORACLE_REFRESH_TOKEN is not configured on the server.'
      },
      { status: 503 }
    )
  }

  const auth = req.headers.get('authorization') || ''
  const expected = `Bearer ${token}`

  if (auth !== expected) return unauthorized('Invalid bearer token')

  // Stub refresh logic: compute snapshot now and update cache.
  const snapshot = await forceRefreshSnapshot({ includeSeries: false })

  return NextResponse.json({ ok: true, generatedAt: snapshot.generatedAt, snapshotKey: snapshot.cache.snapshotKey })
}
