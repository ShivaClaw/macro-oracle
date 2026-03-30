// lib/pmode/taxonomy.ts
// Token → P-mode band classification

import type { PModeBandKey } from './types'

// ── Exact symbol overrides (highest priority) ────────────────────────────

const SYMBOL_MAP: Record<string, PModeBandKey> = {
  // R1 — Cash / Stables
  USDC: 'R1', USDT: 'R1', DAI: 'R1', FRAX: 'R1', PYUSD: 'R1',
  TUSD: 'R1', LUSD: 'R1', SUSD: 'R1', CRVUSD: 'R1', USDE: 'R1',
  USDS: 'R1', FDUSD: 'R1', GUSD: 'R1', USDP: 'R1', BUSD: 'R1',
  CUSD: 'R1', MUSD: 'R1', ZUSD: 'R1', HUSD: 'R1',

  // R2 — Low Risk / Yield-bearing
  STETH:  'R2', WSTETH: 'R2', RETH:   'R2', CBETH: 'R2', SFRXETH: 'R2',
  FRXETH: 'R2', ANKRETH: 'R2', SWETH: 'R2', METH:  'R2', OSETH: 'R2',
  WEETH:  'R2', EZETH:  'R2', RSETH:  'R2', PUFETH: 'R2',
  // Lending receipt tokens
  AUSDC: 'R2', AUSDT: 'R2', ADAI: 'R2', AWETH: 'R2', AWBTC: 'R2',
  CUSDC: 'R2', CDAI:  'R2', CUSDT: 'R2', CWBTC: 'R2', CETH: 'R2',

  // R3 — Core Equity / Blue-chip DeFi gov
  AAVE: 'R3', COMP: 'R3', MKR: 'R3', SNX:  'R3',

  // R4 — Hard Assets (L1s, digital gold)
  ETH:  'R4', WETH: 'R4', BTC:  'R4', WBTC: 'R4', TBTC: 'R4',
  SOL:  'R4', WSOL: 'R4',
  PAXG: 'R4', XAUT: 'R4',  // tokenised gold

  // R5 — Commodities / L1+L2 infra
  BNB:  'R5', AVAX: 'R5', MATIC: 'R5', POL:  'R5', FTM:  'R5',
  NEAR: 'R5', APT:  'R5', SUI:   'R5', SEI:  'R5', INJ:  'R5',
  TON:  'R5', TRX:  'R5', ADA:   'R5', DOT:  'R5', ATOM: 'R5',
  LINK: 'R5', GRT:  'R5', LDO:   'R5', RPL:  'R5',

  // R6 — Risk ON (mid-cap alts, high-beta)
  OP:   'R6', ARB:  'R6', UNI:   'R6', CRV:  'R6', CVX:  'R6',
  BAL:  'R6', SUSHI:'R6', '1INCH':'R6', ZRX:  'R6', ENS:  'R6',
  WLD:  'R6', APE:  'R6', IMX:   'R6', BLUR: 'R6', DYDX: 'R6',
  GMX:  'R6', PERP: 'R6', RDNT:  'R6', PENDLE:'R6',
  JUP:  'R6', RAY:  'R6', ORCA:  'R6', MNGO: 'R6',
  HYP:  'R6', HYPE: 'R6',

  // R7 — Venture (small caps, memes, new tokens)
  PEPE: 'R7', SHIB: 'R7', DOGE: 'R7', FLOKI: 'R7', BONK: 'R7',
  WIF:  'R7', BOME: 'R7', POPCAT:'R7', MEW:  'R7', BRETT:'R7',
  TURBO:'R7', MOG:  'R7',

  // R8 — Trading (leveraged / derivative tokens)
  'ETH2X-FLI': 'R8', 'BTC2X-FLI': 'R8',
  ETHBULL: 'R8', ETHBEAR: 'R8', BTCBULL: 'R8', BTCBEAR: 'R8',
}

// ── Known ERC-20 contract overrides (Ethereum mainnet) ────────────────────
// Maps lowercase contract address → band key

const EVM_CONTRACT_MAP: Record<string, PModeBandKey> = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'R1', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'R1', // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'R1', // DAI
  '0x853d955acef822db058eb8505911ed77f175b99e': 'R1', // FRAX
  '0xae78736cd615f374d3085123a210448e74fc6393': 'R2', // rETH
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 'R2', // wstETH
  '0xbe9895146f7af43049ca1c1ae358b0541ea49704': 'R2', // cbETH
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'R4', // WBTC
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'R4', // WETH
  '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': 'R5', // MATIC/POL
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'R5', // LINK
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'R6', // UNI
  '0xd533a949740bb3306d119cc777fa900ba034cd52': 'R6', // CRV
  '0xc944e90c64b2c07662a292be6244bdf05cda44a7': 'R5', // GRT
}

// ── Base chain contract overrides ────────────────────────────────────────

const BASE_CONTRACT_MAP: Record<string, PModeBandKey> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'R1', // USDC on Base
  '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'R1', // DAI on Base
  '0x4200000000000000000000000000000000000006': 'R4', // WETH on Base
  '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 'R2', // cbETH on Base
  '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': 'R2', // wstETH on Base
}

// ── Fallback heuristics by symbol substring ──────────────────────────────

function heuristicBand(symbol: string): PModeBandKey {
  const s = symbol.toUpperCase()

  // Stable patterns
  if (/USD[CTBP]?$|DAI$|FRAX$|USDS$/.test(s)) return 'R1'
  // Liquid staking
  if (/^(ST|W?ST|R|CB|FR|ANKR|SW|O|M|E?Z|PUF)ETH$/.test(s) || s.endsWith('ETH') && s.length <= 8) return 'R2'
  // Leveraged / inverse
  if (/BULL|BEAR|2X|3X|SHORT|LONG|-FLI$/.test(s)) return 'R8'
  // Meme pattern — all-caps ≤ 5 chars that aren't known majors
  if (/^[A-Z]{3,5}$/.test(s) && !['USDC','USDT','LINK','AAVE','COMP'].includes(s)) return 'R7'

  // Default to R6 for everything else we can't classify
  return 'R6'
}

// ── Public classifier ─────────────────────────────────────────────────────

export function classifyToken(opts: {
  symbol: string
  chain: 'eth' | 'base' | 'solana'
  contractAddress?: string
}): PModeBandKey {
  const { symbol, chain, contractAddress } = opts
  const sym = symbol.toUpperCase().trim()

  // 1. Contract-level exact match
  if (contractAddress) {
    const addr = contractAddress.toLowerCase()
    if (chain === 'eth' && EVM_CONTRACT_MAP[addr]) return EVM_CONTRACT_MAP[addr]!
    if (chain === 'base' && BASE_CONTRACT_MAP[addr]) return BASE_CONTRACT_MAP[addr]!
  }

  // 2. Symbol exact match
  if (SYMBOL_MAP[sym]) return SYMBOL_MAP[sym]!

  // 3. Heuristic fallback
  return heuristicBand(sym)
}
