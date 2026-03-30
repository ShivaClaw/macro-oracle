// hooks/usePortfolio.ts
// State machine: wallet → on-chain fetch → manual overlay → radar payload

'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { classifyToken } from '@/lib/pmode/taxonomy'
import type { BandAllocation, ClassifiedToken, WalletChainResult, PModeBandKey } from '@/lib/pmode/types'
import { ZERO_BANDS } from '@/lib/pmode/types'
import type { ConnectedWallet } from '@/components/pmode/WalletBar'
import type { MacroOracleRadarPayload, RiskBandPoint } from '@/components/charts/MacroOracleRadar/types'

export type PortfolioStatus = 'idle' | 'fetching' | 'ready' | 'error'

type State = {
  status: PortfolioStatus
  wallet: ConnectedWallet | null
  chainResults: WalletChainResult[]
  manualAlloc: BandAllocation
  error: string | null
  lastFetch: Date | null
}

type Action =
  | { type: 'SET_WALLET'; wallet: ConnectedWallet | null }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_DONE'; results: WalletChainResult[] }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'SET_MANUAL'; alloc: BandAllocation }
  | { type: 'RESET' }

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'SET_WALLET':   return { ...s, wallet: a.wallet, chainResults: [], status: 'idle', error: null }
    case 'FETCH_START':  return { ...s, status: 'fetching', error: null }
    case 'FETCH_DONE':   return { ...s, status: 'ready', chainResults: a.results, lastFetch: new Date() }
    case 'FETCH_ERROR':  return { ...s, status: 'error', error: a.error }
    case 'SET_MANUAL':   return { ...s, manualAlloc: a.alloc }
    case 'RESET':        return initialState
    default:             return s
  }
}

const initialState: State = {
  status: 'idle',
  wallet: null,
  chainResults: [],
  manualAlloc: { ...ZERO_BANDS },
  error: null,
  lastFetch: null,
}

// ── Token list → BandAllocation ───────────────────────────────────────────

function tokensToBands(tokens: ClassifiedToken[]): BandAllocation {
  const alloc = { ...ZERO_BANDS }
  for (const t of tokens) {
    alloc[t.bandKey] = (alloc[t.bandKey] ?? 0) + t.usdValue
  }
  return alloc
}

function mergeBands(a: BandAllocation, b: BandAllocation): BandAllocation {
  const out = { ...ZERO_BANDS }
  for (const k of Object.keys(out) as PModeBandKey[]) {
    out[k] = (a[k] ?? 0) + (b[k] ?? 0)
  }
  return out
}

// ── Band allocation → MacroOracleRadarPayload ─────────────────────────────

const P_BAND_DEFS: Array<{ key: PModeBandKey; name: string }> = [
  { key: 'R1', name: 'Cash Equiv.' },
  { key: 'R2', name: 'Low Risk' },
  { key: 'R3', name: 'Core Equity' },
  { key: 'R4', name: 'Hard Assets' },
  { key: 'R5', name: 'Commodities' },
  { key: 'R6', name: 'Risk ON' },
  { key: 'R7', name: 'Venture' },
  { key: 'R8', name: 'Trading' },
]

export function bandAllocToRadarPayload(
  alloc: BandAllocation,
  prevAlloc?: BandAllocation
): MacroOracleRadarPayload {
  const total = Object.values(alloc).reduce((s, v) => s + v, 0)
  const totalPrev = prevAlloc ? Object.values(prevAlloc).reduce((s, v) => s + v, 0) : 0
  const denom     = total     > 0 ? total     : 1
  const denomPrev = totalPrev > 0 ? totalPrev : 1

  const bands: RiskBandPoint[] = P_BAND_DEFS
    .filter((b) => alloc[b.key] > 0 || (prevAlloc && (prevAlloc[b.key] ?? 0) > 0))
    .map((b) => {
      const valueNow    = Number(((alloc[b.key] / denom) * 100).toFixed(2))
      const value7dAgo  = prevAlloc
        ? Number((((prevAlloc[b.key] ?? 0) / denomPrev) * 100).toFixed(2))
        : undefined
      const delta7d     = value7dAgo != null ? Number((valueNow - value7dAgo).toFixed(2)) : undefined
      return {
        key: b.key,
        label: b.key,
        name: b.name,
        valueNow,
        ...(value7dAgo != null && { value7dAgo, delta7d })
      }
    })

  return {
    asOf: new Date().toISOString(),
    mode: 'p',
    bands,
    meta: {
      source: 'wallet',
      totalUsd: total,
      bandUsd: Object.fromEntries(P_BAND_DEFS.map((b) => [b.key, alloc[b.key]]))
    }
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function usePortfolio() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const abortRef = useRef<AbortController | null>(null)

  // ── Fetch on-chain balances ─────────────────────────────────────────────
  const fetchChains = useCallback(async (wallet: ConnectedWallet) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    dispatch({ type: 'FETCH_START' })

    try {
      const params: string[] = []
      const chains: string[] = []

      if (wallet.evmAddress) {
        params.push(`address=${encodeURIComponent(wallet.evmAddress)}`)
        chains.push('eth', 'base')
      }
      if (wallet.solanaAddress) {
        // For Phantom: pass solana address; API route handles per-chain dispatch
        params.push(`solanaAddress=${encodeURIComponent(wallet.solanaAddress)}`)
        chains.push('solana')
      }
      params.push(`chains=${chains.join(',')}`)

      // Use the EVM address if present, else solana (API route normalises)
      const address = wallet.evmAddress ?? wallet.solanaAddress ?? ''
      const url = `/api/pmode/balances?address=${encodeURIComponent(address)}&chains=${chains.join(',')}`
        + (wallet.solanaAddress && !wallet.evmAddress ? `&solanaAddress=${encodeURIComponent(wallet.solanaAddress)}` : '')

      const res = await fetch(url, { signal: ac.signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json() as { chains: WalletChainResult[] }
      dispatch({ type: 'FETCH_DONE', results: data.chains ?? [] })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      dispatch({ type: 'FETCH_ERROR', error: e instanceof Error ? e.message : 'Fetch failed' })
    }
  }, [])

  // Persist/restore manual alloc from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pmode_manual_alloc')
      if (saved) {
        const parsed = JSON.parse(saved) as BandAllocation
        dispatch({ type: 'SET_MANUAL', alloc: parsed })
      }
    } catch { /* ignore */ }
  }, [])

  const setManual = useCallback((alloc: BandAllocation) => {
    dispatch({ type: 'SET_MANUAL', alloc })
    try { localStorage.setItem('pmode_manual_alloc', JSON.stringify(alloc)) } catch { /* ignore */ }
  }, [])

  const connect = useCallback((wallet: ConnectedWallet) => {
    dispatch({ type: 'SET_WALLET', wallet })
    fetchChains(wallet)
  }, [fetchChains])

  const disconnect = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: 'RESET' })
  }, [])

  const refresh = useCallback(() => {
    if (state.wallet) fetchChains(state.wallet)
  }, [state.wallet, fetchChains])

  // ── Derived: merged allocation ────────────────────────────────────────
  const allTokens = state.chainResults.flatMap((r) => r.tokens)
  const onChainAlloc = tokensToBands(allTokens)
  const mergedAlloc = mergeBands(onChainAlloc, state.manualAlloc)
  const radarPayload = bandAllocToRadarPayload(mergedAlloc)
  const totalUsd = Object.values(mergedAlloc).reduce((s, v) => s + v, 0)

  return {
    // state
    status: state.status,
    wallet: state.wallet,
    chainResults: state.chainResults,
    manualAlloc: state.manualAlloc,
    error: state.error,
    lastFetch: state.lastFetch,
    // derived
    onChainAlloc,
    mergedAlloc,
    radarPayload,
    totalUsd,
    allTokens,
    // actions
    connect,
    disconnect,
    setManual,
    refresh,
  }
}
