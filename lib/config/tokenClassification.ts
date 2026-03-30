/**
 * tokenClassification.ts
 *
 * P-mode classification helpers.
 *
 * This is intentionally pragmatic: we classify by symbol/address + a few
 * heuristics on protocol position metadata.
 */

export type PRiskBandKey =
  | 'R0'
  | 'R1'
  | 'R2'
  | 'R3'
  | 'R4'
  | 'R5'
  | 'R6'
  | 'R7'
  | 'R8'

export const P_RISK_BANDS: Array<{ key: PRiskBandKey; label: string; name: string }> = [
  { key: 'R0', label: 'RISK 0', name: 'Dry Powder' },
  { key: 'R1', label: 'RISK 1', name: 'Cash Equiv.' },
  { key: 'R2', label: 'RISK 2', name: 'Low Risk' },
  { key: 'R3', label: 'RISK 3', name: 'Core Equity' },
  { key: 'R4', label: 'RISK 4', name: 'Hard Assets' },
  { key: 'R5', label: 'RISK 5', name: 'Commodities' },
  { key: 'R6', label: 'RISK 6', name: 'Risk ON' },
  { key: 'R7', label: 'RISK 7', name: 'Venture' },
  { key: 'R8', label: 'RISK 8', name: 'Trading' }
]

const SYMBOL_TO_BAND: Record<string, PRiskBandKey> = {
  // Dry powder stables (spot)
  USDC: 'R0',
  USDT: 'R0',
  DAI: 'R0',

  // Yield-bearing stables / cash equiv
  SDAI: 'R1',

  // Core equity (blue-chip crypto)
  ETH: 'R3',
  WETH: 'R3',
  STETH: 'R3',
  RETH: 'R3',
  UNI: 'R3',
  AAVE: 'R3',
  CRV: 'R3',
  LDO: 'R3',

  // Hard assets
  BTC: 'R4',
  WBTC: 'R4',
  TBTC: 'R4',
  PAXG: 'R4',

  // Risk-on majors + alts
  SOL: 'R6',
  SUI: 'R6',
  AVAX: 'R6',
  HYPE: 'R6'
}

export function classifySpotToken(opts: {
  symbol?: string | null
  address?: string | null
  chain?: string | null
}): PRiskBandKey {
  const sym = (opts.symbol ?? '').trim().toUpperCase()
  if (sym && SYMBOL_TO_BAND[sym]) return SYMBOL_TO_BAND[sym]!

  // address-based hooks (EVM)
  const addr = (opts.address ?? '').trim().toLowerCase()
  if (addr) {
    // WETH on Ethereum/Base (common canonical addresses)
    if (addr === '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase()) return 'R3'
    if (addr === '0x4200000000000000000000000000000000000006'.toLowerCase()) return 'R3' // Base WETH
  }

  // chain heuristic
  const chain = (opts.chain ?? '').toLowerCase()
  if (chain === 'solana') return 'R6'

  // default: risk-on (alts)
  return 'R6'
}

export function classifyProtocolPosition(opts: {
  protocolName?: string | null
  positionName?: string | null
  category?: string | null
  underlyingSymbols?: string[]
}): PRiskBandKey {
  const cat = (opts.category ?? '').toLowerCase()

  // lending / money markets
  if (cat.includes('lending') || cat.includes('borrow') || cat.includes('money market')) {
    // treat as cash equiv unless non-stable underlyings are detected
    const und = (opts.underlyingSymbols ?? []).map((s) => s.toUpperCase())
    const allStable = und.length > 0 && und.every((s) => s === 'USDC' || s === 'USDT' || s === 'DAI')
    return allStable ? 'R1' : 'R2'
  }

  // LP / dex / farm
  if (cat.includes('dex') || cat.includes('lp') || cat.includes('farm') || cat.includes('amm')) {
    return 'R2'
  }

  // vesting / locked
  const pname = `${opts.protocolName ?? ''} ${opts.positionName ?? ''}`.toLowerCase()
  if (pname.includes('vesting') || pname.includes('locked') || pname.includes('lock')) return 'R7'

  return 'R2'
}
