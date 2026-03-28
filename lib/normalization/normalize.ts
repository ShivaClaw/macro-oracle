import type { ConstituentConfig, ConstituentDailyOutput, MissingReason, Observation } from './types';
import { DEFAULTS } from './types';
import { buildDailyGrid, isoToDayNumber, toDayNumber, dayNumberToIso } from './dates';
import { alignToDailyGrid } from './alignment';
import { transformDailySeries } from './transforms';
import { clamp, robustMeanStd } from './stats';
import { normalCdf, empiricalPercentile } from './percentile';
import { emaStep } from './ema';

function lookbackSchedule(initial: number, max: number): number[] {
  const candidates = [initial, 180, 365, max];
  const uniq = Array.from(new Set(candidates.filter((d) => d > 0 && d <= max)));
  uniq.sort((a, b) => a - b);
  // Ensure initial first if it wasn't the smallest (e.g. initial=500)
  if (!uniq.includes(initial) && initial <= max) uniq.unshift(initial);
  return uniq;
}

function isDailyConsecutiveGrid(evaluationDates: string[]): boolean {
  for (let i = 1; i < evaluationDates.length; i++) {
    const prev = isoToDayNumber(evaluationDates[i - 1]!);
    const cur = isoToDayNumber(evaluationDates[i]!);
    if (cur - prev !== 1) return false;
  }
  return true;
}

function collectWindowSamples(params: {
  points: { day: number; x: number | null; asof_day: number | null; missing: boolean }[];
  endIndex: number;
  lookbackDays: number;
  uniqueAsof: boolean;
  consecutiveDailyGrid: boolean;
}): number[] {
  const { points, endIndex, lookbackDays, uniqueAsof, consecutiveDailyGrid } = params;
  const endDay = points[endIndex]!.day;
  const startDay = endDay - lookbackDays + 1;

  let startIndex = 0;
  if (consecutiveDailyGrid) {
    startIndex = Math.max(0, endIndex - lookbackDays + 1);
  } else {
    // fallback scan
    startIndex = endIndex;
    while (startIndex > 0 && points[startIndex - 1]!.day >= startDay) startIndex--;
  }

  const xs: number[] = [];
  let lastAsof: number | null = null;

  for (let i = startIndex; i <= endIndex; i++) {
    const p = points[i]!;
    if (p.missing || p.x === null) continue;

    if (uniqueAsof) {
      const a = p.asof_day;
      if (a === null) continue;
      if (a === lastAsof) continue;
      lastAsof = a;
    }

    xs.push(p.x);
  }

  return xs;
}

export function withConstituentDefaults(cfg: Partial<ConstituentConfig> & Pick<ConstituentConfig, 'id' | 'frequency' | 'transform' | 'polarity' | 'weight' | 'interpolation' | 'stale_days'>): ConstituentConfig {
  const merged: ConstituentConfig = {
    ...DEFAULTS,
    ...cfg,
    winsor: {
      pLo: cfg.winsor?.pLo ?? DEFAULTS.winsor.pLo,
      pHi: cfg.winsor?.pHi ?? DEFAULTS.winsor.pHi
    }
  };

  // Heuristic default per spec: for non-daily, if not linear interpolation, sample unique asof points.
  if (cfg.stats_use_unique_asof_samples === undefined) {
    merged.stats_use_unique_asof_samples =
      merged.frequency !== 'daily' && merged.interpolation !== 'linear';
  }

  return merged;
}

export interface NormalizeOptions {
  /** Provide explicit evaluation grid. If omitted, inferred from observation range. */
  evaluationDates?: string[];
  startDate?: string;
  endDate?: string;
  /** If true, treat the entire constituent as missing with api_error flag. */
  apiError?: boolean;
}

export function normalizeConstituentSeries(params: {
  config: Partial<ConstituentConfig> & Pick<ConstituentConfig, 'id' | 'frequency' | 'transform' | 'polarity' | 'weight' | 'interpolation' | 'stale_days'>;
  observations: Observation[];
  options?: NormalizeOptions;
}): ConstituentDailyOutput[] {
  const config = withConstituentDefaults(params.config);
  const { observations } = params;
  const options = params.options ?? {};

  let evaluationDates: string[];
  if (options.evaluationDates) {
    evaluationDates = options.evaluationDates;
  } else if (options.startDate && options.endDate) {
    evaluationDates = buildDailyGrid(options.startDate, options.endDate);
  } else {
    // Infer a grid from observation range.
    if (observations.length === 0) throw new Error('Cannot infer evaluation grid from empty observations');
    const days = observations.map((o) => toDayNumber(o.timestamp));
    const minDay = Math.min(...days);
    const maxDay = Math.max(...days);
    evaluationDates = buildDailyGrid(dayNumberToIso(minDay), dayNumberToIso(maxDay));
  }

  const consecutiveDailyGrid = isDailyConsecutiveGrid(evaluationDates);

  if (options.apiError) {
    return evaluationDates.map((date) => ({
      date,
      id: config.id,
      value_raw_asof: null,
      asof_date: null,
      value_daily: null,
      x: null,
      mu: null,
      sigma: null,
      z: null,
      percentile: null,
      score: null,
      score_ema: null,
      lookback_days_used: null,
      n_effective: null,
      winsor_lo: null,
      winsor_hi: null,
      flags: { stale: false, missing: true, insufficient_history: false, api_error: true, reason: 'api_error' }
    }));
  }

  const aligned = alignToDailyGrid({
    observations,
    evaluationDates,
    interpolation: config.interpolation,
    staleDays: config.stale_days
  });

  const transformed = transformDailySeries({ aligned, transform: config.transform, eps: config.eps_denom });

  const lookbacks = lookbackSchedule(config.rolling_window_days, config.max_lookback_days);

  // Prebuild minimal structure for sampling.
  const points = transformed.map((p) => ({
    day: p.day,
    x: p.x,
    asof_day: p.asof_day,
    missing: p.flags.missing
  }));

  const out: ConstituentDailyOutput[] = [];
  let ema: number | null = null;
  const zSeries: Array<{ day: number; z: number } | null> = [];

  for (let i = 0; i < transformed.length; i++) {
    const p = transformed[i]!;
    const baseFlags = {
      stale: aligned[i]!.flags.stale,
      missing: p.flags.missing,
      insufficient_history: false,
      api_error: false,
      reason: undefined as MissingReason | undefined
    };

    // propagate transform/alignment missing reason
    if (p.flags.missing) {
      const r = p.flags.reason as MissingReason | undefined;
      baseFlags.reason = r;
      baseFlags.missing = true;
      zSeries.push(null);
      out.push({
        date: p.date,
        id: config.id,
        value_raw_asof: aligned[i]!.value_raw_asof,
        asof_date: aligned[i]!.asof_date,
        value_daily: aligned[i]!.value_daily,
        x: null,
        mu: null,
        sigma: null,
        z: null,
        percentile: null,
        score: null,
        score_ema: null,
        lookback_days_used: null,
        n_effective: null,
        winsor_lo: null,
        winsor_hi: null,
        flags: baseFlags
      });
      continue;
    }

    // build window, extend if needed
    let chosenLookback: number | null = null;
    let samples: number[] = [];
    for (const L of lookbacks) {
      const xs = collectWindowSamples({
        points,
        endIndex: i,
        lookbackDays: L,
        uniqueAsof: config.stats_use_unique_asof_samples,
        consecutiveDailyGrid
      });
      if (xs.length >= config.min_effective_obs) {
        chosenLookback = L;
        samples = xs;
        break;
      }
      samples = xs; // keep last for diagnostics
      chosenLookback = L;
    }

    if (samples.length < config.min_effective_obs) {
      baseFlags.missing = true;
      baseFlags.insufficient_history = true;
      baseFlags.reason = 'insufficient_history';
      zSeries.push(null);
      out.push({
        date: p.date,
        id: config.id,
        value_raw_asof: aligned[i]!.value_raw_asof,
        asof_date: aligned[i]!.asof_date,
        value_daily: aligned[i]!.value_daily,
        x: p.x,
        mu: null,
        sigma: null,
        z: null,
        percentile: null,
        score: null,
        score_ema: null,
        lookback_days_used: chosenLookback,
        n_effective: samples.length,
        winsor_lo: null,
        winsor_hi: null,
        flags: baseFlags
      });
      continue;
    }

    const { mu, sigma, qLo, qHi } = robustMeanStd(samples, config.winsor.pLo, config.winsor.pHi);

    let z: number;
    if (sigma < config.eps_sigma) z = 0;
    else z = (p.x! - mu) / Math.max(sigma, config.eps_sigma);

    z = clamp(z, -config.z_cap, config.z_cap);
    zSeries.push({ day: p.day, z });

    // percentile mapping
    let percentile: number;
    if (config.percentile_map === 'normal_cdf') {
      percentile = normalCdf(z);
    } else {
      // empirical: use z history within lookback
      const startDay = p.day - config.empirical_lookback_days + 1;
      const zHist: number[] = [];
      for (let j = 0; j < zSeries.length; j++) {
        const zz = zSeries[j];
        if (!zz) continue;
        if (zz.day < startDay) continue;
        zHist.push(zz.z);
      }
      if (zHist.length < config.empirical_min_obs) percentile = normalCdf(z);
      else percentile = empiricalPercentile(zHist, z, 'midrank');
    }

    // score
    const scoreRaw = 100 * percentile;
    const score = config.polarity === 1 ? scoreRaw : 100 - scoreRaw;

    // ema
    ema = emaStep(ema, score, config.ema_alpha);

    out.push({
      date: p.date,
      id: config.id,
      value_raw_asof: aligned[i]!.value_raw_asof,
      asof_date: aligned[i]!.asof_date,
      value_daily: aligned[i]!.value_daily,
      x: p.x,
      mu,
      sigma,
      z,
      percentile,
      score,
      score_ema: ema,
      lookback_days_used: chosenLookback,
      n_effective: samples.length,
      winsor_lo: qLo,
      winsor_hi: qHi,
      flags: baseFlags
    });
  }

  return out;
}
