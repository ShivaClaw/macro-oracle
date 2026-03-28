export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n-1). Returns 0 for n<2. */
export function stdevSample(xs: number[], mu?: number): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mu ?? mean(xs);
  let ss = 0;
  for (const x of xs) {
    const d = x - m;
    ss += d * d;
  }
  return Math.sqrt(ss / (n - 1));
}

/**
 * Quantile using linear interpolation between order statistics.
 * For sorted xs of length n, uses index = (n-1)*p.
 */
export function quantileSorted(xsSorted: number[], p: number): number {
  const n = xsSorted.length;
  if (n === 0) return NaN;
  if (p <= 0) return xsSorted[0]!;
  if (p >= 1) return xsSorted[n - 1]!;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xsSorted[lo]!;
  const w = idx - lo;
  return xsSorted[lo]! * (1 - w) + xsSorted[hi]! * w;
}

export function winsorize(xs: number[], pLo: number, pHi: number): {
  winsorized: number[];
  qLo: number;
  qHi: number;
} {
  if (xs.length === 0) return { winsorized: [], qLo: NaN, qHi: NaN };
  const sorted = [...xs].sort((a, b) => a - b);
  const qLo = quantileSorted(sorted, pLo);
  const qHi = quantileSorted(sorted, pHi);
  const winsorized = xs.map((x) => clamp(x, qLo, qHi));
  return { winsorized, qLo, qHi };
}

export function robustMeanStd(xs: number[], pLo: number, pHi: number): {
  mu: number;
  sigma: number;
  qLo: number;
  qHi: number;
} {
  const { winsorized, qLo, qHi } = winsorize(xs, pLo, pHi);
  const mu = mean(winsorized);
  const sigma = stdevSample(winsorized, mu);
  return { mu, sigma, qLo, qHi };
}
