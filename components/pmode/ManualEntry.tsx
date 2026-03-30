// components/pmode/ManualEntry.tsx
// Manual dollar-value entry per band + CSV import.

'use client'

import { useCallback, useRef, useState } from 'react'
import { parseBrokerageCsv } from '@/lib/pmode/csvParser'
import { P_BANDS } from '@/lib/pmode/types'
import type { BandAllocation, PModeBandKey } from '@/lib/pmode/types'

type Props = {
  value: BandAllocation
  onChange: (next: BandAllocation) => void
}

function fmtUsd(v: number) {
  if (!v) return ''
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3)  return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function parseRawInput(s: string): number {
  const cleaned = s.replace(/[$,\s]/g, '').toLowerCase()
  if (cleaned.endsWith('t')) return parseFloat(cleaned) * 1e12
  if (cleaned.endsWith('b')) return parseFloat(cleaned) * 1e9
  if (cleaned.endsWith('m')) return parseFloat(cleaned) * 1e6
  if (cleaned.endsWith('k')) return parseFloat(cleaned) * 1e3
  const n = parseFloat(cleaned)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export default function ManualEntry({ value, onChange }: Props) {
  const [csvStatus, setCsvStatus] = useState<string | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleChange = useCallback((key: PModeBandKey, raw: string) => {
    const n = parseRawInput(raw)
    onChange({ ...value, [key]: n })
  }, [value, onChange])

  const handleCsv = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvStatus(null); setCsvError(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const result = parseBrokerageCsv(text)
      if (!result.ok) {
        setCsvError(result.error)
        return
      }
      // Merge: add CSV values on top of current manual values
      const next = { ...value }
      for (const key of Object.keys(result.totals) as PModeBandKey[]) {
        next[key] = (next[key] ?? 0) + result.totals[key]
      }
      onChange(next)
      const total = Object.values(result.totals).reduce((s, v) => s + v, 0)
      setCsvStatus(
        `${result.source}: imported ${result.rows.length} positions · ${fmtUsd(total)} total`
        + (result.warnings.length ? ` · ${result.warnings.length} warning(s)` : '')
      )
    }
    reader.readAsText(file)
    // Reset input so same file can be re-imported after clear
    e.target.value = ''
  }, [value, onChange])

  const clearAll = useCallback(() => {
    onChange({ R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, R6: 0, R7: 0, R8: 0 })
    setCsvStatus(null); setCsvError(null)
  }, [onChange])

  const total = Object.values(value).reduce((s, v) => s + v, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Manual Entry
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {total > 0 && (
            <span style={{ fontSize: 12, color: 'var(--fg1)' }}>
              Total: <strong style={{ color: 'var(--fg0)' }}>{fmtUsd(total)}</strong>
            </span>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            style={btnStyle}
          >
            ↑ Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleCsv} />
          {total > 0 && (
            <button onClick={clearAll} style={{ ...btnStyle, opacity: 0.6 }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* CSV status */}
      {csvStatus && (
        <div style={{ fontSize: 12, color: '#1FE091', background: 'rgba(31,224,145,0.08)', borderRadius: 6, padding: '7px 10px' }}>
          ✓ {csvStatus}
        </div>
      )}
      {csvError && (
        <div style={{ fontSize: 12, color: '#FF5E5B', background: 'rgba(255,94,91,0.08)', borderRadius: 6, padding: '7px 10px' }}>
          ✗ {csvError}
        </div>
      )}

      {/* Band inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
        {P_BANDS.map((band) => (
          <BandInput
            key={band.key}
            bandKey={band.key}
            name={band.name}
            description={band.description}
            value={value[band.key]}
            onChange={(v) => handleChange(band.key, v)}
          />
        ))}
      </div>

      {/* CSV format hint */}
      <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        CSV: Schwab, Fidelity, Robinhood, Coinbase, IBKR exports supported.
        Needs a <em>Symbol</em> column and a market value column (<em>Current Value</em>, <em>Market Value</em>, etc.).
        Values are added on top of manual entries — import multiple files to aggregate.
      </p>
    </div>
  )
}

// ── Single band input ─────────────────────────────────────────────────────

function BandInput({
  bandKey, name, description, value, onChange
}: {
  bandKey: PModeBandKey
  name: string
  description: string
  value: number
  onChange: (raw: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const [raw, setRaw] = useState('')

  const display = focused ? raw : (value > 0 ? String(value) : '')

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, cursor: 'text' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg0)' }}>
        <span style={{ color: 'var(--muted)', marginRight: 5, fontSize: 11 }}>{bandKey}</span>
        {name}
      </span>
      <span style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{description}</span>
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'rgba(255,255,255,0.05)',
        border: `1px solid ${focused ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.10)'}`,
        borderRadius: 6, overflow: 'hidden'
      }}>
        <span style={{ padding: '6px 8px', color: 'var(--muted)', fontSize: 13 }}>$</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={display}
          onChange={(e) => { setRaw(e.target.value); onChange(e.target.value) }}
          onFocus={() => { setFocused(true); setRaw(value > 0 ? String(value) : '') }}
          onBlur={() => { setFocused(false) }}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--fg0)', fontSize: 13, padding: '6px 6px 6px 0',
            width: 0 // flex will stretch it
          }}
        />
        {value > 0 && !focused && (
          <span style={{ fontSize: 11, color: 'var(--muted)', paddingRight: 8 }}>{fmtUsd(value)}</span>
        )}
      </div>
    </label>
  )
}

const btnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.13)',
  color: 'rgba(255,255,255,0.80)',
  borderRadius: 6, padding: '5px 11px',
  fontSize: 12, cursor: 'pointer',
}
