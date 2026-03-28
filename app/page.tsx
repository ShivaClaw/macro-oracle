'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MacroOracleRadar, { type MacroOracleRadarPayload } from '../components/MacroOracleRadar';

// ── Static mock payload (fallback when API is unavailable) ─────────────────

const MOCK: MacroOracleRadarPayload = {
  asOf: new Date().toISOString(),
  bands: [
    { key: 'R0', label: 'RISK 0', name: 'Cash / T-Bills',       valueNow: 18.4, value7dAgo: 22.1 },
    { key: 'R1', label: 'RISK 1', name: 'Duration / Rates',     valueNow: 9.6,  value7dAgo: 8.2  },
    { key: 'R2', label: 'RISK 2', name: 'IG Credit',            valueNow: 10.8, value7dAgo: 9.2  },
    { key: 'R3', label: 'RISK 3', name: 'Defensive Eq.',        valueNow: 9.4,  value7dAgo: 10.1 },
    { key: 'R4', label: 'RISK 4', name: 'Cyclical Eq.',         valueNow: 12.2, value7dAgo: 11.0 },
    { key: 'R5', label: 'RISK 5', name: 'Inflation / Cmd',      valueNow: 11.5, value7dAgo: 9.9  },
    { key: 'R6', label: 'RISK 6', name: 'EM / FX',              valueNow: 8.9,  value7dAgo: 7.3  },
    { key: 'R7', label: 'RISK 7', name: 'Crypto Majors',        valueNow: 10.6, value7dAgo: 8.6  },
    { key: 'R8', label: 'RISK 8', name: 'Crypto Alts',          valueNow: 8.6,  value7dAgo: 13.6 }
  ],
  meta: { source: 'mock' }
};

// ── API fetch ──────────────────────────────────────────────────────────────

async function fetchRadarPayload(signal?: AbortSignal): Promise<MacroOracleRadarPayload> {
  const res = await fetch('/api/oracle-data/radar', {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as MacroOracleRadarPayload;
  // Minimal validation: must have asOf + non-empty bands array
  if (!data.asOf || !Array.isArray(data.bands) || !data.bands.length) {
    throw new Error('Invalid payload shape from /api/oracle-data/radar');
  }
  return data;
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
        {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '—'}
      </td>
    </tr>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Page() {
  const [payload, setPayload] = useState<MacroOracleRadarPayload>(MOCK);
  const [status, setStatus] = useState<DataStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus('loading');
    setError(null);

    fetchRadarPayload(ac.signal)
      .then((p) => {
        setPayload(p);
        setStatus('live');
        setRefreshedAt(new Date());
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === 'AbortError') return;
        setStatus('error');
        setError(String((e as Error)?.message ?? e));
      });
  }, []);

  // Initial load
  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const asOfLocal = useMemo(() => {
    const d = new Date(payload.asOf);
    return Number.isNaN(d.getTime()) ? payload.asOf : d.toLocaleString();
  }, [payload.asOf]);

  const refreshedAtStr = useMemo(() => {
    return refreshedAt ? refreshedAt.toLocaleTimeString() : null;
  }, [refreshedAt]);

  const cacheHit = payload.meta?.cacheHit;
  const cacheAge = typeof payload.meta?.cacheAgeSeconds === 'number'
    ? `${payload.meta.cacheAgeSeconds}s`
    : null;

  return (
    <main className="page">
      <header className="header">
        <div className="title">Macro Oracle Radar</div>
        <div className="subtitle">
          Allocation shape · per-band intensity · 7d momentum tails.
        </div>
      </header>

      <section className="panel radar-row">
        {/* Chart */}
        <div style={{ flex: '0 0 auto' }}>
          <MacroOracleRadar payload={payload} theme="dark" size="lg" showBadges />
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 220 }}>

          {/* Status card */}
          <div className="kv" style={{ fontSize: 13 }}>
            <div style={{ color: 'var(--muted)' }}>data</div>
            <div><StatusBadge status={status} error={error} /></div>

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
                <div style={{ fontSize: 12 }}>
                  {cacheHit ? `hit · ${cacheAge} old` : `miss`}
                </div>
              </>
            )}

            <div style={{ color: 'var(--muted)' }}>axes</div>
            <div>{payload.bands.length}</div>
          </div>

          {/* Band scores table */}
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
                {payload.bands.map((b) => <BandRow key={b.key} band={b} />)}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="note">
            <b>Read it in 5s:</b>
            <br />· Shape — balanced vs concentrated vs risk-off
            <br />· Wedges — per-band intensity
            <br />· <span style={{ color: '#fb923c' }}>Warm tails</span> — 7d outward (risk-on)
            <br />· <span style={{ color: '#60a5fa' }}>Cool tails</span> — 7d inward (risk-off)
          </div>

          {/* Refresh button */}
          <button
            onClick={load}
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
            {status === 'loading' ? 'Loading…' : '↺ Refresh'}
          </button>
        </div>
      </section>

      <section className="panel" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
        <code>GET /api/oracle-data/radar</code> → <code>MacroOracleRadarPayload</code>
        {' · '}
        <code>GET /api/oracle-data</code> → raw <code>OracleSnapshot</code>
        {' · '}
        <code>GET /api/oracle-data/health</code> · <code>GET /api/oracle-data/providers</code>
      </section>
    </main>
  );
}
