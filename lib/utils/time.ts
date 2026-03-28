export function nowIso(): string {
  return new Date().toISOString()
}

export function toIsoDate(d: Date): string {
  // YYYY-MM-DD in UTC
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function parseIsoDate(s: string): Date | null {
  // Expect YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function secondsBetween(aMs: number, bMs: number): number {
  return Math.max(0, Math.floor((bMs - aMs) / 1000))
}
