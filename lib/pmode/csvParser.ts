// lib/pmode/csvParser.ts
// Parse brokerage CSV exports into band allocations.
// Supports: Schwab, Fidelity, Robinhood, Coinbase, generic.

import type { BandAllocation, PModeBandKey } from './types'
import { classifyToken } from './taxonomy'

export type CsvParseResult = {
  ok: true
  source: string
  rows: Array<{ symbol: string; name: string; value: number; band: PModeBandKey }>
  totals: BandAllocation
  warnings: string[]
} | {
  ok: false
  error: string
}

// ── Normalise a raw CSV string into rows ─────────────────────────────────

function parseCsvRows(raw: string): Array<Record<string, string>> {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length < 2) return []

  // Find header row — skip lines that look like metadata (no comma, or start with quote-blob)
  let headerIdx = 0
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const parts = splitCsvLine(lines[i]!)
    // Header should have >= 3 fields including something like "Symbol" or "Ticker"
    if (parts.length >= 3 && parts.some((p) => /symbol|ticker|security|description|name/i.test(p))) {
      headerIdx = i
      break
    }
  }

  const headers = splitCsvLine(lines[headerIdx]!).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const rows: Array<Record<string, string>> = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (!line || line.startsWith(',,,,')) continue // Schwab trailing metadata
    const cols = splitCsvLine(line)
    if (cols.length < 2) continue
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] ?? '').trim()
    })
    rows.push(row)
  }
  return rows
}

function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = !inQuote
    } else if (c === ',' && !inQuote) {
      result.push(cur.replace(/^"|"$/g, '').trim())
      cur = ''
    } else {
      cur += c
    }
  }
  result.push(cur.replace(/^"|"$/g, '').trim())
  return result
}

// ── Extract numeric USD value from a field ────────────────────────────────

function toUsd(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number(raw.replace(/[$,\s%]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── Broker-specific field resolution ─────────────────────────────────────

type ResolvedRow = { symbol: string; name: string; value: number } | null

function resolveRow(row: Record<string, string>): ResolvedRow {
  // Collect candidates for symbol field
  const sym =
    row['symbol'] ?? row['ticker'] ?? row['security'] ?? row['sym'] ?? ''
  const name =
    row['description'] ?? row['name'] ?? row['securityname'] ?? row['assetname'] ?? sym

  // Value candidates in priority order
  const valueCandidates = [
    'currentvalue', 'marketvalue', 'value', 'totalvalue', 'portfoliovalue',
    'currentmarketvalue', 'amount', 'totalmarketvalue'
  ]
  let value: number | null = null
  for (const k of valueCandidates) {
    const v = toUsd(row[k])
    if (v != null) { value = v; break }
  }

  const cleanSym = sym.replace(/\*+$/, '').trim().toUpperCase()
  if (!cleanSym || cleanSym === 'SYMBOL' || value == null) return null
  // Skip cash-equivalent lines that brokers sometimes include as "CASH" or "--"
  // We'll let the user handle those via manual entry R1
  if (/^(cash|pending|--|--)$/i.test(cleanSym)) return null

  return { symbol: cleanSym, name: (name || cleanSym), value }
}

// ── Detect brokerage format for UX label ─────────────────────────────────

function detectSource(raw: string): string {
  if (/Schwab/i.test(raw) || /Individual\s*-/i.test(raw)) return 'Schwab'
  if (/Fidelity/i.test(raw)) return 'Fidelity'
  if (/Robinhood/i.test(raw)) return 'Robinhood'
  if (/Coinbase/i.test(raw)) return 'Coinbase'
  if (/Interactive\s*Brokers|IBKR/i.test(raw)) return 'IBKR'
  if (/Kraken/i.test(raw)) return 'Kraken'
  return 'Generic CSV'
}

// ── Main parse function ───────────────────────────────────────────────────

export function parseBrokerageCsv(raw: string): CsvParseResult {
  try {
    const source = detectSource(raw)
    const csvRows = parseCsvRows(raw)
    if (!csvRows.length) {
      return { ok: false, error: 'No parseable rows found. Check the CSV format.' }
    }

    const warnings: string[] = []
    const rows: CsvParseResult extends { ok: true } ? CsvParseResult['rows'] : never = []
    const totals: BandAllocation = { R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, R6: 0, R7: 0, R8: 0 }

    for (const r of csvRows) {
      const resolved = resolveRow(r)
      if (!resolved) continue

      const band = classifyToken({
        symbol: resolved.symbol,
        chain: 'eth', // brokerage = treat as equity-land, taxonomy uses symbol only
        contractAddress: undefined
      })

      rows.push({ symbol: resolved.symbol, name: resolved.name, value: resolved.value, band })
      totals[band] += resolved.value
    }

    if (!rows.length) {
      return { ok: false, error: 'CSV parsed but no valid position rows found. Make sure columns include symbol and market value.' }
    }

    return { ok: true, source, rows, totals, warnings }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Parse error' }
  }
}
