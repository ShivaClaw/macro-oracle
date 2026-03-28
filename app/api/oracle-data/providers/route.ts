import { NextResponse } from 'next/server'
import { cacheStats } from '@/lib/cache'
import { providerStatusSummary } from '@/lib/providers/status'
import type { ProviderName, ProviderStatus } from '@/lib/providers/types'

export const runtime = 'nodejs'

function envHasKey(provider: ProviderName): boolean {
  if (provider === 'fred') return !!(process.env.FRED_API_KEY || process.env.FRED_API_KEY_NEXT)
  if (provider === 'fmp') return !!(process.env.FMP_API_KEY || process.env.FMP_API_KEY_NEXT)
  if (provider === 'alphavantage')
    return !!(process.env.ALPHAVANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY_NEXT)
  if (provider === 'coingecko')
    return !!(process.env.COINGECKO_API_KEY || process.env.COINGECKO_API_KEY_NEXT)
  return false
}

export async function GET() {
  const statuses = await providerStatusSummary()

  const providers: Record<ProviderName, ProviderStatus & { rateLimitHint: string }> = {
    fred: { ...statuses.fred, hasKey: envHasKey('fred'), rateLimitHint: 'generous; use TTL 1h-24h depending on series freq' },
    fmp: { ...statuses.fmp, hasKey: envHasKey('fmp'), rateLimitHint: 'moderate; TTL 5-15m for liquid ETFs' },
    alphavantage: {
      ...statuses.alphavantage,
      hasKey: envHasKey('alphavantage'),
      rateLimitHint: 'strict free-tier; keep concurrency low (1-2)'
    },
    coingecko: {
      ...statuses.coingecko,
      hasKey: envHasKey('coingecko'),
      rateLimitHint: 'public endpoints throttle; TTL 1-5m for prices, 15m+ for charts'
    }
  }

  return NextResponse.json({
    ok: true,
    providers,
    cache: cacheStats()
  })
}
