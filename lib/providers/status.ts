import { cacheGet, cacheSet } from '@/lib/cache'
import { nowIso } from '@/lib/utils/time'
import type { ProviderName, ProviderStatus } from './types'

const STATUS_TTL_SECONDS = 60 * 60 * 24 * 30 // 30d

function statusKey(provider: ProviderName) {
  return `oracle:providerStatus:${provider}`
}

export async function getProviderStatus(provider: ProviderName): Promise<ProviderStatus> {
  const res = await cacheGet<ProviderStatus>(statusKey(provider), { allowStale: true })
  if (res.hit && res.entry) return res.entry.value
  return { ok: false, hasKey: false }
}

export async function setProviderStatus(provider: ProviderName, status: ProviderStatus): Promise<void> {
  await cacheSet(statusKey(provider), status, STATUS_TTL_SECONDS)
}

export async function markProviderSuccess(provider: ProviderName, hasKey: boolean): Promise<void> {
  const prev = await getProviderStatus(provider)
  await setProviderStatus(provider, {
    ok: true,
    hasKey,
    lastSuccessAt: nowIso(),
    lastErrorAt: prev.lastErrorAt,
    lastError: prev.lastError
  })
}

export async function markProviderError(provider: ProviderName, hasKey: boolean, err: string): Promise<void> {
  const prev = await getProviderStatus(provider)
  await setProviderStatus(provider, {
    ok: false,
    hasKey,
    lastSuccessAt: prev.lastSuccessAt,
    lastErrorAt: nowIso(),
    lastError: err
  })
}

export async function providerStatusSummary(): Promise<Record<ProviderName, ProviderStatus>> {
  const providers: ProviderName[] = ['fred', 'fmp', 'alphavantage', 'coingecko']
  const out = {} as Record<ProviderName, ProviderStatus>
  for (const p of providers) out[p] = await getProviderStatus(p)
  return out
}
