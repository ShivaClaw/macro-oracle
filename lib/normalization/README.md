# Macro Oracle Radar — Normalization Library

Implements the algorithms in `NORMALIZATION_LOGIC_SPEC.md`:

- Daily alignment for mixed-frequency series (daily/weekly/monthly) with `ffill`, `linear`, or `none`.
- Robust rolling z-scores with winsorization + z-caps.
- Percentile → 0–100 mapping (normal CDF or empirical).
- Axis aggregation with weights + coverage gating.
- 7-day momentum (“tail”) vectors.

## Data model

### Observations

```ts
import type { Observation } from './index.js';

const observations: Observation[] = [
  { timestamp: '2026-01-01', value: 100 },
  { timestamp: '2026-01-02', value: 101 }
];
```

Timestamps may be `YYYY-MM-DD`, any ISO string, `Date`, or epoch-ms.

### Constituent config

Config mirrors the spec (with sane defaults filled by `withConstituentDefaults`).

```ts
import { normalizeConstituentSeries } from './index.js';

const series = normalizeConstituentSeries({
  config: {
    id: 'BTC_USD',
    frequency: 'daily',
    transform: 'log',
    polarity: 1,
    weight: 1,
    interpolation: 'ffill',
    stale_days: 3,

    // optional overrides
    percentile_map: 'normal_cdf',
    rolling_window_days: 90,
    min_effective_obs: 60,
    z_cap: 4,
    winsor: { pLo: 0.01, pHi: 0.99 },
    ema_alpha: 0.25
  },
  observations,
  options: {
    startDate: '2026-01-01',
    endDate: '2026-03-28'
  }
});
```

Each output row includes `x, mu, sigma, z, percentile, score, score_ema` plus missing/stale flags.

## Alignment helpers

```ts
import { alignToDailyGrid } from './index.js';

const aligned = alignToDailyGrid({
  observations,
  evaluationDates: ['2026-01-01', '2026-01-02'],
  interpolation: 'linear',
  staleDays: 60
});
```

## Axis aggregation

```ts
import { aggregateRiskAxis } from './index.js';

const axisSeries = aggregateRiskAxis({
  axis: {
    id: 'RISK_ON',
    angle_rad: 0,
    coverage_threshold: 0.6,
    ema_alpha: 0.25,
    aggregation_space: 'score' // or 'z'
  },
  constituents: [
    { config: { id: 'BTC_USD', weight: 1 }, series: btcSeries },
    { config: { id: 'SPX', weight: 1 }, series: spxSeries }
  ]
});
```

- Uses only constituents with non-null values on that date.
- Coverage is `sum(weights of valid) / sum(weights of all)`.
- If coverage drops below `coverage_threshold`, `score=null` and `flags.low_coverage=true`.

## Momentum / tails

```ts
import { computeAxisTailVectors } from './index.js';

const tails = computeAxisTailVectors({
  axisId: 'RISK_ON',
  angleRad: 0,
  axisSeries,
  options: { deltaDays: 7, mCap: 30 }
});
```

`delta_7d` is computed from `score_ema` as in the spec.

## Edge-case semantics

- **Stale** (`stale_days` exceeded): treated as missing and excluded from axis aggregation.
- **Insufficient history**: if `min_effective_obs` can’t be reached even after lookback extension (up to `max_lookback_days`), output `score=null` and `flags.insufficient_history=true`.
- **Sigma floor**: if rolling sigma is ~0, `z` is set to 0 (neutral).
- **Log transforms**: non-positive values produce missing with reason `invalid_nonpositive_for_log`.
- **API failures**: pass `options.apiError=true` to mark the whole series missing (no silent forward-fill).
