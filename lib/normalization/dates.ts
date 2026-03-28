import type { DateInput } from './types';

export const MS_PER_DAY = 86_400_000;

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isoToDayNumber(iso: string): number {
  if (!isIsoDate(iso)) throw new Error(`Expected YYYY-MM-DD, got: ${iso}`);
  const [y, m, d] = iso.split('-').map((x) => Number(x));
  const ms = Date.UTC(y!, (m! - 1)!, d!);
  return Math.floor(ms / MS_PER_DAY);
}

export function dayNumberToIso(day: number): string {
  const d = new Date(day * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function toDayNumber(input: DateInput): number {
  if (typeof input === 'string') {
    if (isIsoDate(input)) return isoToDayNumber(input);
    const ms = Date.parse(input);
    if (!Number.isFinite(ms)) throw new Error(`Unparseable date string: ${input}`);
    return msToUtcDayNumber(ms);
  }
  if (typeof input === 'number') return msToUtcDayNumber(input);
  return msToUtcDayNumber(input.getTime());
}

export function msToUtcDayNumber(ms: number): number {
  const d = new Date(ms);
  const utcMidnightMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor(utcMidnightMs / MS_PER_DAY);
}

export function addDaysDayNumber(day: number, deltaDays: number): number {
  return day + deltaDays;
}

export function addDaysIso(iso: string, deltaDays: number): string {
  return dayNumberToIso(isoToDayNumber(iso) + deltaDays);
}

export function diffDaysIso(a: string, b: string): number {
  // a - b
  return isoToDayNumber(a) - isoToDayNumber(b);
}

export function buildDailyGrid(startIso: string, endIso: string): string[] {
  const start = isoToDayNumber(startIso);
  const end = isoToDayNumber(endIso);
  if (end < start) throw new Error(`endIso < startIso (${endIso} < ${startIso})`);
  const out: string[] = [];
  for (let d = start; d <= end; d++) out.push(dayNumberToIso(d));
  return out;
}
