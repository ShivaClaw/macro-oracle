import type { Transform } from './types';
import type { DailyAlignedPoint } from './alignment';

export interface TransformedPoint {
  day: number;
  date: string;
  asof_day: number | null;
  y: number | null;
  x: number | null;
  flags: {
    missing: boolean;
    reason?: string;
  };
}

export function transformDailySeries(params: {
  aligned: DailyAlignedPoint[];
  transform: Transform;
  eps: number;
}): TransformedPoint[] {
  const { aligned, transform, eps } = params;

  const yByDay = new Map<number, number>();
  for (const p of aligned) {
    if (p.value_daily !== null) yByDay.set(p.day, p.value_daily);
  }

  const out: TransformedPoint[] = [];

  for (const p of aligned) {
    const y = p.value_daily;
    const day = p.day;

    if (y === null) {
      out.push({
        day,
        date: p.date,
        asof_day: p.asof_day,
        y,
        x: null,
        flags: { missing: true, reason: p.flags.reason }
      });
      continue;
    }

    const yPrev = yByDay.get(day - 1) ?? null;
    const yLag365 = yByDay.get(day - 365) ?? null;

    let x: number | null = null;
    let missing = false;
    let reason: string | undefined;

    switch (transform) {
      case 'level':
        x = y;
        break;
      case 'log':
        if (y <= 0) {
          missing = true;
          reason = 'invalid_nonpositive_for_log';
        } else x = Math.log(y);
        break;
      case 'diff':
        if (yPrev === null) {
          missing = true;
          reason = 'insufficient_lag';
        } else x = y - yPrev;
        break;
      case 'pct_change':
        if (yPrev === null) {
          missing = true;
          reason = 'insufficient_lag';
        } else {
          x = (y - yPrev) / (Math.abs(yPrev) + eps);
        }
        break;
      case 'log_diff':
        if (yPrev === null) {
          missing = true;
          reason = 'insufficient_lag';
        } else if (y <= 0 || yPrev <= 0) {
          missing = true;
          reason = 'invalid_nonpositive_for_log';
        } else x = Math.log(y) - Math.log(yPrev);
        break;
      case 'yoy':
        if (yLag365 === null) {
          missing = true;
          reason = 'insufficient_lag';
        } else {
          x = (y - yLag365) / (Math.abs(yLag365) + eps);
        }
        break;
      default: {
        const _exhaustive: never = transform;
        throw new Error(`Unhandled transform: ${_exhaustive}`);
      }
    }

    out.push({
      day,
      date: p.date,
      asof_day: p.asof_day,
      y,
      x: missing ? null : x,
      flags: { missing, reason }
    });
  }

  return out;
}
