'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MacroOracleRadar, { type MacroOracleRadarPayload, type MacroOracleMode } from '../components/MacroOracleRadar';

// ── Mock payloads ──────────────────────────────────────────────────────────

const MOCK_G: MacroOracleRadarPayload = {
  asOf: new Date().toISOString(),
  mode: 'g',
  bands: [
    { key: 'R1', label: 'R1', name: '$',                valueNow: 22.1, value7dAgo: 20.4, flowDirection: 'inflow'  },
    { key: 'R3', label: 'R3', name: 'Core Equity',      valueNow: 18.6, value7dAgo: 19.8, flowDirection: 'outflow' },
    { key: 'R5', label: 'R5', name: 'Vital Commodities',valueNow: 12.4, value7dAgo: 11.9, flowDirection: 'inflow'  },
    { key: 'R6', label: 'R6', name: 'Risk ON',          valueNow:  9.2, value7dAgo: 11.5, flowDirection: 'outflow' },
    { key: 'R4', label: 'R4', name: 'Risk OFF',         valueNow: 16.8, value7dAgo: 16.6, flowDirection: 'neutral' },
    { key: 'R2', label: 'R2', name: 'Low Risk',         valueNow:  8.3, value7dAgo:  7.1, flowDirection: 'inflow'  },
  ],
  meta: {
    source: 'mock',
    totalTrackedUsd: 1.35e14,
    bucketsNowUsd:   { R1: 2.98e13, R2: 1.12e10, R3: 2.51e13, R4: 2.27e13, R5: 1.67e10, R6: 1.24e10 },
    buckets7dAgoUsd: { R1: 2.75e13, R2: 1.05e10, R3: 2.67e13, R4: 2.24e13, R5: 1.61e10, R6: 1.55e10 },
    bucketsYtdAgoUsd:{ R1: 2.60e13, R2: 9.5e9,  R3: 2.45e13, R4: 2.10e13, R5: 1.50e10, R6: 1.20e10 },
  }
};

const MOCK_P: MacroOracleRadarPayload = {
  asOf: new Date().toISOString(),
  mode: 'p',
  bands: [
    { key: 'R1', label: 'R1', name: 'Cash Equiv.',  valueNow: 12.0, value7dAgo: 15.0 },
    { key: 'R3', label: 'R3', name: 'Core Equity',  valueNow: 10.5, value7dAgo:  9.2 },
    { key: 'R5', label: 'R5', name: 'Commodities',  valueNow:  8.0, value7dAgo:  7.5 },
    { key: 'R7', label: 'R7', name: 'Venture',      valueNow:  5.5, value7dAgo:  5.5 },
    { key: 'R8', label: 'R8', name: 'Trading',      valueNow: 18.0, value7dAgo: 14.0 },
    { key: 'R6', label: 'R6', name: 'Risk ON',      valueNow: 22.0, value7dAgo: 19.0 },
    { key: 'R4', label: 'R4', name: 'Hard Assets',  valueNow: 14.0, value7dAgo: 15.8 },
    { key: 'R2', label: 'R2', name: 'Low Risk',     valueNow: 10.0, value7dAgo:  9.0 },
  ],
  meta: { source: 'mock' }
};

// ── API fetch ──────────────────────────────────────────────────────────────

async function fetchRadarPayload(mode: MacroOracleMode, signal?: AbortSignal): Promise<MacroOracleRadarPayload> {
  const res = await fetch(`/api/oracle-data/radar?mode=${mode}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as MacroOracleRadarPayload;
  if (!data.asOf || !Array.isArray(data.bands) || !data.bands.length) {
    throw new Error('Invalid payload shape from /api/oracle-data/radar');
  }
  return data;
}

// ── Formatting helpers ─────────────────────────────────────────────────────

function fmtUsd(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtFlowDelta(now: number, prev: number): { text: string; positive: boolean | null } {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) {
    return { text: '—', positive: null };
  }
  const delta = now - prev;
  const pct = (delta / prev) * 100;
  const sign = delta >= 0 ? '+' : '−';
  const abs = Math.abs(delta);
  const absPct = Math.abs(pct);
  return {
    text: `${sign}${fmtUsd(abs)} (${sign}${absPct.toFixed(1)}%)`,
    positive: delta >= 0
  };
}

// ── Status badge ───────────────────────────────────────────────────────────

type DataStatus = 'loading' | 'live' | 'mock' | 'error';

function StatusBadge({ status, error }: { status: DataStatus; error?: string | null }) {
  const color = status === 'live' ? '#22c55e' : status === 'loading' ? '#facc15' : '#f87171';
  const label = status === 'loading' ? 'fetching…' : status;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{label}</span>
      {status === 'error' && error && (
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginLeft: 4 }}>({error})</span>
      )}
    </span>
  );
}

// ── G-mode allocation table ────────────────────────────────────────────────

const G_BAND_ORDER = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] as const;

function GAllocationTable({ payload }: { payload: MacroOracleRadarPayload }) {
  const meta = payload.meta as Record<string, unknown> | undefined;
  const bucketsNow    = meta?.bucketsNowUsd    as Record<string, number> | undefined;
  const buckets7d     = meta?.buckets7dAgoUsd  as Record<string, number> | undefined;
  const bucketsYtd    = meta?.bucketsYtdAgoUsd as Record<string, number> | undefined;

  // Build rows sorted by G_BAND_ORDER (only keep bands that appear in payload)
  const rows = useMemo(() => {
    const bandMap = Object.fromEntries(payload.bands.map((b) => [b.key, b]));
    return G_BAND_ORDER
      .filter((k) => bandMap[k])
      .map((k) => {
        const band = bandMap[k]!;
        const nowUsd  = bucketsNow?.[k];
        const prevUsd = buckets7d?.[k];
        const ytdUsd  = bucketsYtd?.[k];
        const flow7d  = nowUsd != null && prevUsd != null ? fmtFlowDelta(nowUsd, prevUsd) : null;
        const flowYtd = nowUsd != null && ytdUsd  != null ? fmtFlowDelta(nowUsd, ytdUsd)  : null;
        return { band, nowUsd, flow7d, flowYtd };
      });
  }, [payload, bucketsNow, buckets7d, bucketsYtd]);

  const flowColor = (positive: boolean | null) => {
    if (positive === null) return 'var(--muted)';
    return positive ? '#1FE091' : '#FF5E5B';
  };

  const flowIcon = (positive: boolean | null) => {
    if (positive === null) return '';
    return positive ? '▲' : '▼';
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--muted)', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <th style={{ textAlign: 'left', paddingRight: 14, paddingBottom: 8, fontWeight: 500 }}>Sector</th>
            <th style={{ textAlign: 'right', paddingRight: 14, paddingBottom: 8, fontWeight: 500 }}>Market Cap</th>
            <th style={{ textAlign: 'right', paddingRight: 14, paddingBottom: 8, fontWeight: 500 }}>7d Flow</th>
            <th style={{ textAlign: 'right', paddingBottom: 8, fontWeight: 500 }}>YTD Flow</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ band, nowUsd, flow7d, flowYtd }) => (
            <tr
              key={band.key}
              style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
            >
              <td style={{ paddingTop: 8, paddingBottom: 8, paddingRight: 14 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {/* flow pill */}
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: band.flowDirection === 'inflow' ? '#1FE091'
                               : band.flowDirection === 'outflow' ? '#FF5E5B'
                               : '#6F738A'
                  }} />
                  <span style={{ color: 'var(--fg0)', fontWeight: 500 }}>{band.name ?? band.key}</span>
                </span>
              </td>
              <td style={{ textAlign: 'right', paddingRight: 14, paddingTop: 8, paddingBottom: 8, color: 'var(--fg1)' }}>
                {fmtUsd(nowUsd)}
              </td>
              <td style={{ textAlign: 'right', paddingRight: 14, paddingTop: 8, paddingBottom: 8 }}>
                {flow7d ? (
                  <span style={{ color: flowColor(flow7d.positive) }}>
                    {flowIcon(flow7d.positive)}&nbsp;{flow7d.text}
                  </span>
                ) : <span style={{ color: 'var(--muted)' }}>—</span>}
              </td>
              <td style={{ textAlign: 'right', paddingTop: 8, paddingBottom: 8 }}>
                {flowYtd ? (
                  <span style={{ color: flowColor(flowYtd.positive) }}>
                    {flowIcon(flowYtd.positive)}&nbsp;{flowYtd.text}
                  </span>
                ) : <span style={{ color: 'var(--muted)' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── P-mode band table (original, unchanged) ────────────────────────────────

function PBandRow({ band }: { band: MacroOracleRadarPayload['bands'][number] }) {
  const delta = band.delta7d ?? (band.value7dAgo != null ? band.valueNow - band.value7dAgo : null);
  const deltaColor = delta == null ? 'var(--muted)' : delta > 0 ? '#fb923c' : delta < 0 ? '#60a5fa' : 'var(--muted)';
  return (
    <tr>
      <td style={{ color: 'var(--muted)', paddingRight: 10, fontSize: 11, whiteSpace: 'nowrap' }}>{band.key}</td>
      <td style={{ paddingRight: 16, whiteSpace: 'nowrap', color: 'var(--fg1)' }}>{band.name ?? band.label}</td>
      <td style={{ textAlign: 'right', paddingRight: 12, color: 'var(--fg0)' }}>{band.valueNow.toFixed(1)}</td>
      <td style={{ textAlign: 'right', color: deltaColor }}>
        {delta != null ? (delta > 0 ? '+' : '') + delta.toFixed(1) : '—'}
      </td>
    </tr>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Page() {
  const [mode, setMode] = useState<MacroOracleMode>('g');
  const [payload, setPayload] = useState<MacroOracleRadarPayload>(MOCK_G);
  const [status, setStatus] = useState<DataStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((currentMode: MacroOracleMode) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus('loading');
    setError(null);
    fetchRadarPayload(currentMode, ac.signal)
      .then((p) => {
        setPayload(p);
        setStatus('live');
        setRefreshedAt(new Date());
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === 'AbortError') return;
        setPayload(currentMode === 'g' ? MOCK_G : MOCK_P);
        setStatus('error');
        setError(String((e as Error)?.message ?? e));
      });
  }, []);

  useEffect(() => {
    load(mode);
    return () => abortRef.current?.abort();
  }, [load, mode]);

  useEffect(() => {
    const id = setInterval(() => load(mode), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load, mode]);

  const asOfLocal = useMemo(() => {
    const d = new Date(payload.asOf);
    return Number.isNaN(d.getTime()) ? payload.asOf : d.toLocaleString();
  }, [payload.asOf]);

  const refreshedAtStr = useMemo(() => refreshedAt ? refreshedAt.toLocaleTimeString() : null, [refreshedAt]);

  return (
    <main className="page">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: 'var(--muted)', fontSize: 12, textDecoration: 'none', opacity: 0.7 }}>
            ← Home
          </a>
        </div>
        <div className="title" style={{ marginTop: 8 }}>
          {mode === 'g' ? 'Global Macroeconomic Oracle' : 'Portfolio Risk Manager'}
        </div>
        <div className="subtitle">
          {mode === 'g'
            ? 'Global capital allocation shape · sector market cap · 7d and YTD flows.'
            : 'Personal portfolio allocation · per-band intensity · 7d momentum tails.'}
        </div>

        {/* mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>View</span>
          <div style={{
            display: 'flex',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: 2,
            gap: 2
          }}>
            {(['g', 'p'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? 'rgba(255,255,255,0.15)' : 'transparent',
                  border: 'none',
                  color: mode === m ? 'var(--fg1)' : 'var(--muted)',
                  borderRadius: 6,
                  padding: '4px 14px',
                  fontSize: 12,
                  fontWeight: mode === m ? 600 : 400,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                  transition: 'all 0.15s ease'
                }}
              >
                {m === 'g' ? '🌐 Global' : '👤 Personal'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="panel radar-row">
        {/* ── Left: radar chart ── */}
        <div style={{ flex: '0 0 auto' }}>
          <MacroOracleRadar payload={payload} mode={mode} theme="dark" size="lg" showBadges={mode === 'p'} />
        </div>

        {/* ── Right: data panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 240 }}>

          {/* meta row */}
          <div className="kv" style={{ fontSize: 12 }}>
            <div style={{ color: 'var(--muted)' }}>data</div>
            <div><StatusBadge status={status} error={error} /></div>

            <div style={{ color: 'var(--muted)' }}>as‑of</div>
            <div style={{ fontSize: 12 }}>{asOfLocal}</div>

            {refreshedAtStr && (
              <>
                <div style={{ color: 'var(--muted)' }}>fetched</div>
                <div style={{ fontSize: 12 }}>{refreshedAtStr}</div>
              </>
            )}
          </div>

          {/* ── G-mode: allocation table ── */}
          {mode === 'g' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Global Allocation
              </div>
              <GAllocationTable payload={payload} />

              {/* legend */}
              <div className="note" style={{ marginTop: 12 }}>
                <span style={{ color: '#1FE091' }}>●</span> inflow&nbsp;&nbsp;
                <span style={{ color: '#FF5E5B' }}>●</span> outflow&nbsp;&nbsp;
                <span style={{ color: '#6F738A' }}>●</span> neutral
                <br />
                Market caps are estimated sector proxies, not exact.
              </div>
            </div>
          )}

          {/* ── P-mode: band score table ── */}
          {mode === 'p' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Band Scores
              </div>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', fontSize: 11 }}>
                    <th style={{ textAlign: 'left', paddingRight: 10, fontWeight: 400 }}>ID</th>
                    <th style={{ textAlign: 'left', paddingRight: 16, fontWeight: 400 }}>Band</th>
                    <th style={{ textAlign: 'right', paddingRight: 12, fontWeight: 400 }}>Now</th>
                    <th style={{ textAlign: 'right', fontWeight: 400 }}>7d Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.bands.map((b) => <PBandRow key={b.key} band={b} />)}
                </tbody>
              </table>

              <div className="note" style={{ marginTop: 12 }}>
                <b>P-mode: Personal portfolio</b>
                <br />· <span style={{ color: '#fb923c' }}>Warm tails</span> — 7d outward (risk-on)
                <br />· <span style={{ color: '#60a5fa' }}>Cool tails</span> — 7d inward (risk-off)
              </div>
            </div>
          )}

          <button
            onClick={() => load(mode)}
            disabled={status === 'loading'}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--fg1)',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
              opacity: status === 'loading' ? 0.5 : 1,
              alignSelf: 'flex-start'
            }}
          >
            {status === 'loading' ? 'Loading…' : '↺ Refresh'}
          </button>
        </div>
      </section>

      <section className="panel" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
        <code>GET /api/oracle-data/radar?mode=g|p</code> → <code>MacroOracleRadarPayload</code>
        {' · '}
        <code>GET /api/oracle-data</code> → raw <code>OracleSnapshot</code>
        {' · '}
        <code>GET /api/oracle-data/health</code>
      </section>
    </main>
  );
}
