import { describe, expect, test } from 'vitest';
import { robustMeanStd, winsorize, normalCdf, empiricalPercentile, emaStep } from '../index.js';

describe('winsorization + stats', () => {
  test('winsorize clamps extremes at quantiles', () => {
    const xs = [1, 2, 100, 3, 4];
    const { winsorized, qHi } = winsorize(xs, 0, 0.8);
    expect(Math.max(...winsorized)).toBeCloseTo(qHi, 12);
    expect(qHi).toBeCloseTo(23.2, 10);
  });

  test('sigma near zero yields sigma=0 in stats (handled later by z logic)', () => {
    const xs = [5, 5, 5, 5];
    const { sigma } = robustMeanStd(xs, 0.01, 0.99);
    expect(sigma).toBe(0);
  });
});

describe('percentile maps', () => {
  test('normalCdf sanity', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 4);
    expect(normalCdf(1)).toBeGreaterThan(0.5);
    expect(normalCdf(-1)).toBeLessThan(0.5);
  });

  test('empiricalPercentile midrank ties', () => {
    const xs = [0, 0, 1, 2];
    // midrank: (#{<0}=0 + 0.5*#{==0}=1) / 4 = 0.25
    expect(empiricalPercentile(xs, 0, 'midrank')).toBeCloseTo(0.25, 12);
  });
});

describe('ema', () => {
  test('ema initializes from first value and updates recursively', () => {
    let ema: number | null = null;
    ema = emaStep(ema, 100, 0.25);
    expect(ema).toBe(100);
    ema = emaStep(ema, 0, 0.25);
    expect(ema).toBe(75);
  });
});
