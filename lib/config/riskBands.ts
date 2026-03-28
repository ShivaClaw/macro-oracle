import type { RiskBandDef } from './types'

// NOTE: This is a pragmatic "MVP" band/constituent set.
// Expand/adjust using BACKEND_API_SPEC.md §2.3.
export const RISK_BANDS: RiskBandDef[] = [
  {
    id: 'RISK_0',
    label: 'Cash & Funding Liquidity',
    description: 'Baseline risk-free liquidity / funding conditions.',
    minCoverageWeight: 0.6,
    constituents: [
      {
        id: 'SOFR',
        label: 'SOFR',
        unit: '%',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=SOFR&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=90',
        params: { seriesId: 'SOFR', limit: 90 },
        ttlSeconds: 3600,
        staleMaxAgeSeconds: 60 * 60 * 48,
        weight: 0.4,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'DTB3',
        label: '3M T-Bill',
        unit: '%',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=DTB3&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=90',
        params: { seriesId: 'DTB3', limit: 90 },
        ttlSeconds: 6 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 72,
        weight: 0.3,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'DTWEXBGS',
        label: 'Trade-Weighted USD (Broad)',
        unit: 'index',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=DTWEXBGS&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'DTWEXBGS', limit: 400 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 14,
        weight: 0.3,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      }
    ]
  },
  {
    id: 'RISK_1',
    label: 'Duration / Sovereign Rates Risk',
    description: 'Interest-rate volatility and duration shock.',
    minCoverageWeight: 0.6,
    constituents: [
      {
        id: 'DGS2',
        label: 'US 2Y Yield',
        unit: '%',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=DGS2&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=180',
        params: { seriesId: 'DGS2', limit: 180 },
        ttlSeconds: 6 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 72,
        weight: 0.25,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'DGS10',
        label: 'US 10Y Yield',
        unit: '%',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=180',
        params: { seriesId: 'DGS10', limit: 180 },
        ttlSeconds: 6 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 72,
        weight: 0.25,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'T10Y2Y',
        label: '10Y-2Y Slope',
        unit: '%',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=T10Y2Y&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'T10Y2Y', limit: 400 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 14,
        weight: 0.2,
        polarity: 'risk_on',
        frequency: 'daily',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'TLT',
        label: 'TLT (20Y+ Treasuries)',
        unit: 'USD',
        provider: 'fmp',
        endpointTemplate: 'https://financialmodelingprep.com/api/v3/historical-price-full/TLT?serietype=line&timeseries=200&apikey={FMP_API_KEY}',
        params: { symbol: 'TLT', timeseries: 240 },
        ttlSeconds: 15 * 60,
        staleMaxAgeSeconds: 60 * 60 * 24,
        weight: 0.3,
        polarity: 'risk_on',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } },
        fallback: {
          provider: 'alphavantage',
          endpointTemplate:
            'https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=TLT&outputsize=compact&apikey={ALPHAVANTAGE_API_KEY}',
          params: { symbol: 'TLT', outputsize: 'compact' }
        }
      }
    ]
  },
  {
    id: 'RISK_2',
    label: 'Investment Grade Credit Conditions',
    description: 'IG spreads & corporate funding conditions.',
    minCoverageWeight: 0.6,
    constituents: [
      {
        id: 'BAMLC0A0CM',
        label: 'IG OAS (ICE BofA)',
        unit: '%',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=BAMLC0A0CM&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'BAMLC0A0CM', limit: 400 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 30,
        weight: 0.4,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'BAA',
        label: "Moody's Baa Yield",
        unit: '%',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=BAA&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'BAA', limit: 400 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 30,
        weight: 0.3,
        polarity: 'risk_off',
        frequency: 'monthly',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'LQD',
        label: 'LQD (IG Credit ETF)',
        unit: 'USD',
        provider: 'fmp',
        endpointTemplate: 'https://financialmodelingprep.com/api/v3/historical-price-full/LQD?serietype=line&timeseries=200&apikey={FMP_API_KEY}',
        params: { symbol: 'LQD', timeseries: 240 },
        ttlSeconds: 15 * 60,
        staleMaxAgeSeconds: 60 * 60 * 24,
        weight: 0.3,
        polarity: 'risk_on',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      }
    ]
  },
  {
    id: 'RISK_3',
    label: 'Equity Defensive / Volatility Regime',
    description: 'Equity vol regime; defensive equity behavior.',
    minCoverageWeight: 0.6,
    constituents: [
      {
        id: 'VIXCLS',
        label: 'VIX',
        unit: 'index',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=200',
        params: { seriesId: 'VIXCLS', limit: 200 },
        ttlSeconds: 6 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 7,
        weight: 0.45,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'SPY',
        label: 'SPY',
        unit: 'USD',
        provider: 'fmp',
        endpointTemplate: 'https://financialmodelingprep.com/api/v3/historical-price-full/SPY?serietype=line&timeseries=200&apikey={FMP_API_KEY}',
        params: { symbol: 'SPY', timeseries: 240 },
        ttlSeconds: 10 * 60,
        staleMaxAgeSeconds: 60 * 60 * 24,
        weight: 0.35,
        polarity: 'risk_on',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'XLU',
        label: 'XLU (Utilities)',
        unit: 'USD',
        provider: 'fmp',
        endpointTemplate: 'https://financialmodelingprep.com/api/v3/historical-price-full/XLU?serietype=line&timeseries=200&apikey={FMP_API_KEY}',
        params: { symbol: 'XLU', timeseries: 240 },
        ttlSeconds: 10 * 60,
        staleMaxAgeSeconds: 60 * 60 * 24,
        weight: 0.2,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      }
    ]
  },
  {
    id: 'RISK_4',
    label: 'Equity Cyclical / Growth Appetite',
    description: 'Growth vs value, small caps, economic momentum.',
    minCoverageWeight: 0.6,
    constituents: [
      {
        id: 'QQQ',
        label: 'QQQ (Growth)',
        unit: 'USD',
        provider: 'fmp',
        endpointTemplate: 'https://financialmodelingprep.com/api/v3/historical-price-full/QQQ?serietype=line&timeseries=200&apikey={FMP_API_KEY}',
        params: { symbol: 'QQQ', timeseries: 240 },
        ttlSeconds: 10 * 60,
        staleMaxAgeSeconds: 60 * 60 * 24,
        weight: 0.45,
        polarity: 'risk_on',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'IWM',
        label: 'IWM (Small Caps)',
        unit: 'USD',
        provider: 'fmp',
        endpointTemplate: 'https://financialmodelingprep.com/api/v3/historical-price-full/IWM?serietype=line&timeseries=200&apikey={FMP_API_KEY}',
        params: { symbol: 'IWM', timeseries: 240 },
        ttlSeconds: 10 * 60,
        staleMaxAgeSeconds: 60 * 60 * 24,
        weight: 0.35,
        polarity: 'risk_on',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 365, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'INDPRO',
        label: 'Industrial Production',
        unit: 'index',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=INDPRO&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=240',
        params: { seriesId: 'INDPRO', limit: 240 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 30,
        weight: 0.2,
        polarity: 'risk_on',
        frequency: 'monthly',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 3650, clamp: { min: 0, max: 100 } }
      }
    ]
  },
  {
    id: 'RISK_5',
    label: 'Inflation / Commodities Pressure',
    description: 'Commodity inflation and real-economy price pressure.',
    minCoverageWeight: 0.6,
    constituents: [
      {
        id: 'DCOILWTICO',
        label: 'WTI Crude',
        unit: 'USD/bbl',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=DCOILWTICO&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'DCOILWTICO', limit: 400 },
        ttlSeconds: 6 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 7,
        weight: 0.35,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'CPIAUCSL',
        label: 'CPI (All Urban Consumers)',
        unit: 'index',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=240',
        params: { seriesId: 'CPIAUCSL', limit: 240 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 45,
        weight: 0.35,
        polarity: 'risk_off',
        frequency: 'monthly',
        transform: { kind: 'pct_change', windowDays: 365 },
        normalize: { kind: 'zscore', lookbackDays: 3650, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'GLD',
        label: 'GLD (Gold)',
        unit: 'USD',
        provider: 'fmp',
        endpointTemplate: 'https://financialmodelingprep.com/api/v3/historical-price-full/GLD?serietype=line&timeseries=200&apikey={FMP_API_KEY}',
        params: { symbol: 'GLD', timeseries: 240 },
        ttlSeconds: 10 * 60,
        staleMaxAgeSeconds: 60 * 60 * 24,
        weight: 0.3,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      }
    ]
  },
  {
    id: 'RISK_6',
    label: 'FX / Global Stress',
    description: 'USD strength and cross-border stress proxies.',
    minCoverageWeight: 0.6,
    constituents: [
      {
        id: 'DEXJPUS',
        label: 'JPY per USD',
        unit: 'JPY',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=DEXJPUS&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'DEXJPUS', limit: 400 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 14,
        weight: 0.35,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'DEXUSEU',
        label: 'USD per EUR',
        unit: 'USD',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=DEXUSEU&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'DEXUSEU', limit: 400 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 14,
        weight: 0.25,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'EEM',
        label: 'EEM (Emerging Markets)',
        unit: 'USD',
        provider: 'fmp',
        endpointTemplate: 'https://financialmodelingprep.com/api/v3/historical-price-full/EEM?serietype=line&timeseries=200&apikey={FMP_API_KEY}',
        params: { symbol: 'EEM', timeseries: 240 },
        ttlSeconds: 10 * 60,
        staleMaxAgeSeconds: 60 * 60 * 24,
        weight: 0.4,
        polarity: 'risk_on',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      }
    ]
  },
  {
    id: 'RISK_7',
    label: 'Crypto Risk Appetite',
    description: 'Crypto spot behavior as a fast risk proxy.',
    minCoverageWeight: 0.6,
    constituents: [
      {
        id: 'bitcoin',
        label: 'Bitcoin',
        unit: 'USD',
        provider: 'coingecko',
        endpointTemplate: 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily',
        params: { coinId: 'bitcoin', days: 365 },
        ttlSeconds: 300,
        staleMaxAgeSeconds: 60 * 60,
        weight: 0.55,
        polarity: 'risk_on',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'ethereum',
        label: 'Ethereum',
        unit: 'USD',
        provider: 'coingecko',
        endpointTemplate: 'https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=365&interval=daily',
        params: { coinId: 'ethereum', days: 365 },
        ttlSeconds: 300,
        staleMaxAgeSeconds: 60 * 60,
        weight: 0.45,
        polarity: 'risk_on',
        frequency: 'daily',
        transform: { kind: 'pct_change', windowDays: 30 },
        normalize: { kind: 'zscore', lookbackDays: 730, clamp: { min: 0, max: 100 } }
      }
    ]
  },
  {
    id: 'RISK_8',
    label: 'Systemic Stress',
    description: 'Funding/market stress composite proxies.',
    minCoverageWeight: 0.6,
    constituents: [
      {
        id: 'TEDRATE',
        label: 'TED Spread',
        unit: '%',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=TEDRATE&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'TEDRATE', limit: 400 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 30,
        weight: 0.35,
        polarity: 'risk_off',
        frequency: 'daily',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 3650, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'NFCI',
        label: 'NFCI (Chicago Fed)',
        unit: 'index',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=NFCI&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'NFCI', limit: 400 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 30,
        weight: 0.35,
        polarity: 'risk_off',
        frequency: 'weekly',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 3650, clamp: { min: 0, max: 100 } }
      },
      {
        id: 'STLFSI4',
        label: 'St. Louis Fed Financial Stress Index',
        unit: 'index',
        provider: 'fred',
        endpointTemplate: 'https://api.stlouisfed.org/fred/series/observations?series_id=STLFSI4&api_key={FRED_API_KEY}&file_type=json&sort_order=desc&limit=400',
        params: { seriesId: 'STLFSI4', limit: 400 },
        ttlSeconds: 24 * 3600,
        staleMaxAgeSeconds: 60 * 60 * 24 * 30,
        weight: 0.3,
        polarity: 'risk_off',
        frequency: 'weekly',
        transform: { kind: 'level' },
        normalize: { kind: 'zscore', lookbackDays: 3650, clamp: { min: 0, max: 100 } }
      }
    ]
  }
]
