export type ProviderName = 'fred' | 'fmp' | 'alphavantage' | 'coingecko'

export type CanonicalPoint = { t: string; v: number } // ISO date YYYY-MM-DD

export type CanonicalSeries = {
  id: string
  label: string
  unit: string
  frequency: 'daily' | 'weekly' | 'monthly'
  points: CanonicalPoint[]
  source: {
    provider: ProviderName
    endpoint: string
    fetchedAt: string
  }
}

export type FetchError = {
  code:
    | 'NO_API_KEY'
    | 'HTTP_ERROR'
    | 'TIMEOUT'
    | 'PARSE_ERROR'
    | 'UNKNOWN'
  message: string
  httpStatus?: number
}

export type FetchMeta = {
  provider: ProviderName
  endpoint: string
  fetchedAt: string
  fromCache: boolean
  stale: boolean
  ttlSeconds: number
}

export type FetchResult<T> =
  | { ok: true; data: T; meta: FetchMeta; error: null }
  | { ok: false; data: null; meta: FetchMeta; error: FetchError }

export type ProviderStatus = {
  ok: boolean
  hasKey: boolean
  lastSuccessAt?: string
  lastErrorAt?: string
  lastError?: string
}
