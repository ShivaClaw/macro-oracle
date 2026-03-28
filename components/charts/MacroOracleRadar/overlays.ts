import type { MacroOracleRadarPayload, RiskBandPoint } from './types';
import {
  axisAngleDeg,
  clamp,
  lerp,
  normalize,
  perp,
  pointForValue,
  toRad,
  type Point,
  type RadarGeometry
} from './radarMath';

export type TailEncoding = {
  width: number;
  alphaEnd: number;
  direction: 'out' | 'in';
};

const COOL_TAIL = '#2BB0D6';
const WARM_TAIL = '#E4572E';

const INFLOW_HEX = '#1FE091';
const OUTFLOW_HEX = '#FF5E5B';
const NEUTRAL_HEX = '#6F738A';
const FLOW_REF_DELTA = 15; // normalized delta (~15 pts) treated as "strong"

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim();
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  // eslint-disable-next-line no-bitwise
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

export function flowAlpha(magnitude01: number): number {
  return lerp(0.08, 0.42, clamp(magnitude01, 0, 1));
}

function wedgeFill(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) {
    return rgba(NEUTRAL_HEX, 0.12);
  }
  const mag = Math.abs(delta);
  const norm = clamp(mag / FLOW_REF_DELTA, 0, 1);
  const alpha = flowAlpha(norm);
  const hex = delta >= 0 ? INFLOW_HEX : OUTFLOW_HEX;
  return rgba(hex, alpha);
}

export function tailEncoding(delta7: number): TailEncoding {
  const m = Math.abs(delta7);
  return {
    width: clamp(1.5 + m / 10, 1.5, 6),
    alphaEnd: clamp(0.35 + m / 100, 0.35, 0.85),
    direction: delta7 >= 0 ? 'out' : 'in'
  };
}

function tailColor(dir: 'out' | 'in'): string {
  return dir === 'out' ? WARM_TAIL : COOL_TAIL;
}

const HISTORY_TOLERANCE_MS = 18 * 60 * 60 * 1000;

function getAsOfMs(payload: MacroOracleRadarPayload): number {
  const t = Date.parse(payload.asOf);
  return Number.isFinite(t) ? t : Date.now();
}

export function findNearestHistoryValue(
  history: MacroOracleRadarPayload['history'] | undefined,
  key: string,
  targetMs: number,
  toleranceMs = HISTORY_TOLERANCE_MS
): number | undefined {
  if (!history?.points?.length) return undefined;
  let best: { dt: number; v?: number } | null = null;
  for (const p of history.points) {
    const tm = Date.parse(p.t);
    if (!Number.isFinite(tm)) continue;
    const v = p.values?.[key];
    if (typeof v !== 'number') continue;
    const dt = Math.abs(tm - targetMs);
    if (dt <= toleranceMs && (!best || dt < best.dt)) best = { dt, v };
  }
  return best?.v;
}

export function getPrevValue7d(band: RiskBandPoint, payload: MacroOracleRadarPayload): number | undefined {
  if (typeof band.value7dAgo === 'number') return band.value7dAgo;
  const tNow = getAsOfMs(payload);
  const tPrev = tNow - 7 * 24 * 60 * 60 * 1000;
  return findNearestHistoryValue(payload.history, band.key, tPrev);
}

export type BuildOverlaysArgs = {
  // ECharts module, needed for graphic.LinearGradient.
  echarts: any;
  payload: MacroOracleRadarPayload;
  geom: RadarGeometry;
  theme: 'dark' | 'light';
};

function wedgePolygonPoints(i: number, geom: RadarGeometry): Point[] {
  const step = (2 * Math.PI) / geom.n;
  const theta = toRad(axisAngleDeg(i, geom));
  const thetaL = theta + step / 2;
  const thetaR = theta - step / 2;

  const pL: Point = {
    x: geom.cx + geom.r * Math.cos(thetaL),
    y: geom.cy - geom.r * Math.sin(thetaL)
  };
  const pR: Point = {
    x: geom.cx + geom.r * Math.cos(thetaR),
    y: geom.cy - geom.r * Math.sin(thetaR)
  };
  return [{ x: geom.cx, y: geom.cy }, pL, pR];
}

function arrowheadPoints(tip: Point, thetaRad: number, size: number): Point[] {
  const dir = normalize({ x: Math.cos(thetaRad), y: -Math.sin(thetaRad) });
  const nrm = perp(dir);
  const base = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  const wing = size * 0.62;
  return [
    tip,
    { x: base.x + nrm.x * wing, y: base.y + nrm.y * wing },
    { x: base.x - nrm.x * wing, y: base.y - nrm.y * wing }
  ];
}

function deltaForBand(band: RiskBandPoint, payload: MacroOracleRadarPayload): number | null {
  const vNow = clamp(band.valueNow, 0, 100);
  const vPrev = getPrevValue7d(band, payload);
  if (typeof band.delta7d === 'number') return band.delta7d;
  if (typeof vPrev !== 'number') return null;
  return vNow - clamp(vPrev, 0, 100);
}

export function buildGraphicOverlays(args: BuildOverlaysArgs): any[] {
  const { echarts, payload, geom, theme } = args;
  const isDark = theme === 'dark';

  const elements: any[] = [];

  // 1) Flow-sensitive heat wedges (back layer)
  payload.bands.forEach((b, i) => {
    const delta = deltaForBand(b, payload);
    const fill = wedgeFill(delta);
    elements.push({
      id: `wedge-${b.key}`,
      type: 'polygon',
      silent: true,
      z: 1,
      shape: { points: wedgePolygonPoints(i, geom) },
      style: { fill, stroke: 'transparent' }
    });
  });

  // 2) Comet tails + arrowheads (front)
  payload.bands.forEach((b, i) => {
    const vPrev = getPrevValue7d(b, payload);
    if (typeof vPrev !== 'number' || !Number.isFinite(vPrev)) return;

    const vNow = clamp(b.valueNow, 0, 100);
    const prev = clamp(vPrev, 0, 100);

    const d7 = typeof b.delta7d === 'number' ? b.delta7d : vNow - prev;
    const enc = tailEncoding(d7);

    const p0 = pointForValue(i, prev, geom);
    const p1 = pointForValue(i, vNow, geom);

    // If effectively unchanged, omit to reduce noise.
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1.0) return;

    const col = tailColor(enc.direction);
    const grad = new echarts.graphic.LinearGradient(
      p0.x,
      p0.y,
      p1.x,
      p1.y,
      [
        { offset: 0, color: rgba(col, 0.0) },
        { offset: 1, color: rgba(col, enc.alphaEnd) }
      ],
      true
    );

    elements.push({
      id: `tail-${b.key}`,
      type: 'line',
      silent: true,
      z: 12,
      shape: { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y },
      style: {
        stroke: grad,
        lineWidth: enc.width,
        lineCap: 'round',
        shadowBlur: isDark ? 8 : 0,
        shadowColor: rgba(col, 0.25)
      }
    });

    const theta = toRad(axisAngleDeg(i, geom));
    const arrowSize = 6 + enc.width * 0.8;

    elements.push({
      id: `arrow-${b.key}`,
      type: 'polygon',
      silent: true,
      z: 13,
      shape: { points: arrowheadPoints(p1, theta, arrowSize) },
      style: {
        fill: rgba(col, clamp(enc.alphaEnd + 0.12, 0.35, 0.95)),
        stroke: 'transparent',
        shadowBlur: isDark ? 10 : 0,
        shadowColor: rgba(col, 0.2)
      }
    });
  });

  return elements;
}
