// app/api/pmode/balances/route.ts
// Server-side proxy — keeps ALCHEMY key off client.
// Fetches EVM (ETH mainnet + Base) token balances via Alchemy,
// and Solana SPL balances via Helius.

import { NextRequest, NextResponse } from 'next/server'
import { classifyToken } from '@/lib/pmode/taxonomy'
import type { ClassifiedToken, WalletChainResult } from '@/lib/pmode/types'

export const runtime = 'nodejs'

function isoNow() { return new Date().toISOString() }

// ── Alchemy EVM helper ────────────────────────────────────────────────────

async function fetchAlchemyBalances(
  address: string,
  chainId: 'eth-mainnet' | 'base-mainnet',
  chain: 'eth' | 'base'
): Promise<WalletChainResult> {
  const apiKey = process.env.ALCHEMY_API_KEY
  if (!apiKey) {
    return { chain, address, tokens: [], totalUsd: 0, fetchedAt: isoNow(), error: 'ALCHEMY_API_KEY not configured' }
  }

  const rpcUrl = `https://${chainId}.g.alchemy.com/v2/${apiKey}`

  // 1. Native balance
  let nativeUsd = 0
  let nativeSymbol = chain === 'eth' ? 'ETH' : 'ETH'

  try {
    const nativeRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store'
    })
    if (nativeRes.ok) {
      const j = await nativeRes.json() as { result?: string }
      const wei = j.result ? BigInt(j.result) : 0n
      const ethAmount = Number(wei) / 1e18
      // Price: fetch from CoinGecko (best-effort, fire-and-forget; 0 on error)
      nativeUsd = await fetchEthPriceUsd() * ethAmount
    }
  } catch { /* ignore */ }

  // 2. ERC-20 token balances
  let erc20Tokens: ClassifiedToken[] = []
  try {
    const tokRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2,
        method: 'alchemy_getTokenBalances',
        params: [address, 'erc20']
      }),
      signal: AbortSignal.timeout(10000),
      cache: 'no-store'
    })

    if (tokRes.ok) {
      const j = await tokRes.json() as {
        result?: { tokenBalances?: Array<{ contractAddress: string; tokenBalance: string | null }> }
      }

      const nonZero = (j.result?.tokenBalances ?? []).filter(
        (t) => t.tokenBalance && t.tokenBalance !== '0x0000000000000000000000000000000000000000000000000000000000000000'
      )

      // Batch metadata + price via alchemy_getTokenMetadata
      const metaRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          nonZero.map((t, i) => ({
            jsonrpc: '2.0', id: i + 10,
            method: 'alchemy_getTokenMetadata',
            params: [t.contractAddress]
          }))
        ),
        signal: AbortSignal.timeout(10000),
        cache: 'no-store'
      })

      if (metaRes.ok) {
        const metaArr = await metaRes.json() as Array<{
          id: number
          result?: { symbol?: string; name?: string; decimals?: number }
        }>
        const metaById = Object.fromEntries(metaArr.map((m) => [m.id - 10, m.result]))

        // Fetch prices in one CoinGecko batch (contract addresses)
        const addresses = nonZero.map((t) => t.contractAddress.toLowerCase())
        const prices = await fetchErc20PricesUsd(addresses, chain)

        for (let idx = 0; idx < nonZero.length; idx++) {
          const tok = nonZero[idx]!
          const meta = metaById[idx]
          if (!meta?.symbol || !meta?.decimals) continue

          const raw = BigInt(tok.tokenBalance ?? '0')
          const amount = Number(raw) / 10 ** meta.decimals
          if (amount < 0.0001) continue

          const price = prices[tok.contractAddress.toLowerCase()] ?? 0
          const usdValue = amount * price
          if (usdValue < 0.01) continue

          erc20Tokens.push({
            symbol: meta.symbol,
            name: meta.name ?? meta.symbol,
            chain,
            contractAddress: tok.contractAddress.toLowerCase(),
            amount,
            usdValue,
            bandKey: classifyToken({ symbol: meta.symbol, chain, contractAddress: tok.contractAddress })
          })
        }
      }
    }
  } catch { /* ignore; degrade gracefully */ }

  const tokens: ClassifiedToken[] = []

  if (nativeUsd > 0.01) {
    tokens.push({
      symbol: nativeSymbol,
      name: nativeSymbol === 'ETH' ? 'Ethereum' : nativeSymbol,
      chain,
      amount: nativeUsd / Math.max(await fetchEthPriceUsd(), 1),
      usdValue: nativeUsd,
      bandKey: classifyToken({ symbol: nativeSymbol, chain })
    })
  }
  tokens.push(...erc20Tokens)

  const totalUsd = tokens.reduce((s, t) => s + t.usdValue, 0)
  return { chain, address, tokens, totalUsd, fetchedAt: isoNow() }
}

// ── Helius Solana helper ──────────────────────────────────────────────────

async function fetchSolanaBalances(address: string): Promise<WalletChainResult> {
  const apiKey = process.env.HELIUS_API_KEY
  if (!apiKey) {
    return { chain: 'solana', address, tokens: [], totalUsd: 0, fetchedAt: isoNow(), error: 'HELIUS_API_KEY not configured' }
  }

  try {
    // Helius enhanced transactions / balances API
    const res = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: address,
            page: 1, limit: 100,
            options: { showFungible: true, showNativeBalance: true }
          }
        }),
        signal: AbortSignal.timeout(10000),
        cache: 'no-store'
      }
    )

    if (!res.ok) {
      return { chain: 'solana', address, tokens: [], totalUsd: 0, fetchedAt: isoNow(), error: `Helius HTTP ${res.status}` }
    }

    const j = await res.json() as {
      result?: {
        nativeBalance?: { lamports?: number; price_per_sol?: number }
        items?: Array<{
          id: string
          token_info?: {
            symbol?: string
            name?: string
            balance?: number
            decimals?: number
            price_info?: { price_per_token?: number; currency?: string }
          }
          interface?: string
        }>
      }
    }

    const tokens: ClassifiedToken[] = []
    const result = j.result

    // Native SOL
    if (result?.nativeBalance) {
      const lamports = result.nativeBalance.lamports ?? 0
      const solAmount = lamports / 1e9
      const pricePerSol = result.nativeBalance.price_per_sol ?? 0
      const usdValue = solAmount * pricePerSol
      if (usdValue >= 0.01) {
        tokens.push({
          symbol: 'SOL', name: 'Solana', chain: 'solana',
          amount: solAmount, usdValue,
          bandKey: classifyToken({ symbol: 'SOL', chain: 'solana' })
        })
      }
    }

    // SPL tokens
    for (const item of result?.items ?? []) {
      const ti = item.token_info
      if (!ti?.symbol || !ti?.price_info?.price_per_token) continue
      const amount = (ti.balance ?? 0) / 10 ** (ti.decimals ?? 0)
      const usdValue = amount * ti.price_info.price_per_token
      if (usdValue < 0.01 || amount < 0.0001) continue

      tokens.push({
        symbol: ti.symbol,
        name: ti.name ?? ti.symbol,
        chain: 'solana',
        contractAddress: item.id,
        amount,
        usdValue,
        bandKey: classifyToken({ symbol: ti.symbol, chain: 'solana', contractAddress: item.id })
      })
    }

    const totalUsd = tokens.reduce((s, t) => s + t.usdValue, 0)
    return { chain: 'solana', address, tokens, totalUsd, fetchedAt: isoNow() }
  } catch (e) {
    return {
      chain: 'solana', address, tokens: [], totalUsd: 0,
      fetchedAt: isoNow(),
      error: e instanceof Error ? e.message : 'Unknown error'
    }
  }
}

// ── Price helpers ─────────────────────────────────────────────────────────

let _ethPrice: { price: number; ts: number } | null = null
async function fetchEthPriceUsd(): Promise<number> {
  if (_ethPrice && Date.now() - _ethPrice.ts < 60_000) return _ethPrice.price
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000), cache: 'no-store' }
    )
    if (res.ok) {
      const j = await res.json() as { ethereum?: { usd?: number } }
      const p = j.ethereum?.usd ?? 0
      _ethPrice = { price: p, ts: Date.now() }
      return p
    }
  } catch { /* ignore */ }
  return _ethPrice?.price ?? 2500
}

async function fetchErc20PricesUsd(
  addresses: string[],
  chain: 'eth' | 'base'
): Promise<Record<string, number>> {
  if (!addresses.length) return {}
  try {
    const platform = chain === 'base' ? 'base' : 'ethereum'
    const batch = addresses.slice(0, 50).join(',') // CG free tier limit
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${batch}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(8000), cache: 'no-store' }
    )
    if (res.ok) {
      const j = await res.json() as Record<string, { usd?: number }>
      return Object.fromEntries(
        Object.entries(j).map(([addr, v]) => [addr.toLowerCase(), v.usd ?? 0])
      )
    }
  } catch { /* ignore */ }
  return {}
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const address = url.searchParams.get('address')?.trim()
  const chains = (url.searchParams.get('chains') ?? 'eth,base,solana').split(',').map((s) => s.trim())

  if (!address) {
    return NextResponse.json({ error: 'address param required' }, { status: 400 })
  }

  const results = await Promise.all([
    chains.includes('eth')    ? fetchAlchemyBalances(address, 'eth-mainnet', 'eth') : null,
    chains.includes('base')   ? fetchAlchemyBalances(address, 'base-mainnet', 'base') : null,
    chains.includes('solana') ? fetchSolanaBalances(address) : null,
  ])

  return NextResponse.json({
    address,
    chains: results.filter(Boolean),
    fetchedAt: isoNow()
  })
}
