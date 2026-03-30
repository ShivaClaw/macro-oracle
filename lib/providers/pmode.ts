/**
 * pmode.ts
 *
 * P-mode (Personal) portfolio radar payload.
 *
 * Required env vars (recommended):
 *  - DEBANK_ACCESS_KEY   (DeBank Pro OpenAPI access key)
 *  - HELIUS_API_KEY      (Helius RPC key)
 *
 * Optional:
 *  - ZAPPER_API_KEY      (reserved; not used yet)
 *
 * Notes:
 *  - Uses best-effort fetches; never throws.
 *  - All upstream requests use AbortSignal.timeout(8000).
 */

import type { MacroOracleRadarPayload, RiskBandPoint } from '@/components/charts/MacroOracleRadar/types'
import { cacheGet, cacheKey, cacheSet } from '@/lib/cache'
import {
  classifyProtocolPosition,
  classifySpotToken,
  P_RISK_BANDS,
  type PRiskBandKey
} from '@/lib/config/tokenClassification'

// ── Constants (G wallets) ─────────────────────────────────────────────────

const G_EVM_WALLET = '0x27B968f509f54fE6B9b247044C69e6634010D5a8'
const G_SOL_WALLET = 'ERzA234UwbioGbnK9bS5P4q5ZeTYFkEzPAuiqgzgUq9K'

const DEBANK_BASE = 'https://pro-openapi.debank.com/v1'
const HYPERLIQUID_INFO = 'https://api.hyperliquid.xyz/info'

const TTL_SECONDS = 300

// ── Minimal upstream types (best-effort) ──────────────────────────────────

type DebankToken = {
  chain?: string
  id?: string // token contract address
  symbol?: string
  amount?: number
  price?: number
  is_verified?: boolean
  is_core?: boolean
}

type DebankProtocol = {
  id?: string
  name?: string
  chain?: string
  portfolio_item_list?: Array<{
    name?: string
    stats?: { net_usd_value?: number }
    detail?: Record<string, unknown>
    // debank often includes: type / pool / supply tokens, etc.
    // keep it loose to survive schema drift
  }>
}

type HyperliquidClearinghouseState = {
  marginSummary?: {
    accountValue?: string
    totalNtlPos?: string
  }
  assetPositions?: Array<{ position?: { coin?: string; positionValue?: string } }>
  time?: number
}

type HeliusGetAssetsByOwnerResponse = {
  result?: {
    items?: Array<{
      interface?: string
      id?: string
      content?: {
        metadata?: { name?: string; symbol?: string }
      }
      token_info?: {
        symbol?: string
        decimals?: number
        price_info?: { total_price?: number; price_per_token?: number }
      }
    }>
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString()
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function safePct(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0
  return Number(x.toFixed(2))
}

function initBandMap(): Record<PRiskBandKey, number> {
  return {
    R0: 0,
    R1: 0,
    R2: 0,
    R3: 0,
    R4: 0,
    R5: 0,
    R6: 0,
    R7: 0,
    R8: 0
  }
}

function addUsd(map: Record<PRiskBandKey, number>, band: PRiskBandKey, usd: number): void {
  if (!Number.isFinite(usd) || usd <= 0) return
  map[band] = (map[band] ?? 0) + usd
}

function getPmodeMemory(): {
  lastPct?: Record<PRiskBandKey, number>
  lastAsOf?: string
} {
  const g = globalThis as any
  if (!g.__macroOraclePmode) g.__macroOraclePmode = {}
  return g.__macroOraclePmode
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(input, { ...init, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ── Upstream fetchers ─────────────────────────────────────────────────────

async function fetchDebankTokens(address: string): Promise<DebankToken[]> {
  const key = process.env.DEBANK_ACCESS_KEY
  if (!key) return []
  const url = `${DEBANK_BASE}/user/all_token_list?id=${address}&is_all=false`
  const j = await fetchJson<DebankToken[]>(url, { headers: { AccessKey: key } })
  return Array.isArray(j) ? j : []
}

async function fetchDebankProtocols(address: string): Promise<DebankProtocol[]> {
  const key = process.env.DEBANK_ACCESS_KEY
  if (!key) return []
  const url = `${DEBANK_BASE}/user/all_complex_protocol_list?id=${address}`
  const j = await fetchJson<DebankProtocol[]>(url, { headers: { AccessKey: key } })
  return Array.isArray(j) ? j : []
}

async function fetchHyperliquidState(evmAddress: string): Promise<HyperliquidClearinghouseState | null> {
  return await fetchJson<HyperliquidClearinghouseState>(HYPERLIQUID_INFO, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'clearinghouseState', user: evmAddress })
  })
}

async function fetchHeliusAssets(solAddress: string): Promise<HeliusGetAssetsByOwnerResponse | null> {
  const key = process.env.HELIUS_API_KEY
  if (!key) return null
  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`
  return await fetchJson<HeliusGetAssetsByOwnerResponse>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'pmode',
      method: 'getAssetsByOwner',
      params: {
        ownerAddress: solAddress,
        page: 1,
        limit: 1000,
        displayOptions: { showFungible: true }
      }
    })
  })
}

// ── Core aggregation ──────────────────────────────────────────────────────

function bandsToPoints(opts: {
  pctByBand: Record<PRiskBandKey, number>
  prevPctByBand?: Record<PRiskBandKey, number>
}): RiskBandPoint[] {
  const { pctByBand, prevPctByBand } = opts

  // P-mode returns R1..R8 as axes; R0 is dry powder in meta.
  const keys: PRiskBandKey[] = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']

  return keys.map((k) => {
    const def = P_RISK_BANDS.find((b) => b.key === k)
    const valueNow = safePct(pctByBand[k] ?? 0)
    const value7dAgo = prevPctByBand ? safePct(prevPctByBand[k] ?? 0) : undefined
    const delta7d =
      value7dAgo != null ? Number((valueNow - value7dAgo).toFixed(2)) : undefined

    const point: RiskBandPoint = {
      key: k,
      label: def?.label ?? `RISK ${k.slice(1)}`,
      name: def?.name,
      valueNow,
      ...(value7dAgo != null && { value7dAgo }),
      ...(delta7d != null && { delta7d })
    }

    // crude flow direction heuristic
    if (delta7d != null) {
      point.flowDirection = delta7d > 0.25 ? 'inflow' : delta7d < -0.25 ? 'outflow' : 'neutral'
    }

    return point
  })
}

export async function getPmodeRadarPayload(): Promise<MacroOracleRadarPayload> {
  const key = cacheKey({ route: 'radar', mode: 'p', evm: G_EVM_WALLET, sol: G_SOL_WALLET })
  const cached = await cacheGet<MacroOracleRadarPayload>(key, { allowStale: true })
  if (cached.hit && cached.entry && !cached.stale) return cached.entry.value

  // Aggregate USD values per band.
  const usdByBand = initBandMap()
  const sourceStatus: Record<string, { ok: boolean; detail?: string }> = {}

  // 1) DeBank spot tokens
  {
    const tokens = await fetchDebankTokens(G_EVM_WALLET)
    sourceStatus.debankTokens = { ok: tokens.length > 0, detail: tokens.length ? `tokens=${tokens.length}` : 'empty' }

    for (const t of tokens) {
      const usd = num(t.amount) * num(t.price)
      const band = classifySpotToken({ symbol: t.symbol, address: t.id, chain: t.chain })
      addUsd(usdByBand, band, usd)
    }
  }

  // 2) DeBank protocol positions
  {
    const prots = await fetchDebankProtocols(G_EVM_WALLET)
    sourceStatus.debankProtocols = { ok: prots.length > 0, detail: prots.length ? `protocols=${prots.length}` : 'empty' }

    for (const p of prots) {
      const items = p.portfolio_item_list ?? []
      for (const it of items) {
        const usd = num(it.stats?.net_usd_value)

        // best-effort extract of underlying symbols if present
        const und: string[] = []
        try {
          const detail = it.detail as any
          const maybeTokens: any[] =
            detail?.supply_token_list ?? detail?.token_list ?? detail?.underlying_token_list ?? []
          if (Array.isArray(maybeTokens)) {
            for (const ut of maybeTokens) {
              if (ut?.symbol && typeof ut.symbol === 'string') und.push(ut.symbol)
            }
          }
        } catch {
          // ignore
        }

        const band = classifyProtocolPosition({
          protocolName: p.name,
          positionName: it.name,
          category: (it.detail as any)?.type ?? (it.detail as any)?.category ?? null,
          underlyingSymbols: und
        })

        addUsd(usdByBand, band, usd)
      }
    }
  }

  // 3) Helius Solana fungible tokens
  {
    const helius = await fetchHeliusAssets(G_SOL_WALLET)
    const items = helius?.result?.items ?? []
    const fung = items.filter((i) => i.interface === 'FungibleToken')
    sourceStatus.helius = { ok: fung.length > 0, detail: fung.length ? `fungible=${fung.length}` : 'empty' }

    for (const f of fung) {
      const sym = f.token_info?.symbol ?? f.content?.metadata?.symbol
      const usd = num(f.token_info?.price_info?.total_price)
      const band = classifySpotToken({ symbol: sym, address: f.id ?? null, chain: 'solana' })
      addUsd(usdByBand, band, usd)
    }
  }

  // 4) Hyperliquid
  {
    const st = await fetchHyperliquidState(G_EVM_WALLET)
    const accountValueUsd = num(st?.marginSummary?.accountValue)
    sourceStatus.hyperliquid = {
      ok: st != null,
      detail: st ? `accountValue=${accountValueUsd}` : 'null'
    }
    addUsd(usdByBand, 'R8', accountValueUsd)
  }

  const totalUsd = Object.values(usdByBand).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)

  const pctByBand = initBandMap()
  if (totalUsd > 0) {
    for (const k of Object.keys(pctByBand) as PRiskBandKey[]) {
      pctByBand[k] = (usdByBand[k] / totalUsd) * 100
    }
  }

  // 7d delta: compare to last seen snapshot in-memory.
  const mem = getPmodeMemory()
  const prevPct = mem.lastPct
  mem.lastPct = pctByBand
  mem.lastAsOf = nowIso()

  const payload: MacroOracleRadarPayload = {
    asOf: nowIso(),
    mode: 'p',
    bands: bandsToPoints({ pctByBand, prevPctByBand: prevPct }),
    meta: {
      wallets: {
        evm: G_EVM_WALLET,
        sol: G_SOL_WALLET
      },
      usdByBand,
      totalUsd,
      dryPowder: {
        usd: usdByBand.R0,
        pctOfTotal: totalUsd > 0 ? (usdByBand.R0 / totalUsd) * 100 : 0
      },
      sources: sourceStatus,
      cache: {
        hit: cached.hit,
        stale: cached.stale,
        ttlSeconds: TTL_SECONDS
      }
    }
  }

  // store cache (even if zeros)
  await cacheSet(key, payload, TTL_SECONDS)
  return payload
}
