export type RadarGeometry = {
  cx: number;
  cy: number;
  r: number;
  startAngleDeg: number;
  n: number;
};

export type Point = { x: number; y: number };

export const EPS = 1e-9;

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function parsePercent(input: string | number, basis: number): number {
  if (typeof input === 'number') return input;
  const s = String(input).trim();
  if (s.endsWith('%')) {
    const p = Number(s.slice(0, -1));
    if (!Number.isFinite(p)) return basis;
    return (p / 100) * basis;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : basis;
}

/**
 * ECharts radar axis ordering: we choose clockwise stepping.
 * With startAngleDeg=90, axis 0 points up.
 */
export function axisAngleDeg(i: number, geom: RadarGeometry): number {
  const step = 360 / geom.n;
  return geom.startAngleDeg - i * step;
}

export function pointForValue(i: number, value0to100: number, geom: RadarGeometry): Point {
  const v = clamp(value0to100, 0, 100);
  const theta = toRad(axisAngleDeg(i, geom));
  const rr = (v / 100) * geom.r;
  return {
    x: geom.cx + rr * Math.cos(theta),
    y: geom.cy - rr * Math.sin(theta)
  };
}

export function vecFromAngle(thetaRad: number): { x: number; y: number } {
  return { x: Math.cos(thetaRad), y: -Math.sin(thetaRad) };
}

export function normalize(v: { x: number; y: number }): { x: number; y: number } {
  const m = Math.hypot(v.x, v.y);
  if (m < EPS) return { x: 0, y: 0 };
  return { x: v.x / m, y: v.y / m };
}

export function add(a: Point, b: { x: number; y: number }): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Point, b: Point): { x: number; y: number } {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(v: { x: number; y: number }, k: number): { x: number; y: number } {
  return { x: v.x * k, y: v.y * k };
}

export function perp(v: { x: number; y: number }): { x: number; y: number } {
  return { x: -v.y, y: v.x };
}
