import type { ProviderName } from '@/lib/providers/types'
import { RISK_BANDS } from '@/lib/config/riskBands'
import type { Cadence, Priority } from '../lib/types.js'

export type SourceConfig = {
  key: ProviderName
  cadence: Cadence
  offsetMinutes: number
  priority: Priority
  enabledByDefault: boolean
}

// Baseline provider cadence plan.
export const SOURCES: SourceConfig[] = [
  { key: 'fred', cadence: 'hourly', offsetMinutes: 0, priority: 'critical', enabledByDefault: true },
  { key: 'fmp', cadence: 'hourly', offsetMinutes: 2, priority: 'critical', enabledByDefault: true },
  { key: 'coingecko', cadence: 'hourly', offsetMinutes: 4, priority: 'normal', enabledByDefault: true },
  // Alpha Vantage free tier is strict; keep it lower cadence by default.
  { key: 'alphavantage', cadence: '4h', offsetMinutes: 6, priority: 'best_effort', enabledByDefault: true }
]

export function bandsImpactedByProvider(provider: ProviderName): string[] {
  const out = new Set<string>()
  for (const band of RISK_BANDS) {
    if (band.constituents.some((c) => c.provider === provider)) out.add(band.id)
  }
  return [...out]
}
