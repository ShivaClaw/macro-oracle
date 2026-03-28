import { describe, expect, test } from 'vitest';
import {
  aggregateRiskAxis,
  buildDailyGrid,
  computeAxisTailVectors,
  normalizeConstituentSeries
} from '../index.js';

function weeklyObs(startIso: string, weeks: number): Array<{ timestamp: string; value: number }> {
  const start = new Date(`${startIso}T00:00:00Z`).getTime();
  const msPerDay = 86_400_000;
  const out: Array<{ timestamp: string; value: number }> = [];
  for (let k = 0; k < weeks; k++) {
    const ms = start + k * 7 * msPerDay;
    const iso = new Date(ms).toISOString().slice(0, 10);
    out.push({ timestamp: iso, value: k });
  }
  return out;
}

describe('normalizeConstituentSeries', () => {
  test('extends lookback when non-daily unique-asof samples are insufficient', () => {
    const evaluationDates = buildDailyGrid('2026-01-01', '2026-07-20'); // ~200 days
    const observations = weeklyObs('2026-01-01', 30); // ~210 days weekly

    const out = normalizeConstituentSeries({
      config: {
        id: 'WEEKLY_X',
        frequency: 'weekly',
        transform: 'level',
        polarity: 1,
        weight: 1,
        interpolation: 'ffill',
        stale_days: 14,
        rolling_window_days: 90,
        max_lookback_days: 730,
        min_effective_obs: 20
      },
      observations,
      options: { evaluationDates }
    });

    const last = out[out.length - 1]!;
    expect(last.flags.insufficient_history).toBe(false);
    expect(last.lookback_days_used).toBe(180);
    expect(last.n_effective).toBeGreaterThanOrEqual(20);
    expect(last.score).not.toBeNull();
    expect(last.score!).toBeGreaterThanOrEqual(0);
    expect(last.score!).toBeLessThanOrEqual(100);
  });
});

describe('axis aggregation + tails', () => {
  test('coverage gating nulls axis score when too few constituents valid', () => {
    const dates = buildDailyGrid('2026-01-01', '2026-01-10');

    const s1 = dates.map((date) => ({
      date,
      id: 'A',
      value_raw_asof: 1,
      asof_date: date,
      value_daily: 1,
      x: 0,
      mu: 0,
      sigma: 1,
      z: 0,
      percentile: 0.5,
      score: 20,
      score_ema: 20,
      lookback_days_used: 90,
      n_effective: 60,
      winsor_lo: 0,
      winsor_hi: 0,
      flags: { stale: false, missing: false, insufficient_history: false, api_error: false }
    }));

    const s2 = dates.map((date, i) => ({
      date,
      id: 'B',
      value_raw_asof: 1,
      asof_date: date,
      value_daily: 1,
      x: 0,
      mu: 0,
      sigma: 1,
      z: 0,
      percentile: 0.5,
      score: i === 9 ? null : 80,
      score_ema: i === 9 ? null : 80,
      lookback_days_used: 90,
      n_effective: 60,
      winsor_lo: 0,
      winsor_hi: 0,
      flags: { stale: false, missing: i === 9, insufficient_history: false, api_error: false, reason: i === 9 ? 'stale' : undefined }
    }));

    const axis = aggregateRiskAxis({
      axis: { id: 'RISK_ON', angle_rad: 0, coverage_threshold: 0.8, ema_alpha: 1 },
      constituents: [
        { config: { id: 'A', weight: 1 }, series: s1 },
        { config: { id: 'B', weight: 3 }, series: s2 }
      ]
    });

    // On last day, only B missing => coverage = 1/4 = 0.25 < 0.8 => null
    expect(axis[axis.length - 1]!.score).toBeNull();
    expect(axis[axis.length - 1]!.flags.low_coverage).toBe(true);

    // On previous day both valid => weighted score (1*20 + 3*80)/4 = 65
    expect(axis[axis.length - 2]!.score).toBeCloseTo(65, 12);
  });

  test('tail vectors compute 7d delta from score_ema and clip magnitude', () => {
    const dates = buildDailyGrid('2026-01-01', '2026-01-20');
    const axisSeries = dates.map((date, i) => ({
      date,
      axis: 'RISK_ON',
      score: 50 + i,
      score_ema: 50 + i,
      coverage: 1,
      n_valid: 2,
      flags: { low_coverage: false }
    }));

    const tails = computeAxisTailVectors({ axisId: 'RISK_ON', angleRad: 0, axisSeries, options: { mCap: 5 } });

    const day7 = tails[7]!;
    expect(day7.delta_7d).toBeCloseTo(7, 12);
    expect(day7.delta_7d_clipped).toBe(5);
    expect(day7.vector!.x).toBe(5);
    expect(day7.vector!.y).toBe(0);
  });
});
