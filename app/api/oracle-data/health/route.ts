import { NextResponse } from 'next/server'
import { cacheStats } from '@/lib/cache'
import { providerStatusSummary } from '@/lib/providers/status'

export const runtime = 'nodejs'

export async function GET() {
  const providerStatus = await providerStatusSummary()

  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    cache: cacheStats(),
    providerStatus
  })
}
