import { Cadence } from './types.js'

export function startOfHour(d: Date): Date {
  const out = new Date(d)
  out.setUTCMinutes(0, 0, 0)
  return out
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000)
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 3_600_000)
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000)
}

export function cadenceToMs(cadence: Cadence): number {
  switch (cadence) {
    case 'hourly':
      return 3_600_000
    case '2h':
      return 2 * 3_600_000
    case '4h':
      return 4 * 3_600_000
    case 'daily':
      return 24 * 3_600_000
    case 'weekly':
      return 7 * 24 * 3_600_000
    case 'on_demand':
      return Number.POSITIVE_INFINITY
    default:
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unsupported cadence: ${cadence}`)
  }
}

export function isDue(lastSuccessAt: string | null | undefined, now: Date, cadence: Cadence): boolean {
  if (cadence === 'on_demand') return false
  if (!lastSuccessAt) return true
  const last = new Date(lastSuccessAt)
  return now.getTime() - last.getTime() >= cadenceToMs(cadence)
}
