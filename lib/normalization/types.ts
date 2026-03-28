export type Frequency = 'daily' | 'weekly' | 'monthly';
export type Transform = 'level' | 'log' | 'log_diff' | 'pct_change' | 'yoy' | 'diff';
export type Interpolation = 'ffill' | 'linear' | 'none';
export type PercentileMap = 'normal_cdf' | 'empirical';

export type DateInput = string | number | Date;

export interface Observation {
  timestamp: DateInput;
  value: number;
}

export interface WinsorParams {
  /** Lower winsor percentile, e.g. 0.01 */
  pLo: number;
  /** Upper winsor percentile, e.g. 0.99 */
  pHi: number;
}

export interface ConstituentConfig {
  id: string;
  name?: string;
  axis?: string;
  frequency: Frequency;
  units?: string;

  transform: Transform;
  polarity: 1 | -1;
  weight: number;

  interpolation: Interpolation;
  stale_days: number;

  /** Minimum effective samples needed for stable rolling stats. */
  min_effective_obs: number;
  /** Rolling window length (calendar days) used first, before extension. */
  rolling_window_days: number;
  /** Maximum lookback (calendar days) allowed when extending for more samples. */
  max_lookback_days: number;

  /** Standard deviation floor for z computation. */
  eps_sigma: number;
  /** Epsilon used in pct_change/yoy denominators. */
  eps_denom: number;

  z_cap: number;
  winsor: WinsorParams;

  percentile_map: PercentileMap;
  empirical_lookback_days: number;
  /** Minimum # of z history points to use empirical; otherwise fallback to normal_cdf. */
  empirical_min_obs: number;

  /** EMA alpha for optional smoothing (0..1). */
  ema_alpha: number;

  /**
   * For non-daily series that are forward-filled, daily repetition can collapse variance.
   * When true, rolling stats sample only one point per unique `asof` observation day.
   */
  stats_use_unique_asof_samples: boolean;
}

export const DEFAULTS: Omit<ConstituentConfig, 'id' | 'frequency' | 'transform' | 'polarity' | 'weight' | 'interpolation' | 'stale_days'> = {
  min_effective_obs: 60,
  rolling_window_days: 90,
  max_lookback_days: 730,

  eps_sigma: 1e-12,
  eps_denom: 1e-12,

  z_cap: 4,
  winsor: { pLo: 0.01, pHi: 0.99 },

  percentile_map: 'normal_cdf',
  empirical_lookback_days: 730,
  empirical_min_obs: 30,

  ema_alpha: 0.25,

  stats_use_unique_asof_samples: false
};

export type MissingReason =
  | 'api_error'
  | 'no_data'
  | 'stale'
  | 'alignment_failed'
  | 'not_observation_day'
  | 'insufficient_lag'
  | 'insufficient_history'
  | 'invalid_nonpositive_for_log';

export interface QualityFlags {
  stale: boolean;
  missing: boolean;
  insufficient_history: boolean;
  api_error: boolean;
  reason?: MissingReason;
}

export interface ConstituentDailyOutput {
  date: string;
  id: string;

  value_raw_asof: number | null;
  /** Date of the raw value used as-of (tau*(t)) */
  asof_date: string | null;

  /** Daily aligned value after interpolation/ffill (y(t)) */
  value_daily: number | null;

  /** Transformed series value used for stats (x(t)) */
  x: number | null;

  mu: number | null;
  sigma: number | null;
  z: number | null;
  percentile: number | null;

  /** Polarity-adjusted score in [0,100] */
  score: number | null;
  /** EMA-smoothed score */
  score_ema: number | null;

  /** Diagnostics */
  lookback_days_used: number | null;
  n_effective: number | null;
  winsor_lo: number | null;
  winsor_hi: number | null;

  flags: QualityFlags;
}

export interface AxisAggregationInput {
  id: string;
  angle_rad: number;
  coverage_threshold: number;
  ema_alpha: number;
  /** default: score-space */
  aggregation_space?: 'score' | 'z';
}

export interface AxisDailyOutput {
  date: string;
  axis: string;
  score: number | null;
  score_ema: number | null;
  coverage: number;
  n_valid: number;
  flags: {
    low_coverage: boolean;
  };
}

export interface TailVector {
  date: string;
  axis: string;
  delta_7d: number | null;
  delta_7d_clipped: number | null;
  vector: { x: number; y: number } | null;
}
