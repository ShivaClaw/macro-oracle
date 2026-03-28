import { describe, expect, test } from 'vitest';
import { alignToDailyGrid, buildDailyGrid } from '../index.js';

describe('alignment', () => {
  test('ffill carries last observation forward', () => {
    const evaluationDates = buildDailyGrid('2026-01-01', '2026-01-10');
    const aligned = alignToDailyGrid({
      observations: [
        { timestamp: '2026-01-01', value: 10 },
        { timestamp: '2026-01-08', value: 20 }
      ],
      evaluationDates,
      interpolation: 'ffill',
      staleDays: 100
    });

    const d4 = aligned.find((p) => p.date === '2026-01-04')!;
    expect(d4.value_daily).toBe(10);
    expect(d4.asof_date).toBe('2026-01-01');

    const d9 = aligned.find((p) => p.date === '2026-01-09')!;
    expect(d9.value_daily).toBe(20);
    expect(d9.asof_date).toBe('2026-01-08');
  });

  test('linear interpolates between prev/next obs', () => {
    const evaluationDates = buildDailyGrid('2026-01-01', '2026-01-11');
    const aligned = alignToDailyGrid({
      observations: [
        { timestamp: '2026-01-01', value: 0 },
        { timestamp: '2026-01-11', value: 10 }
      ],
      evaluationDates,
      interpolation: 'linear',
      staleDays: 100
    });

    const d6 = aligned.find((p) => p.date === '2026-01-06')!;
    // 5 days after 2026-01-01 over a 10-day span => 5
    expect(d6.value_daily).toBeCloseTo(5, 10);
  });

  test('none only emits on observation days', () => {
    const evaluationDates = buildDailyGrid('2026-01-01', '2026-01-03');
    const aligned = alignToDailyGrid({
      observations: [{ timestamp: '2026-01-01', value: 1 }],
      evaluationDates,
      interpolation: 'none',
      staleDays: 100
    });

    expect(aligned[0]!.value_daily).toBe(1);
    expect(aligned[1]!.value_daily).toBeNull();
    expect(aligned[1]!.flags.reason).toBe('not_observation_day');
  });

  test('staleness marks missing', () => {
    const evaluationDates = buildDailyGrid('2026-01-01', '2026-01-06');
    const aligned = alignToDailyGrid({
      observations: [{ timestamp: '2026-01-01', value: 10 }],
      evaluationDates,
      interpolation: 'ffill',
      staleDays: 3
    });

    const d5 = aligned.find((p) => p.date === '2026-01-05')!;
    // 2026-01-05 - 2026-01-01 = 4 days > staleDays(3)
    expect(d5.value_daily).toBeNull();
    expect(d5.flags.missing).toBe(true);
    expect(d5.flags.reason).toBe('stale');
  });
});
