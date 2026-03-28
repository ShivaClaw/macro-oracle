# Macro Oracle Radar (backend)

Next.js App Router API implementation for **Macro Oracle Radar** per `BACKEND_API_SPEC.md`.

## Endpoints

### `GET /api/oracle-data`
Returns the latest cached snapshot (band scores + constituents).

Query params:
- `includeSeries=true` → include full canonical time-series points (larger payload)
- `bands=RISK_0,RISK_3,...` → filter to specific bands
- `asOf=YYYY-MM-DD` → debug/backtesting; served only if a persisted snapshot exists in `.cache/oracle/`

Response caching:
- Sets `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`

### `POST /api/oracle-data/refresh`
Forces a refresh (cold fetch path) and updates the snapshot cache.

Auth:
- Requires header: `Authorization: Bearer ${ORACLE_REFRESH_TOKEN}`

### `GET /api/oracle-data/providers`
Provider status summary (keys present, last success/error, rate-limit hints) + cache stats.

### `GET /api/oracle-data/health`
Basic health + provider status + cache stats.

## Environment variables

Provider keys (optional for mock mode):

```bash
FRED_API_KEY=
FMP_API_KEY=
ALPHAVANTAGE_API_KEY=
COINGECKO_API_KEY=

# Admin
ORACLE_REFRESH_TOKEN=

# Optional metadata
ORACLE_PIPELINE_VERSION=
```

Notes:
- If provider keys are **missing**, the API returns **deterministic mock series** (still cached) so the frontend can run.
- Filesystem caching writes to `.cache/oracle/` on best-effort basis. On serverless platforms, FS may be ephemeral/read-only; the in-memory cache still works.

## Development

```bash
npm install
npm run dev
```

Then hit:
- `http://localhost:3000/api/oracle-data`
- `http://localhost:3000/api/oracle-data/providers`

## Code layout

- `app/api/oracle-data/*` → API routes
- `lib/providers/*` → pluggable provider clients (FRED/FMP/CoinGecko/AlphaVantage)
- `lib/cache/*` → in-memory cache + filesystem fallback
- `lib/config/riskBands.ts` → band/constituent definitions (MVP subset)
- `lib/normalization/*` → placeholder normalization/aggregation (replace with `NORMALIZATION_LOGIC_SPEC.md` implementation later)

---

## Frontend: MacroOracleRadar component

The UI radar visualization lives in:

- `components/MacroOracleRadar.tsx` (public export)
- `components/charts/MacroOracleRadar/*` (option + math + overlays)

### Usage

```tsx
import MacroOracleRadar, { type MacroOracleRadarPayload } from '@/components/MacroOracleRadar';

const payload: MacroOracleRadarPayload = {
  asOf: new Date().toISOString(),
  bands: [
    { key: 'R0', label: 'RISK 0', name: 'Cash / T-Bills', valueNow: 18.4, value7dAgo: 22.1 }
  ]
};

export default function Example() {
  return <MacroOracleRadar payload={payload} theme="dark" size="lg" showBadges />;
}
```

### Notes

- SSR-safe: `echarts-for-react` is imported via `next/dynamic({ ssr: false })`.
- Non-interactive: radar series is `silent`, tooltips disabled, and the canvas has `pointerEvents: none`.
- Comet tails + heat wedges are drawn using ECharts `graphic` overlays and recomputed on resize + data updates.

### Frontend-only unit tests

```bash
npm run test:radar
```
