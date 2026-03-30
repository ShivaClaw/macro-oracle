/**
 * P-mode (Personal Portfolio) data fetcher
 *
 * Required Vercel env vars:
 *   HELIUS_API_KEY      - Helius RPC key for Solana token data
 *
 * Free APIs (no key needed):
 *   Ethplorer           - Ethereum + ERC20 balances (freekey tier)
 *   Solana mainnet RPC  - Native SOL balance
 *   Hyperliquid         - Perp account state
 *
 * Wallet addresses are hardcoded but can be moved to env vars:
 *   ETH_WALLET_ADDRESS  - EVM wallet (Ethereum + Base)
 *   SOL_WALLET_ADDRESS  - Solana wallet
 */

import type { FlowDirection, MacroOracleRadarPayload, RiskBandPoint } from '../../components/charts/MacroOracleRadar/types';
import { classifyToken, classifyProtocolPosition } from '../config/tokenClassification';

const ETH_ADDRESS = process.env.ETH_WALLET_ADDRESS ?? '0x27B968f509f54fE6B9b247044C69e6634010D5a8';
const SOL_ADDRESS = process.env.SOL_WALLET_ADDRESS ?? 'ERzA234UwbioGbnK9bS5P4q5ZeTYFkEzPAuiqgzgUq9K';
const HELIUS_KEY  = process.env.HELIUS_API_KEY ?? '409fa16c-3d80-42e7-9fde-df9d037c59ac';

const CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry = { data: MacroOracleRadarPayload; fetchedAt: number };
let cache: CacheEntry | null = null;
let prevSnapshot: Record<string, number> | null = null;

// ── Band metadata ──────────────────────────────────────────────────────────

const BAND_META: Record<string, { label: string; name: string }> = {
  R1: { label: 'RISK 1', name: 'Cash Equiv.'  },
  R2: { label: 'RISK 2', name: 'Low Risk'     },
  R3: { label: 'RISK 3', name: 'Core Equity'  },
  R4: { label: 'RISK 4', name: 'Hard Assets'  },
  R5: { label: 'RISK 5', name: 'Commodities'  },
  R6: { label: 'RISK 6', name: 'Risk ON'      },
  R7: { label: 'RISK 7', name: 'Venture'      },
  R8: { label: 'RISK 8', name: 'Trading'      },
};

// ── Fetchers ───────────────────────────────────────────────────────────────

async function fetchEthplorerBalances(): Promise<Record<string, number>> {
  const bands: Record<string, number> = {};
  try {
    const res = await fetch(
      `https://api.ethplorer.io/getAddressInfo/${ETH_ADDRESS}?apiKey=freekey`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return bands;
    const data = await res.json() as any;

    // Native ETH
    const ethBal  = Number(data?.ETH?.balance ?? 0);
    const ethRate = Number(data?.ETH?.price?.rate ?? 0);
    const ethUsd  = ethBal * ethRate;
    if (ethUsd > 0) {
      const band = classifyToken('ETH', '');
      bands[band] = (bands[band] ?? 0) + ethUsd;
    }

    // ERC20 tokens
    for (const t of (data?.tokens ?? [])) {
      const info    = t.tokenInfo ?? {};
      const symbol  = String(info.symbol ?? '');
      const address = String(info.address ?? '');
      const decimals = Number(info.decimals ?? 18);
      const bal     = Number(t.balance ?? 0) / Math.pow(10, decimals);
      const rate    = typeof info.price === 'object' ? Number(info.price?.rate ?? 0) : 0;
      const usd     = bal * rate;
      if (usd < 0.01) continue;
      const band = classifyToken(symbol.toUpperCase(), address.toLowerCase());
      bands[band] = (bands[band] ?? 0) + usd;
    }
  } catch { /* fall through */ }
  return bands;
}

async function fetchHeliusBalances(): Promise<Record<string, number>> {
  const bands: Record<string, number> = {};
  try {
    const res = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: SOL_ADDRESS,
            page: 1, limit: 100,
            displayOptions: { showFungible: true, showNativeBalance: true }
          }
        }),
        signal: AbortSignal.timeout(8000)
      }
    );
    if (!res.ok) return bands;
    const data = await res.json() as any;
    const result = data?.result ?? {};

    // Native SOL
    const solLamports = Number(result?.nativeBalance?.lamports ?? 0);
    const solUsd      = Number(result?.nativeBalance?.total_price ?? 0);
    if (solUsd > 0.01) {
      const band = classifyToken('SOL', '');
      bands[band] = (bands[band] ?? 0) + solUsd;
    }
    void solLamports;

    // SPL tokens
    for (const item of (result?.items ?? [])) {
      if (item?.interface !== 'FungibleToken') continue;
      const info    = item?.token_info ?? {};
      const symbol  = String(info.symbol ?? '').toUpperCase();
      const address = String(item?.id ?? '');
      const usd     = Number(info?.price_info?.total_price ?? 0);
      if (usd < 0.01) continue;
      const band = classifyToken(symbol, address);
      bands[band] = (bands[band] ?? 0) + usd;
    }
  } catch { /* fall through */ }
  return bands;
}

async function fetchHyperliquidR8(): Promise<number> {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: ETH_ADDRESS }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return 0;
    const data = await res.json() as any;
    return Number(data?.marginSummary?.accountValue ?? 0);
  } catch { return 0; }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function getPmodeRadarPayload(): Promise<MacroOracleRadarPayload> {
  const now = Date.now();
  if (cache && (now - cache.fetchedAt) < CACHE_TTL_MS) return cache.data;

  const warnings: string[] = [];

  // Fetch all sources in parallel
  const [ethBands, solBands, r8Usd] = await Promise.all([
    fetchEthplorerBalances(),
    fetchHeliusBalances(),
    fetchHyperliquidR8(),
  ]);

  // Merge band USD values
  const rawBands: Record<string, number> = {};
  for (const [band, usd] of Object.entries(ethBands)) {
    rawBands[band] = (rawBands[band] ?? 0) + usd;
  }
  for (const [band, usd] of Object.entries(solBands)) {
    rawBands[band] = (rawBands[band] ?? 0) + usd;
  }
  rawBands['R8'] = (rawBands['R8'] ?? 0) + r8Usd;

  // Total portfolio value (all bands incl. R0)
  const total = Object.values(rawBands).reduce((a, b) => a + b, 0);
  const r0Usd = rawBands['R0'] ?? 0;

  if (total < 0.01) warnings.push('Total portfolio value near zero — wallet may be empty');

  // Convert to percentages (R1–R8 as radar axes; R0 in meta)
  const pctBands: Record<string, number> = {};
  for (const [band, usd] of Object.entries(rawBands)) {
    pctBands[band] = total > 0 ? (usd / total) * 100 : 0;
  }

  // Build 7d deltas from previous snapshot
  const snapshot = { ...pctBands };
  const computeDelta = (key: string): number | undefined => {
    if (!prevSnapshot) return undefined;
    return (pctBands[key] ?? 0) - (prevSnapshot[key] ?? 0);
  };
  const flowDir = (key: string): FlowDirection => {
    const d = computeDelta(key);
    if (d == null) return 'neutral';
    if (d > 0.5)  return 'inflow';
    if (d < -0.5) return 'outflow';
    return 'neutral';
  };

  // Build R1–R8 band array
  const radarKeys = ['R1','R2','R3','R4','R5','R6','R7','R8'];
  const bands: RiskBandPoint[] = radarKeys.map((key) => {
    const meta = BAND_META[key]!;
    const valueNow  = pctBands[key] ?? 0;
    const delta7d   = computeDelta(key);
    const prev7d    = prevSnapshot ? (prevSnapshot[key] ?? 0) : undefined;
    return {
      key,
      label: meta.label,
      name:  meta.name,
      valueNow: Math.round(valueNow * 10) / 10,
      value7dAgo: prev7d != null ? Math.round(prev7d * 10) / 10 : undefined,
      delta7d: delta7d != null ? Math.round(delta7d * 10) / 10 : undefined,
      flowDirection: flowDir(key),
    };
  });

  prevSnapshot = snapshot;

  const payload: MacroOracleRadarPayload = {
    asOf: new Date().toISOString(),
    mode: 'p',
    bands,
    meta: {
      source: 'live',
      r0DryPowderUsd: Math.round(r0Usd * 100) / 100,
      r0DryPowderPct: total > 0 ? Math.round((r0Usd / total) * 1000) / 10 : 0,
      totalPortfolioUsd: Math.round(total * 100) / 100,
      warnings: warnings.length ? warnings : undefined,
    },
  };

  cache = { data: payload, fetchedAt: now };
  return payload;
}
