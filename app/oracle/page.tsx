'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import MacroOracleRadar, {
  type MacroOracleRadarPayload,
  type MacroOracleMode,
} from '../components/MacroOracleRadar'
import WalletBar, { type ConnectedWallet } from '../components/pmode/WalletBar'
import ManualEntry from '../components/pmode/ManualEntry'
import { usePortfolio } from '../hooks/usePortfolio'
import type { BandAllocation, PModeBandKey } from '../lib/pmode/types'
import type { ClassifiedToken, WalletChainResult } from '../lib/pmode/types'

// ── G-mode fetch (unchanged from before) ──────────────────────────────────

const MOCK_G: MacroOracleRadarPayload = {
  asOf: new Date().toISOString(),
  mode: 'g',
  bands: [
    { key: 'R1', label: 'R1', name: '$',                 valueNow: 22.1, value7dAgo: 20.4, flowDirection: 'inflow'  },
    { key: 'R3', label: 'R3', name: 'Core Equity',       valueNow: 18.6, value7dAgo: 19.8, flowDirection: 'outflow' },
    { key: 'R5', label: 'R5', name: 'Vital Commodities', valueNow: 12.4, value7dAgo: 11.9, flowDirection: 'inflow'  },
    { key: 'R6', label: 'R6', name: 'Risk ON',           valueNow:  9.2, value7dAgo: 11.5, flowDirection: 'outflow' },
    { key: 'R4', label: 'R4', name: 'Risk OFF',          valueNow: 16.8, value7dAgo: 16.6, flowDirection: 'neutral' },
    { key: 'R2', label: 'R2', name: 'Low Risk',          valueNow:  8.3, value7dAgo:  7.1, flowDirection: 'inflow'  },
  ],
  meta: {
    source: 'mock', totalTrackedUsd: 1.35e14,
    bucketsNowUsd:    { R1: 2.98e13, R2: 1.12e10, R3: 2.51e13, R4: 2.27e13, R5: 1.67e10, R6: 1.24e10 },
    buckets7dAgoUsd:  { R1: 2.75e13, R2: 1.05e10, R3: 2.67e13, R4: 2.24e13, R5: 1.61e10, R6: 1.55e10 },
    bucketsYtdAgoUsd: { R1: 2.60e13, R2: 9.5e9,   R3: 2.45e13, R4: 2.10e13, R5: 1.50e10, R6: 1.20e10 },
  }
}

async function fetchGModePayload(signal?: AbortSignal): Promise<MacroOracleRadarPayload> {
  const res = await fetch('/api/oracle-data/radar?mode=g', { signal, cache: 'no-store', headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function fmtUsd(v: number | undefined | null, compact = false): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v), sign = v < 0 ? '−' : ''
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(compact ? 1 : 2)}T`
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(compact ? 1 : 1)}B`
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(compact ? 1 : 1)}M`
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(compact ? 0 : 1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function fmtDelta(now: number, prev: number): { text: string; pos: boolean | null } {
  if (!prev) return { text: '—', pos: null }
  const d = now - prev
  const pct = (d / prev) * 100
  const sign = d >= 0 ? '+' : '−'
  return { text: `${sign}${fmtUsd(Math.abs(d), true)} (${sign}${Math.abs(pct).toFixed(1)}%)`, pos: d >= 0 }
}

type DataStatus = 'idle' | 'loading' | 'live' | 'error'

function StatusDot({ status }: { status: DataStatus }) {
  const color = status === 'live' ? '#22c55e' : status === 'loading' ? '#facc15' : status === 'idle' ? '#6F738A' : '#f87171'
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

// ── G-mode allocation table (unchanged) ──────────────────────────────────

const G_BAND_ORDER = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] as const

function GAllocationTable({ payload }: { payload: MacroOracleRadarPayload }) {
  const meta = payload.meta as Record<string, unknown> | undefined
  const nowMap  = meta?.bucketsNowUsd    as Record<string, number> | undefined
  const d7Map   = meta?.buckets7dAgoUsd  as Record<string, number> | undefined
  const ytdMap  = meta?.bucketsYtdAgoUsd as Record<string, number> | undefined

  const rows = useMemo(() => {
    const bm = Object.fromEntries(payload.bands.map((b) => [b.key, b]))
    return G_BAND_ORDER.filter((k) => bm[k]).map((k) => {
      const band = bm[k]!
      const now = nowMap?.[k], prev7 = d7Map?.[k], prevYtd = ytdMap?.[k]
      return {
        band,
        nowUsd: now,
        flow7d:  now != null && prev7   != null ? fmtDelta(now, prev7)  : null,
        flowYtd: now != null && prevYtd != null ? fmtDelta(now, prevYtd) : null,
      }
    })
  }, [payload, nowMap, d7Map, ytdMap])

  const fc = (pos: boolean | null) => pos === null ? 'var(--muted)' : pos ? '#1FE091' : '#FF5E5B'
  const fi = (pos: boolean | null) => pos === null ? '' : pos ? '▲' : '▼'

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--muted)', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {['Sector','Market Cap','7d Flow','YTD Flow'].map((h) => (
              <th key={h} style={{ textAlign: h === 'Sector' ? 'left' : 'right', paddingBottom: 8, paddingRight: h !== 'YTD Flow' ? 14 : 0, fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ band, nowUsd, flow7d, flowYtd }) => (
            <tr key={band.key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <td style={{ paddingTop: 8, paddingBottom: 8, paddingRight: 14 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: band.flowDirection === 'inflow' ? '#1FE091' : band.flowDirection === 'outflow' ? '#FF5E5B' : '#6F738A' }} />
                  <span style={{ color: 'var(--fg0)', fontWeight: 500 }}>{band.name ?? band.key}</span>
                </span>
              </td>
              <td style={{ textAlign: 'right', paddingRight: 14, paddingTop: 8, paddingBottom: 8, color: 'var(--fg1)' }}>{fmtUsd(nowUsd)}</td>
              {[flow7d, flowYtd].map((f, i) => (
                <td key={i} style={{ textAlign: 'right', paddingRight: i === 0 ? 14 : 0, paddingTop: 8, paddingBottom: 8 }}>
                  {f ? <span style={{ color: fc(f.pos) }}>{fi(f.pos)}&nbsp;{f.text}</span> : <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── P-mode: token breakdown table ─────────────────────────────────────────

function TokenTable({ tokens, chainResults }: { tokens: ClassifiedToken[]; chainResults: WalletChainResult[] }) {
  const [expanded, setExpanded] = useState(false)
  const sorted = [...tokens].sort((a, b) => b.usdValue - a.usdValue)
  const displayed = expanded ? sorted : sorted.slice(0, 8)
  const chainErrors = chainResults.filter((r) => r.error)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {chainErrors.map((r) => (
        <div key={r.chain} style={{ fontSize: 11, color: '#FF5E5B', background: 'rgba(255,94,91,0.08)', borderRadius: 6, padding: '5px 10px' }}>
          {r.chain}: {r.error}
        </div>
      ))}
      {tokens.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>No token balances found across ETH, Base, Solana.</p>
      )}
      {tokens.length > 0 && (
        <>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Token','Chain','Band','Value'].map((h) => (
                  <th key={h} style={{ textAlign: h === 'Value' ? 'right' : 'left', paddingBottom: 6, paddingRight: h !== 'Value' ? 12 : 0, fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((t, i) => (
                <tr key={`${t.chain}-${t.symbol}-${i}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ paddingTop: 6, paddingBottom: 6, paddingRight: 12 }}>
                    <span style={{ fontWeight: 500, color: 'var(--fg0)' }}>{t.symbol}</span>
                    {t.name !== t.symbol && <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 5 }}>{t.name}</span>}
                  </td>
                  <td style={{ paddingRight: 12, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 10 }}>{t.chain}</td>
                  <td style={{ paddingRight: 12, color: 'var(--fg1)', fontSize: 11 }}>{t.bandKey}</td>
                  <td style={{ textAlign: 'right', color: 'var(--fg1)' }}>{fmtUsd(t.usdValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tokens.length > 8 && (
            <button onClick={() => setExpanded((v) => !v)} style={{ ...miniBtnStyle, alignSelf: 'flex-start' }}>
              {expanded ? `▲ Show less` : `▼ Show all ${tokens.length} tokens`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── P-mode: band allocation summary ───────────────────────────────────────

function PModeAllocationTable({ alloc, totalUsd }: { alloc: BandAllocation; totalUsd: number }) {
  const meta = { bandUsd: alloc }
  const bands: Array<{ key: PModeBandKey; name: string }> = [
    { key: 'R1', name: 'Cash Equiv.' }, { key: 'R2', name: 'Low Risk' },
    { key: 'R3', name: 'Core Equity' }, { key: 'R4', name: 'Hard Assets' },
    { key: 'R5', name: 'Commodities' }, { key: 'R6', name: 'Risk ON' },
    { key: 'R7', name: 'Venture' },     { key: 'R8', name: 'Trading' },
  ]
  const denom = totalUsd > 0 ? totalUsd : 1

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--muted)', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {['Band', 'USD Value', '% Alloc', 'Bar'].map((h) => (
              <th key={h} style={{ textAlign: h === 'Band' ? 'left' : 'right', paddingBottom: 8, paddingRight: 12, fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bands.filter((b) => alloc[b.key] > 0).map((b) => {
            const usd = alloc[b.key]
            const pct = (usd / denom) * 100
            return (
              <tr key={b.key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ paddingTop: 7, paddingBottom: 7, paddingRight: 12, color: 'var(--fg0)', fontWeight: 500 }}>
                  <span style={{ color: 'var(--muted)', fontSize: 11, marginRight: 6 }}>{b.key}</span>{b.name}
                </td>
                <td style={{ textAlign: 'right', paddingRight: 12, color: 'var(--fg1)' }}>{fmtUsd(usd)}</td>
                <td style={{ textAlign: 'right', paddingRight: 12, color: 'var(--fg1)' }}>{pct.toFixed(1)}%</td>
                <td style={{ paddingRight: 0, paddingTop: 7, paddingBottom: 7 }}>
                  <div style={{ width: 80, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#78FBE6', borderRadius: 3, transition: 'width 0.4s ease' }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {totalUsd > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
          Total tracked: <strong style={{ color: 'var(--fg0)' }}>{fmtUsd(totalUsd)}</strong>
        </div>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function OraclePage() {
  const [mode, setMode] = useState<MacroOracleMode>('g')

  // ── G-mode state ────────────────────────────────────────────────────────
  const [gPayload, setGPayload] = useState<MacroOracleRadarPayload>(MOCK_G)
  const [gStatus, setGStatus] = useState<DataStatus>('idle')
  const [gError, setGError] = useState<string | null>(null)

  const loadGMode = () => {
    setGStatus('loading'); setGError(null)
    const ac = new AbortController()
    fetchGModePayload(ac.signal)
      .then((p) => { setGPayload(p); setGStatus('live') })
      .catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') {
          setGPayload(MOCK_G); setGStatus('error')
          setGError((e as Error)?.message ?? 'Unknown error')
        }
      })
  }

  // ── P-mode state via hook ───────────────────────────────────────────────
  const portfolio = usePortfolio()
  const [showManual, setShowManual] = useState(false)

  // Auto-load G-mode on first visit
  const didInitG = useState(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemo(() => { if (mode === 'g' && gStatus === 'idle') { loadGMode() } }, [mode])

  const asOfLocal = (iso: string) => {
    const d = new Date(iso)
    return isNaN(d.getTime()) ? iso : d.toLocaleString()
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const pPayload = portfolio.radarPayload
  const activePayload = mode === 'g' ? gPayload : pPayload

  return (
    <main className="page">
      {/* ── Header ── */}
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: 'var(--muted)', fontSize: 12, textDecoration: 'none', opacity: 0.7 }}>← Home</a>
        </div>
        <div className="title" style={{ marginTop: 8 }}>
          {mode === 'g' ? 'Global Macroeconomic Oracle' : 'Portfolio Risk Manager'}
        </div>
        <div className="subtitle">
          {mode === 'g'
            ? 'Global capital allocation shape · sector market cap · 7d and YTD flows.'
            : 'Connect your wallet or enter holdings manually to generate your personal allocation radar.'}
        </div>

        {/* mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>View</span>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: 2, gap: 2 }}>
            {(['g', 'p'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} style={{
                background: mode === m ? 'rgba(255,255,255,0.15)' : 'transparent',
                border: 'none', color: mode === m ? 'var(--fg1)' : 'var(--muted)',
                borderRadius: 6, padding: '4px 14px', fontSize: 12, fontWeight: mode === m ? 600 : 400,
                cursor: 'pointer', letterSpacing: '0.04em', transition: 'all 0.15s ease'
              }}>
                {m === 'g' ? '🌐 Global' : '👤 Personal'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── P-mode wallet bar ── */}
      {mode === 'p' && (
        <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Connect Wallet
          </div>
          <WalletBar
            connected={portfolio.wallet}
            onConnect={portfolio.connect}
            onDisconnect={portfolio.disconnect}
          />
          {portfolio.status === 'fetching' && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Fetching on-chain balances…</p>
          )}
          {portfolio.status === 'error' && (
            <p style={{ margin: 0, fontSize: 12, color: '#FF5E5B' }}>{portfolio.error}</p>
          )}
          {portfolio.status === 'ready' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: '#1FE091' }}>
                ✓ {portfolio.allTokens.length} tokens · {fmtUsd(portfolio.totalUsd)} on-chain
              </span>
              <button onClick={portfolio.refresh} style={miniBtnStyle}>↺ Refresh</button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              style={{ ...miniBtnStyle, background: showManual ? 'rgba(255,255,255,0.12)' : undefined }}
              onClick={() => setShowManual((v) => !v)}
            >
              {showManual ? '▲ Hide manual entry' : '✎ Manual / CSV entry'}
            </button>
            {portfolio.totalUsd > 0 && (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                Manual + on-chain totals are merged into the radar.
              </span>
            )}
          </div>
        </section>
      )}

      {/* ── Manual entry panel ── */}
      {mode === 'p' && showManual && (
        <section className="panel">
          <ManualEntry value={portfolio.manualAlloc} onChange={portfolio.setManual} />
        </section>
      )}

      {/* ── Main radar + data panel ── */}
      <section className="panel radar-row">
        {/* Radar */}
        <div style={{ flex: '0 0 auto' }}>
          {(mode === 'g' || portfolio.totalUsd > 0) ? (
            <MacroOracleRadar payload={activePayload} mode={mode} theme="dark" size="lg" showBadges={false} />
          ) : (
            <EmptyRadarPlaceholder />
          )}
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 240 }}>

          {/* Meta row */}
          <div className="kv" style={{ fontSize: 12 }}>
            <div style={{ color: 'var(--muted)' }}>data</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusDot status={mode === 'g' ? gStatus : (portfolio.status === 'fetching' ? 'loading' : portfolio.status === 'ready' ? 'live' : portfolio.totalUsd > 0 ? 'live' : 'idle')} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{mode === 'g' ? gStatus : portfolio.status}</span>
              {mode === 'g' && gError && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>({gError})</span>}
            </div>
            <div style={{ color: 'var(--muted)' }}>as‑of</div>
            <div style={{ fontSize: 12 }}>{asOfLocal(activePayload.asOf)}</div>
            {mode === 'p' && portfolio.totalUsd > 0 && (
              <>
                <div style={{ color: 'var(--muted)' }}>total</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtUsd(portfolio.totalUsd)}</div>
              </>
            )}
          </div>

          {/* G-mode allocation table */}
          {mode === 'g' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Global Allocation</div>
              <GAllocationTable payload={gPayload} />
              <div className="note" style={{ marginTop: 10 }}>
                <span style={{ color: '#1FE091' }}>●</span> inflow&nbsp;
                <span style={{ color: '#FF5E5B' }}>●</span> outflow&nbsp;
                <span style={{ color: '#6F738A' }}>●</span> neutral
                <br />Estimated sector proxies — not exact valuations.
              </div>
            </div>
          )}

          {/* P-mode: allocation summary */}
          {mode === 'p' && portfolio.totalUsd > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your Allocation</div>
              <PModeAllocationTable alloc={portfolio.mergedAlloc} totalUsd={portfolio.totalUsd} />
            </div>
          )}

          {/* P-mode: token list */}
          {mode === 'p' && portfolio.allTokens.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>On-chain Holdings</div>
              <TokenTable tokens={portfolio.allTokens} chainResults={portfolio.chainResults} />
            </div>
          )}

          {/* P-mode empty state */}
          {mode === 'p' && portfolio.totalUsd === 0 && portfolio.status !== 'fetching' && (
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
              Connect a wallet or use manual entry to generate your personal allocation radar.
            </div>
          )}

          {/* Refresh / action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {mode === 'g' && (
              <button onClick={loadGMode} disabled={gStatus === 'loading'} style={{ ...miniBtnStyle, opacity: gStatus === 'loading' ? 0.5 : 1 }}>
                {gStatus === 'loading' ? 'Loading…' : '↺ Refresh'}
              </button>
            )}
            {mode === 'p' && portfolio.wallet && (
              <button onClick={portfolio.refresh} disabled={portfolio.status === 'fetching'} style={{ ...miniBtnStyle, opacity: portfolio.status === 'fetching' ? 0.5 : 1 }}>
                {portfolio.status === 'fetching' ? 'Fetching…' : '↺ Refresh'}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <section className="panel" style={{ fontSize: 12, color: 'var(--muted)' }}>
        <code>GET /api/oracle-data/radar?mode=g|p</code> · <code>GET /api/pmode/balances?address=&chains=eth,base,solana</code>
      </section>
    </main>
  )
}

// ── Empty radar placeholder ────────────────────────────────────────────────

function EmptyRadarPlaceholder() {
  return (
    <div style={{
      width: 'min(520px, 92vw)', aspectRatio: '1/1', minHeight: 320,
      borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(0,0,0,0.08)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12
    }}>
      <div style={{ fontSize: 36, opacity: 0.25 }}>◈</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', maxWidth: 200, lineHeight: 1.5 }}>
        Connect a wallet or enter holdings to generate your radar
      </div>
    </div>
  )
}

const miniBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.13)',
  color: 'rgba(255,255,255,0.80)',
  borderRadius: 6, padding: '5px 11px',
  fontSize: 12, cursor: 'pointer',
}
