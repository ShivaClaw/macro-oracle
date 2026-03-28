"use client";

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { EChartsType } from 'echarts';

import type { MacroOracleRadarPayload, MacroOracleRadarProps, RiskBandPoint } from './types';
import { buildRadarOption, type RadarLabelMode } from './option';
import { buildGraphicOverlays } from './overlays';
import { computeRadarMetrics } from './metrics';
import { parsePercent, type RadarGeometry } from './radarMath';

const ReactECharts = dynamic(() => import('echarts-for-react').then((m) => m.default), {
  ssr: false
});

const PREFERRED_AXIS_SEQUENCE = ['R1', 'R3', 'R5', 'R7', 'R8', 'R6', 'R4', 'R2'];

type Dims = { w: number; h: number };

function canonicalBandKey(band: RiskBandPoint): string | null {
  const trySources = [band.key, band.label, band.name];
  for (const src of trySources) {
    if (!src) continue;
    const match = src.toUpperCase().match(/\d+/);
    if (match) {
      return `R${match[0]}`;
    }
  }
  return null;
}

function reorderBands(payload: MacroOracleRadarPayload): MacroOracleRadarPayload {
  const decorated = payload.bands.map((band, originalIndex) => {
    const canonical = canonicalBandKey(band);
    const seqIndex = canonical ? PREFERRED_AXIS_SEQUENCE.indexOf(canonical) : -1;
    return { band, canonical, seqIndex, originalIndex };
  });

  const prioritized = decorated
    .filter((d) => d.seqIndex !== -1)
    .sort((a, b) => a.seqIndex - b.seqIndex)
    .map((d) => d.band);

  if (prioritized.length) {
    return {
      ...payload,
      bands: prioritized
    };
  }

  return payload;
}

function sizeToMinPx(size: MacroOracleRadarProps['size']): number {
  if (size === 'sm') return 260;
  if (size === 'md') return 330;
  return 420; // lg default
}

function deriveRadius(dims: Dims, size: MacroOracleRadarProps['size']): string {
  // Per spec: 70% desktop, 62% mobile.
  const mobile = dims.w < 420;
  if (size === 'sm') return mobile ? '58%' : '62%';
  if (size === 'md') return mobile ? '60%' : '66%';
  return mobile ? '62%' : '70%';
}

function deriveLabelMode(dims: Dims): RadarLabelMode {
  return dims.w < 360 ? 'compact' : 'full';
}

function resolveRadarGeometry(chart: EChartsType, n: number, radius: string | number): RadarGeometry {
  // Prefer the coordinate system computed by ECharts (accounts for layout).
  try {
    const model: any = (chart as any).getModel?.();
    const radarComp: any = model?.getComponent?.('radar', 0);
    const cs: any = radarComp?.coordinateSystem;
    if (cs && Number.isFinite(cs.cx) && Number.isFinite(cs.cy) && Number.isFinite(cs.r)) {
      return {
        cx: cs.cx,
        cy: cs.cy,
        r: cs.r,
        startAngleDeg: radarComp?.get?.('startAngle') ?? 90,
        n
      };
    }
  } catch {
    // fall through to manual approximation
  }

  const w = chart.getWidth();
  const h = chart.getHeight();

  const cx = parsePercent('50%', w);
  const cy = parsePercent('52%', h);
  const basis = Math.min(w, h) / 2;
  const r = parsePercent(radius, basis);

  return { cx, cy, r, startAngleDeg: 90, n };
}

export default function MacroOracleRadar(props: MacroOracleRadarProps) {
  const { payload, theme, size = 'md', showBadges = true } = props;
  const orderedPayload = useMemo(() => reorderBands(payload), [payload]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const [dims, setDims] = useState<Dims>({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setDims({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const radius = useMemo(() => deriveRadius(dims, size), [dims, size]);
  const labelMode = useMemo(() => deriveLabelMode(dims), [dims]);

  const option = useMemo(() => {
    const base = buildRadarOption(orderedPayload, {
      theme,
      radius,
      labelMode,
      showGhostPrev: true
    });

    // Keep graphic component in the option so later merges don't drop it.
    return {
      ...base,
      graphic: { elements: [] }
    };
  }, [orderedPayload, theme, radius, labelMode]);

  const metrics = useMemo(() => computeRadarMetrics(orderedPayload), [orderedPayload]);

  const accessibilitySummary = useMemo(() => {
    const parts: string[] = [];
    if (metrics.labels.length) parts.push(metrics.labels.join(', '));

    // Directional hint: compare low-risk share now vs 7d ago when available.
    parts.push(`Balance ${metrics.balance.toFixed(0)}`);
    parts.push(`Concentration ${metrics.concentration.toFixed(0)}`);
    parts.push(`Risk-off tilt ${metrics.riskOffTilt.toFixed(0)}`);
    return parts.join(' • ');
  }, [metrics]);

  function updateOverlays() {
    const chart = chartRef.current;
    if (!chart) return;

    const n = orderedPayload.bands.length;
    if (n <= 0) return;

    const geom = resolveRadarGeometry(chart, n, radius);
    const elements = buildGraphicOverlays({ echarts, payload: orderedPayload, geom, theme });

    chart.setOption(
      {
        graphic: {
          elements
        }
      },
      {
        lazyUpdate: true,
        replaceMerge: ['graphic']
      } as any
    );
  }

  useEffect(() => {
    updateOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedPayload, theme, radius, dims.w, dims.h]);

  const minPx = sizeToMinPx(size);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        ref={containerRef}
        style={{
          width: 'min(520px, 92vw)',
          minWidth: 240,
          aspectRatio: '1 / 1',
          minHeight: minPx,
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.10)',
          background: 'rgba(0,0,0,0.10)',
          overflow: 'hidden',
          position: 'relative'
        }}
        aria-label={accessibilitySummary}
        role="img"
      >
        <ReactECharts
          option={option as any}
          onChartReady={(chart: EChartsType) => {
            chartRef.current = chart;
            updateOverlays();
          }}
          opts={{ renderer: 'canvas' }}
          style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
          notMerge={false}
          lazyUpdate={true}
        />
      </div>

      {showBadges ? (
        <div className="badges">
          {metrics.labels.map((l) => (
            <span key={l} className="badge">
              <strong>{l}</strong>
            </span>
          ))}
          <span className="badge">
            Balance <strong>{metrics.balance.toFixed(0)}</strong>
          </span>
          <span className="badge">
            Concentration <strong>{metrics.concentration.toFixed(0)}</strong>
          </span>
          <span className="badge">
            Risk-off <strong>{metrics.riskOffTilt.toFixed(0)}</strong>
          </span>
        </div>
      ) : null}
    </div>
  );
}
