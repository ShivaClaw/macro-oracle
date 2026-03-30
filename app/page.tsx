'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MacroOracleRadar, { type MacroOracleRadarPayload, type MacroOracleMode } from '../components/MacroOracleRadar';

// ── Mock payloads ──────────────────────────────────────────────────────────

const MOCK_G: MacroOracleRadarPayload = {
  asOf: new Date().toISOString(),
  mode: 'g',
  bands: [
    { key: 'R1', label: 'RISK 1', name: 'Cash Equiv.',  valueNow: 22.1, value7dAgo: 20.4, flowDirection: 'inflow'  },
    { key: 'R3', label: 'RISK 3', name: 'Core Equity',  valueNow: 18.6, value7dAgo: 19.8, flowDirection: 'outflow' },
    { key: 'R5', label: 'RISK 5', name: 'Commodities',  valueNow: 12.4, value7dAgo: 11.9, flowDirection: 'inflow'  },
    { key: 'R6', label: 'RISK 6', name: 'Risk ON',      valueNow:  9.2, value7dAgo: 11.5, flowDirection: 'outflow' },
    { key: 'R4', label: 'RISK 4', name: 'Hard Assets',  valueNow: 16.8, value7dAgo: 16.6, flowDirection: 'neutral' },
    { key: 'R2', label: 'RISK 2', name: 'Low Risk',     valueNow:  8.3, value7dAgo:  7.1, flowDirection: 'inflow'  },
  ],
  meta: { source: 'mock' }
};

const MOCK_P: MacroOracleRadarPayload = {
  asOf: new Date().toISOString(),
  mode: 'p',
  bands: [
    { key: 'R1', label: 'RISK 1', name: 'Cash Equiv.',  valueNow: 12.0, value7dAgo: 15.0 },
    { key: 'R3', label: 'RISK 3', name: 'Core Equity',  valueNow: 10.5, value7dAgo:  9.2 },
    { key: 'R5', label: 'RISK 5', name: 'Commodities',  valueNow:  8.0, value7dAgo:  7.5 },
    { key: 'R7', label: 'RISK 7', name: 'Venture',      valueNow:  5.5, value7dAgo:  5.5 },
    { key: 'R8', label: 'RISK 8', name: 'Trading',      valueNow: 18.0, value7dAgo: 14.0 },
    { key: 'R6', label: 'RISK 6', name: 'Risk ON',      valueNow: 22.0, value7dAgo: 19.0 },
    { key: 'R4', label: 'RISK 4', name: 'Hard Assets',  valueNow: 14.0, value7dAgo: 15.8 },
    { key: 'R2', label: 'RISK 2', name: 'Low Risk',     valueNow: 10.0, value7dAgo:  9.0 },
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

// ── Status badge ───────────────────────────────────────────────────────────

type DataStatus = 'loading' | 'live' | 'mock' | 'error';

function StatusBadge({ status, error }: { status: DataStatus; error?: string | null }) {
  const color = status === 'live' ? '#22c55e' : status === 'loading' ? '#facc15' : '#f87171';
  const label = status === 'loading' ? 'fetching\u2026' : status;
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

// ── Band table ─────────────────────────────────────────────────────────────

function BandRow({ band }: { band: MacroOracleRadarPayload['bands'][number] }) {
  const delta = band.delta7d ?? (band.value7dAgo != null ? band.valueNow - band.value7dAgo : null);
  const deltaColor = delta == null ? 'var(--muted)' : delta > 0 ? '#fb923c' : delta < 0 ? '#60a5fa' : 'var(--muted)';
  return (
    <tr>
      <td style={{ color: 'var(--muted)', paddingRight: 10, fontSize: 11, whiteSpace: 'nowrap' }}>{band.key}</td>
      <td style={{ paddingRight: 16, fontSize: 12 }}>{band.name ?? band.label}</td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', paddingRight: 12 }}>
        {band.valueNow.toFixed(1)}
      </td>
      <td style={{ textAlign: 'right', color: deltaColor, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
        {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '\u2014'}
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
  const cacheHit = payload.meta?.cacheHit;
  const cacheAge = typeof payload.meta?.cacheAgeSeconds === 'number' ? `${payload.meta.cacheAgeSeconds}s` : null;
  const axisCount = mode === 'g' ? 6 : 8;

  return (
    <main className="page">
      <header className="header">
        <div className="title">Macro Oracle Radar</div>
        <div className="subtitle">
          Allocation shape \u00b7 per-band intensity \u00b7 7d momentum tails.
        </div>

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
                {m === 'g' ? '\ud83c\udf10 Global' : '\ud83d\udc64 Personal'}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {mode === 'g' ? 'Global M2 allocation map' : 'Personal portfolio allocation'}
          </span>
        </div>
      </header>

      <section className="panel radar-row">
        <div style={{ flex: '0 0 auto' }}>
          <MacroOracleRadar payload={payload} mode={mode} theme="dark" size="lg" showBadges />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 220 }}>
          <div className="kv" style={{ fontSize: 13 }}>
            <div style={{ color: 'var(--muted)' }}>data</div>
            <div><StatusBadge status={status} error={error} /></div>

            <div style={{ color: 'var(--muted)' }}>mode</div>
            <div style={{ fontSize: 12 }}>{mode === 'g' ? 'Global (G)' : 'Personal (P)'}</div>

            <div style={{ color: 'var(--muted)' }}>as-of</div>
            <div style={{ fontSize: 12 }}>{asOfLocal}</div>

            {refreshedAtStr && (
              <>
                <div style={{ color: 'var(--muted)' }}>fetched</div>
                <div style={{ fontSize: 12 }}>{refreshedAtStr}</div>
              </>
            )}
            {cacheAge && (
              <>
                <div style={{ color: 'var(--muted)' }}>cache</div>
                <div style={{ fontSize: 12 }}>{cacheHit ? `hit \u00b7 ${cacheAge} old` : 'miss'}</div>
              </>
            )}
            <div style={{ color: 'var(--muted)' }}>axes</div>
            <div>{axisCount}</div>
          </div>

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
                  <th style={{ textAlign: 'right', fontWeight: 400 }}>7d \u0394</th>
                </tr>
              </thead>
              <tbody>
                {payload.bands.map((b) => <BandRow key={b.key} band={b} />)}
              </tbody>
            </table>
          </div>

          <div className="note">
            {mode === 'g' ? (
              <>
                <b>G-mode: Global M2 map</b>
                <br />\u00b7 Shape \u2014 global capital distribution
                <br />\u00b7 Wedges \u2014 per-sector intensity
                <br />\u00b7 <span style={{ color: '#1FE091' }}>Green</span> \u2014 7d net inflow
                <br />\u00b7 <span style={{ color: '#FF5E5B' }}>Red</span> \u2014 7d net outflow
                <br />\u00b7 <span style={{ color: '#6F738A' }}>Grey</span> \u2014 neutral
              </>
            ) : (
              <>
                <b>P-mode: Personal portfolio</b>
                <br />\u00b7 Shape \u2014 allocation distribution
                <br />\u00b7 Wedges \u2014 per-band intensity
                <br />\u00b7 <span style={{ color: '#fb923c' }}>Warm tails</span> \u2014 7d outward (risk-on)
                <br />\u00b7 <span style={{ color: '#60a5fa' }}>Cool tails</span> \u2014 7d inward (risk-off)
              </>
            )}
          </div>

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
              opacity: status === 'loading' ? 0.5 : 1
            }}
          >
            {status === 'loading' ? 'Loading\u2026' : '\u21ba Refresh'}
          </button>
        </div>
      </section>

      <section className="panel" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
        <code>GET /api/oracle-data/radar?mode=g|p</code> \u2192 <code>MacroOracleRadarPayload</code>
        {' \u00b7 '}
        <code>GET /api/oracle-data</code> \u2192 raw <code>OracleSnapshot</code>
        {' \u00b7 '}
        <code>GET /api/oracle-data/health</code> \u00b7 <code>GET /api/oracle-data/providers</code>
      </section>
    </main>
  );
}
