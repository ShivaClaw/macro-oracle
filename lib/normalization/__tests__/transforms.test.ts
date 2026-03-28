import { describe, expect, test } from 'vitest';
import { alignToDailyGrid, buildDailyGrid, transformDailySeries } from '../index.js';

describe('transforms', () => {
  test('log transform rejects non-positive values', () => {
    const evaluationDates = buildDailyGrid('2026-01-01', '2026-01-02');
    const aligned = alignToDailyGrid({
      observations: [
        { timestamp: '2026-01-01', value: 10 },
        { timestamp: '2026-01-02', value: 0 }
      ],
      evaluationDates,
      interpolation: 'ffill',
      staleDays: 100
    });

    const t = transformDailySeries({ aligned, transform: 'log', eps: 1e-12 });
    expect(t[0]!.x).toBeCloseTo(Math.log(10), 12);
    expect(t[1]!.x).toBeNull();
    expect(t[1]!.flags.reason).toBe('invalid_nonpositive_for_log');
  });

  test('pct_change uses eps in denominator', () => {
    const evaluationDates = buildDailyGrid('2026-01-01', '2026-01-02');
    const aligned = alignToDailyGrid({
      observations: [
        { timestamp: '2026-01-01', value: 0 },
        { timestamp: '2026-01-02', value: 1 }
      ],
      evaluationDates,
      interpolation: 'ffill',
      staleDays: 100
    });

    const t = transformDailySeries({ aligned, transform: 'pct_change', eps: 1 });
    // (1-0)/(abs(0)+1) = 1
    expect(t[1]!.x).toBeCloseTo(1, 12);
  });

  test('yoy requires 365d lag', () => {
    const evaluationDates = buildDailyGrid('2026-01-01', '2027-01-01');
    const aligned = alignToDailyGrid({
      observations: [
        { timestamp: '2026-01-01', value: 100 },
        { timestamp: '2027-01-01', value: 110 }
      ],
      evaluationDates,
      interpolation: 'ffill',
      staleDays: 1000
    });

    const t = transformDailySeries({ aligned, transform: 'yoy', eps: 1e-12 });
    const last = t[t.length - 1]!;
    // (110-100)/100 = 0.1
    expect(last.x).toBeCloseTo(0.1, 8);
  });
});
