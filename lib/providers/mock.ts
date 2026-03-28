import { mulberry32, seedFromString } from '@/lib/utils/prng'
import { toIsoDate } from '@/lib/utils/time'
import type { CanonicalSeries, ProviderName } from './types'

export function mockSeries(opts: {
  provider: ProviderName
  id: string
  label: string
  unit: string
  frequency: CanonicalSeries['frequency']
  days: number
  base: number
  volatility: number
  trendPerDay: number
}): CanonicalSeries {
  const seed = seedFromString(`${opts.provider}:${opts.id}:${opts.label}`)
  const rand = mulberry32(seed)

  const points: { t: string; v: number }[] = []
  const now = new Date()

  let v = opts.base
  for (let i = opts.days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    const noise = (rand() - 0.5) * 2 * opts.volatility
    v = Math.max(0.0001, v + opts.trendPerDay + noise)
    points.push({ t: toIsoDate(d), v: Number(v.toFixed(4)) })
  }

  return {
    id: opts.id,
    label: opts.label,
    unit: opts.unit,
    frequency: opts.frequency,
    points,
    source: {
      provider: opts.provider,
      endpoint: `mock:${opts.provider}:${opts.id}`,
      fetchedAt: new Date().toISOString()
    }
  }
}
