// lib/pmode/types.ts
// Shared types for P-mode (personal portfolio) analysis

export type PModeBandKey = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8'

export const P_BANDS = [
  { key: 'R1' as const, name: 'Cash Equiv.',   description: 'Stablecoins, T-bills, money market' },
  { key: 'R2' as const, name: 'Low Risk',      description: 'Staked ETH, lending receipts, bond funds' },
  { key: 'R3' as const, name: 'Core Equity',   description: 'Index funds, blue-chip DeFi governance' },
  { key: 'R4' as const, name: 'Hard Assets',   description: 'BTC, ETH, SOL, tokenized gold' },
  { key: 'R5' as const, name: 'Commodities',   description: 'L1/L2 tokens, infra, real commodities' },
  { key: 'R6' as const, name: 'Risk ON',       description: 'Mid-cap alts, high-beta equities' },
  { key: 'R7' as const, name: 'Venture',       description: 'Small caps, new tokens, startup equity' },
  { key: 'R8' as const, name: 'Trading',       description: 'Leveraged positions, perps, options' },
] as const

export type BandAllocation = Record<PModeBandKey, number> // USD values

export const ZERO_BANDS: BandAllocation = {
  R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, R6: 0, R7: 0, R8: 0,
}

export interface ClassifiedToken {
  symbol: string
  name: string
  chain: 'eth' | 'base' | 'solana'
  contractAddress?: string
  amount: number
  usdValue: number
  bandKey: PModeBandKey
}

export interface WalletChainResult {
  chain: 'eth' | 'base' | 'solana'
  address: string
  tokens: ClassifiedToken[]
  totalUsd: number
  fetchedAt: string
  error?: string
}
