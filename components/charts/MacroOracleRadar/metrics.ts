import { clamp, EPS } from './radarMath';
import type { MacroOracleRadarPayload } from './types';

export type RadarMetrics = {
  balance: number; // 0..100
  concentration: number; // 0..100
  riskOffTilt: number; // 0..100
  labels: string[];
};

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length <= 1) return 0;
  const m = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

function sumTopK(xs: number[], k: number): number {
  return xs
    .slice()
    .sort((a, b) => b - a)
    .slice(0, Math.max(0, k))
    .reduce((a, b) => a + b, 0);
}

export function computeRadarMetrics(payload: MacroOracleRadarPayload): RadarMetrics {
  const v = payload.bands.map((b) => clamp(b.valueNow, 0, 100));

  const m = mean(v);
  const s = stdev(v);
  const cv = s / (m + EPS);

  // cvMax is heuristic: above ~0.85 looks very spiky for typical N.
  const cvMax = 0.85;
  const balance = clamp(100 * (1 - cv / cvMax), 0, 100);

  const total = v.reduce((a, b) => a + b, 0) + EPS;
  const concentration = clamp((100 * sumTopK(v, 2)) / total, 0, 100);

  // Low-risk set: first 3 axes (R0–R2) by ordering contract.
  const low = v.slice(0, Math.min(3, v.length)).reduce((a, b) => a + b, 0);
  const riskOffTilt = clamp((100 * low) / total, 0, 100);

  const labels: string[] = [];
  if (balance >= 70) labels.push('Balanced');
  if (concentration >= 45) labels.push('Concentrated');
  if (riskOffTilt >= 60) labels.push('Flight to Safety');

  return { balance, concentration, riskOffTilt, labels };
}
