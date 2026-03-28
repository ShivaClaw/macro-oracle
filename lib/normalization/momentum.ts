import type { AxisDailyOutput, TailVector } from './types';
import { clamp } from './stats';

export interface TailOptions {
  deltaDays?: number;
  mCap?: number;
}

export function computeAxisTailVectors(params: {
  axisId: string;
  angleRad: number;
  axisSeries: AxisDailyOutput[];
  options?: TailOptions;
}): TailVector[] {
  const { axisId, angleRad, axisSeries } = params;
  const deltaDays = params.options?.deltaDays ?? 7;
  const mCap = params.options?.mCap ?? 30;

  const out: TailVector[] = [];

  for (let i = 0; i < axisSeries.length; i++) {
    const cur = axisSeries[i]!;
    const prev = i - deltaDays >= 0 ? axisSeries[i - deltaDays]! : null;

    let delta: number | null = null;
    if (prev && cur.score_ema !== null && prev.score_ema !== null) {
      delta = cur.score_ema - prev.score_ema;
    }

    const deltaClipped = delta === null ? null : clamp(delta, -mCap, mCap);
    const vector =
      deltaClipped === null
        ? null
        : {
            x: deltaClipped * Math.cos(angleRad),
            y: deltaClipped * Math.sin(angleRad)
          };

    out.push({
      date: cur.date,
      axis: axisId,
      delta_7d: delta,
      delta_7d_clipped: deltaClipped,
      vector
    });
  }

  return out;
}

/**
 * Convenience wrapper for computing tails for multiple axes.
 * Returns a map keyed by axis id.
 */
export function computeMomentumVectors(params: {
  axes: Array<{ axisId: string; angleRad: number; axisSeries: AxisDailyOutput[] }>;
  options?: TailOptions;
}): Record<string, TailVector[]> {
  const out: Record<string, TailVector[]> = {};
  for (const a of params.axes) {
    out[a.axisId] = computeAxisTailVectors({
      axisId: a.axisId,
      angleRad: a.angleRad,
      axisSeries: a.axisSeries,
      options: params.options
    });
  }
  return out;
}

export function computeMomentumSeries(params: {
  dates: string[];
  values: Array<number | null>;
  deltaDays?: number;
}): Array<{ date: string; delta: number | null }> {
  const deltaDays = params.deltaDays ?? 7;
  const out: Array<{ date: string; delta: number | null }> = [];
  for (let i = 0; i < params.values.length; i++) {
    const cur = params.values[i]!;
    const prev = i - deltaDays >= 0 ? params.values[i - deltaDays]! : null;
    const delta = cur !== null && prev !== null ? cur - prev : null;
    out.push({ date: params.dates[i]!, delta });
  }
  return out;
}
