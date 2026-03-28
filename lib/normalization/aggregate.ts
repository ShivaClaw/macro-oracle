import type {
  AxisAggregationInput,
  AxisDailyOutput,
  ConstituentConfig,
  ConstituentDailyOutput
} from './types';
import { normalCdf } from './percentile';
import { emaStep } from './ema';

export interface AxisAggregationParams {
  axis: AxisAggregationInput;
  constituents: Array<{ config: Pick<ConstituentConfig, 'id' | 'weight'>; series: ConstituentDailyOutput[] }>;
}

function assertSameDates(seriesA: { date: string }[], seriesB: { date: string }[], labelA: string, labelB: string) {
  if (seriesA.length !== seriesB.length) {
    throw new Error(`Series length mismatch (${labelA}=${seriesA.length}, ${labelB}=${seriesB.length})`);
  }
  for (let i = 0; i < seriesA.length; i++) {
    if (seriesA[i]!.date !== seriesB[i]!.date) {
      throw new Error(`Date grid mismatch at i=${i}: ${labelA}=${seriesA[i]!.date}, ${labelB}=${seriesB[i]!.date}`);
    }
  }
}

export function aggregateRiskAxis(params: AxisAggregationParams): AxisDailyOutput[] {
  const { axis, constituents } = params;
  if (constituents.length === 0) return [];

  const base = constituents[0]!.series;
  for (let k = 1; k < constituents.length; k++) {
    assertSameDates(base, constituents[k]!.series, constituents[0]!.config.id, constituents[k]!.config.id);
  }

  const totalWeight = constituents.reduce((s, c) => s + c.config.weight, 0);
  if (!(totalWeight > 0)) throw new Error(`Total weight must be > 0 for axis ${axis.id}`);

  const space = axis.aggregation_space ?? 'score';

  const out: AxisDailyOutput[] = [];
  let ema: number | null = null;

  for (let i = 0; i < base.length; i++) {
    const date = base[i]!.date;

    let wValid = 0;
    let weightedSum = 0;
    let nValid = 0;

    for (const c of constituents) {
      const row = c.series[i]!;

      if (space === 'score') {
        if (row.score === null || row.flags.missing) continue;
        wValid += c.config.weight;
        weightedSum += c.config.weight * row.score;
        nValid++;
      } else {
        if (row.z === null || row.flags.missing) continue;
        wValid += c.config.weight;
        weightedSum += c.config.weight * row.z;
        nValid++;
      }
    }

    const coverage = wValid / totalWeight;
    let score: number | null = null;
    let lowCoverage = false;

    if (nValid === 0) {
      score = null;
      lowCoverage = true;
    } else if (coverage < axis.coverage_threshold) {
      score = null;
      lowCoverage = true;
    } else {
      if (space === 'score') {
        score = weightedSum / wValid;
      } else {
        const zAxis = weightedSum / wValid;
        score = 100 * normalCdf(zAxis);
      }
    }

    if (score !== null) ema = emaStep(ema, score, axis.ema_alpha);

    out.push({
      date,
      axis: axis.id,
      score,
      score_ema: score === null ? null : ema,
      coverage,
      n_valid: nValid,
      flags: { low_coverage: lowCoverage }
    });
  }

  return out;
}
