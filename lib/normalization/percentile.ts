import { clamp } from './stats';

// Abramowitz & Stegun approximation for erf.
export function erf(x: number): number {
  // save the sign of x
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  // constants
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-ax * ax);

  return sign * y;
}

export function normalCdf(z: number): number {
  // Phi(z) = 0.5*(1 + erf(z/sqrt(2)))
  const p = 0.5 * (1 + erf(z / Math.SQRT2));
  return clamp(p, 0, 1);
}

export type TieHandling = 'weak' | 'midrank';

/**
 * Empirical CDF percentile.
 * - weak: P = #{x <= v}/N
 * - midrank: P = (#{x < v} + 0.5*#{x == v})/N
 */
export function empiricalPercentile(xs: number[], v: number, tieHandling: TieHandling = 'midrank'): number {
  const n = xs.length;
  if (n === 0) return NaN;

  let lt = 0;
  let eq = 0;
  for (const x of xs) {
    if (x < v) lt++;
    else if (x === v) eq++;
  }

  if (tieHandling === 'weak') return clamp((lt + eq) / n, 0, 1);
  return clamp((lt + 0.5 * eq) / n, 0, 1);
}
